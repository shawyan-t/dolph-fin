/**
 * Main agent pipeline — orchestrates the full analysis flow.
 *
 * Architecture:
 * - FAIL-CLOSED: if critical data steps fail, pipeline aborts with diagnostic
 * - Deterministic sections (key_metrics, financial_statements, data_sources)
 *   are built in code, never by the LLM
 * - LLM sections use structured per-section calls with exact IDs
 * - Validation uses exact ID matching
 *
 * Cost: ~$0.003-0.01 per analysis (3-5 small LLM calls)
 */

import type { Report, ReportSection, LLMProvider, AnalysisContext } from '@dolph/shared';
import { createPlan } from './planner.js';
import { executePlan } from './executor.js';
import { analyzeData } from './analyzer.js';
import { generateNarrative } from './narrator.js';
import { generateDeterministicNarrative } from './deterministic-narrative.js';
import { validateReport } from './validator.js';
import { correctSections } from './corrector.js';
import { buildFinancialStatementsSection } from './statements-builder.js';
import { buildKeyMetricsSection } from './metrics-builder.js';
import type { PipelineConfig, PipelineCallbacks, PipelineResult } from './types.js';
import type { AnalysisInsights } from './analyzer.js';

/**
 * Run the full analysis pipeline for given tickers.
 */
export async function runPipeline(
  config: PipelineConfig,
  llm?: LLMProvider,
  callbacks?: PipelineCallbacks,
): Promise<PipelineResult> {
  const startTime = Date.now();
  let totalLLMCalls = 0;
  const signal = config.abortSignal;

  try {
    throwIfAborted(signal);

    // ── Step 1: PLAN (deterministic) ──────────────────────────
    callbacks?.onStep?.('Creating analysis plan', 'running');
    const plan = createPlan(config.tickers, config.type);
    callbacks?.onStep?.('Creating analysis plan', 'complete',
      `${plan.steps.length} steps planned`);

    // ── Step 2: EXECUTE (MCP tool calls) ──────────────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Gathering SEC data', 'running');
    const context = await executePlan(plan, config.maxRetries, callbacks, signal);
    throwIfAborted(signal);

    const successCount = context.results.filter(r => r.success).length;

    // FAIL-CLOSED: if no tools succeeded, abort — don't generate a report from nothing
    if (successCount === 0) {
      const errors = context.results
        .filter(r => !r.success)
        .map(r => `${r.tool}: ${r.error}`)
        .join('; ');
      callbacks?.onStep?.('Gathering SEC data', 'error', 'All data fetches failed');
      throw new Error(`Cannot generate report: all data fetches failed. Errors: ${errors}`);
    }

    // Check data availability — comparison requires ALL tickers, single requires ANY
    if (config.type === 'comparison') {
      const missingTickers = config.tickers.filter(t => {
        const facts = context.facts[t];
        return !facts || facts.facts.length === 0;
      });

      if (missingTickers.length > 0) {
        callbacks?.onStep?.('Gathering SEC data', 'error', `Missing data for: ${missingTickers.join(', ')}`);
        throw new Error(
          `Cannot generate comparison report: no financial facts for ${missingTickers.join(', ')}. ` +
          'Comparison requires data for all tickers.',
        );
      }
    } else {
      const hasFactsForAnyTicker = config.tickers.some(t => {
        const facts = context.facts[t];
        return facts && facts.facts.length > 0;
      });

      if (!hasFactsForAnyTicker) {
        callbacks?.onStep?.('Gathering SEC data', 'error', 'No financial data retrieved');
        throw new Error(
          `Cannot generate report: no financial facts retrieved for ${config.tickers.join(', ')}. ` +
          'The company may not have XBRL data available.',
        );
      }
    }

    callbacks?.onStep?.('Gathering SEC data', 'complete',
      `${successCount}/${context.results.length} tools succeeded`);

    // ── Step 3: ANALYZE (deterministic) ──────────────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Analyzing financial data', 'running');
    const insights = analyzeData(context);
    callbacks?.onStep?.('Analyzing financial data', 'complete');

    // ── Step 4: NARRATE ───────────────────────────────────────
    callbacks?.onStep?.('Generating narrative report', 'running');
    // Default to deterministic narrative for reliability. LLM mode is opt-in.
    const narrativeMode = config.narrativeMode ?? 'deterministic';
    const llmOptions = config.snapshotDate ? { temperature: 0, signal } : { signal };
    let sections: ReportSection[];

    if (narrativeMode === 'deterministic') {
      const deterministic = generateDeterministicNarrative(context, insights);
      sections = deterministic.sections;
      callbacks?.onStep?.('Generating narrative report', 'complete', 'deterministic mode');
    } else {
      if (!llm) {
        throw new Error(
          'LLM provider is required in llm narrative mode. ' +
          'Provide a provider or switch to deterministic mode.',
        );
      }
      const generated = await generateNarrative(context, insights, llm, config.tone, llmOptions);
      sections = generated.sections;
      totalLLMCalls += generated.llmCallCount;
      callbacks?.onStep?.('Generating narrative report', 'complete', `${generated.llmCallCount} LLM calls`);
    }
    throwIfAborted(signal);

    // ── Step 4b: Fill deterministic sections ──────────────────
    sections = fillDeterministicSections(sections, context, insights);

    // Emit partial report sections
    for (const section of sections) {
      throwIfAborted(signal);
      callbacks?.onPartialReport?.(section.id, section.content);
    }

    // ── Step 5: VALIDATE (code-based, type-aware) ──────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Validating report quality', 'running');
    let validation = validateReport(sections, config.type);
    callbacks?.onStep?.('Validating report quality',
      validation.pass ? 'complete' : 'error',
      validation.pass
        ? 'All checks passed'
        : `${validation.issues.length} issues found`);

    // ── Step 6: CORRECT (LLM mode only) ───────────────────────
    const canRunCorrections = config.maxValidationLoops > 0 && !!llm && narrativeMode === 'llm';
    let correctionLoops = 0;
    while (canRunCorrections && !validation.pass && correctionLoops < config.maxValidationLoops) {
      throwIfAborted(signal);
      correctionLoops++;
      callbacks?.onStep?.(`Correcting report (attempt ${correctionLoops})`, 'running');

      const { correctedSections, llmCallCount: corrLLMCalls } =
        await correctSections(sections, validation.issues, context, insights, llm, signal);

      totalLLMCalls += corrLLMCalls;
      sections = correctedSections;

      validation = validateReport(sections, config.type);
      callbacks?.onStep?.(
        `Correcting report (attempt ${correctionLoops})`,
        validation.pass ? 'complete' : 'error',
      );
    }

    // FAIL-CLOSED: if validation still has errors, abort
    if (!validation.pass) {
      const errorIssues = validation.issues
        .filter(i => i.severity === 'error')
        .map(i => `[${i.section}] ${i.issue}`)
        .join('; ');
      if (errorIssues) {
        callbacks?.onStep?.('Validation failed after corrections', 'error', errorIssues);
        throw new Error(`Report failed validation after ${correctionLoops} correction attempts: ${errorIssues}`);
      }
      // Only warnings remain — proceed but keep the validation result
    }

    // ── Step 7: DELIVER ───────────────────────────────────────
    throwIfAborted(signal);
    const snapshotId = config.snapshotDate
      ? generateSnapshotId(config.tickers, config.snapshotDate)
      : undefined;

    const report: Report = {
      id: snapshotId || generateId(),
      tickers: config.tickers,
      type: config.type,
      generated_at: config.snapshotDate
        ? `${config.snapshotDate}T00:00:00.000Z`
        : new Date().toISOString(),
      sections,
      sources: extractSources(context),
      validation,
      metadata: {
        llm_calls: totalLLMCalls,
        total_duration_ms: Date.now() - startTime,
        data_points_used: countDataPoints(context),
        snapshot_id: snapshotId,
      },
      provenance: collectProvenance(context),
    };

    await callbacks?.onComplete?.(report, context);
    throwIfAborted(signal);

    return {
      report,
      context,
      llmCallsCount: totalLLMCalls,
      totalDurationMs: report.metadata.total_duration_ms,
    };
  } catch (err) {
    const message = isAbortError(err) ? 'Analysis cancelled' : (err instanceof Error ? err.message : String(err));
    callbacks?.onError?.(message);
    throw err;
  }
}

// ── Deterministic Section Builders ──────────────────────────────

/**
 * Replace placeholder deterministic sections with code-generated content.
 * For comparison mode, builds data for all tickers (not just the first).
 */
function fillDeterministicSections(
  sections: ReportSection[],
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): ReportSection[] {
  return sections.map(section => {
    switch (section.id) {
      case 'key_metrics':
        return buildKeyMetricsSection(context, insights);
      case 'financial_statements':
        return buildFinancialStatementsSection(context);
      case 'data_sources':
        return buildDataSourcesSection(context);
      default:
        return section;
    }
  });
}

/**
 * Build data sources section from context (deterministic).
 */
function buildDataSourcesSection(context: AnalysisContext): ReportSection {
  const lines: string[] = [];
  const retrievedAt = new Date().toISOString().slice(0, 10);
  const annualForms = new Set(['10-K', '20-F', '40-F']);

  for (const ticker of context.tickers) {
    const filings = context.filings[ticker] || [];
    const prioritized = filings.filter(f => annualForms.has(f.filing_type));
    const selected = (prioritized.length > 0 ? prioritized : filings).slice(0, 3);
    for (const filing of selected) {
      lines.push(`- [${ticker} ${filing.filing_type} (${filing.date_filed})](${filing.primary_document_url})`);
    }
  }

  if (lines.length === 0) {
    lines.push('- No SEC filings were retrieved for this analysis.');
  }

  lines.push('');
  lines.push(`Retrieved: ${retrievedAt}`);
  lines.push('Source: SEC EDGAR public filings.');
  lines.push('Disclaimer: For research use only; not investment advice.');

  return {
    id: 'data_sources',
    title: 'Data Sources',
    content: lines.join('\n'),
  };
}

// ── Utilities ───────────────────────────────────────────────────

function generateId(): string {
  return `fl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a deterministic snapshot ID from tickers + date.
 * Same inputs always produce the same ID.
 */
function generateSnapshotId(tickers: string[], date: string): string {
  const input = `${[...tickers].sort().join(',')}:${date}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `snap_${date}_${(hash >>> 0).toString(36)}`;
}

function extractSources(context: AnalysisContext) {
  const sources: Array<{ url: string; description: string; date: string }> = [];

  for (const ticker of context.tickers) {
    const filings = context.filings[ticker] || [];
    for (const filing of filings) {
      sources.push({
        url: filing.primary_document_url,
        description: `${ticker} ${filing.filing_type}`,
        date: filing.date_filed,
      });
    }
  }

  return sources;
}

/**
 * Collect provenance receipts from all data sources into a flat manifest.
 * Keys are "TICKER:metric:period" for traceability.
 */
function collectProvenance(context: AnalysisContext): Record<string, import('@dolph/shared').ProvenanceReceipt> | undefined {
  const manifest: Record<string, import('@dolph/shared').ProvenanceReceipt> = {};
  let hasAny = false;

  for (const ticker of context.tickers) {
    // From company facts
    const facts = context.facts[ticker];
    if (facts) {
      for (const fact of facts.facts) {
        for (const p of fact.periods) {
          if (p.provenance) {
            manifest[`${ticker}:${fact.metric}:${p.period}`] = p.provenance;
            hasAny = true;
          }
        }
      }
    }

    // From ratios
    const ratios = context.ratios[ticker] || [];
    for (const ratio of ratios) {
      if (ratio.provenance) {
        for (const [metric, prov] of Object.entries(ratio.provenance)) {
          manifest[`${ticker}:ratio:${ratio.name}:${metric}`] = prov;
          hasAny = true;
        }
      }
    }
  }

  return hasAny ? manifest : undefined;
}

function countDataPoints(context: AnalysisContext): number {
  let count = 0;

  for (const ticker of context.tickers) {
    count += (context.filings[ticker]?.length || 0);
    count += (context.facts[ticker]?.facts.reduce((sum, fact) => sum + fact.periods.length, 0) || 0);
    count += (context.ratios[ticker]?.length || 0);
    count += (context.trends[ticker]?.reduce((sum, trend) => sum + trend.values.length, 0) || 0);
    count += (context.statements[ticker]?.reduce(
      (statementSum, statement) => statementSum + statement.periods.reduce(
        (periodSum, period) => periodSum + Object.keys(period.data).length,
        0,
      ),
      0,
    ) || 0);
  }

  return count;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Analysis cancelled');
  }
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /abort|cancel/i.test(err.message);
}
