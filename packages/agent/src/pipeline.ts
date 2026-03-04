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
  llm: LLMProvider,
  callbacks?: PipelineCallbacks,
): Promise<PipelineResult> {
  const startTime = Date.now();
  let totalLLMCalls = 0;

  try {
    // ── Step 1: PLAN (deterministic) ──────────────────────────
    callbacks?.onStep?.('Creating analysis plan', 'running');
    const plan = createPlan(config.tickers, config.type);
    callbacks?.onStep?.('Creating analysis plan', 'complete',
      `${plan.steps.length} steps planned`);

    // ── Step 2: EXECUTE (MCP tool calls) ──────────────────────
    callbacks?.onStep?.('Gathering SEC data', 'running');
    const context = await executePlan(plan, config.maxRetries, callbacks);

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
    callbacks?.onStep?.('Analyzing financial data', 'running');
    const insights = analyzeData(context);
    callbacks?.onStep?.('Analyzing financial data', 'complete');

    // ── Step 4: NARRATE (structured per-section LLM calls) ───
    callbacks?.onStep?.('Generating narrative report', 'running');
    const llmOptions = config.snapshotDate ? { temperature: 0 } : undefined;
    let { sections, llmCallCount } = await generateNarrative(context, insights, llm, config.tone, llmOptions);
    totalLLMCalls += llmCallCount;

    // ── Step 4b: Fill deterministic sections ──────────────────
    sections = fillDeterministicSections(sections, context, insights);

    callbacks?.onStep?.('Generating narrative report', 'complete',
      `${llmCallCount} LLM calls`);

    // Emit partial report sections
    for (const section of sections) {
      callbacks?.onPartialReport?.(section.id, section.content);
    }

    // ── Step 5: VALIDATE (code-based, type-aware) ──────────────
    callbacks?.onStep?.('Validating report quality', 'running');
    let validation = validateReport(sections, config.type);
    callbacks?.onStep?.('Validating report quality',
      validation.pass ? 'complete' : 'error',
      validation.pass
        ? 'All checks passed'
        : `${validation.issues.length} issues found`);

    // ── Step 6: CORRECT (conditional, per-section LLM calls) ──
    let correctionLoops = 0;
    while (!validation.pass && correctionLoops < config.maxValidationLoops) {
      correctionLoops++;
      callbacks?.onStep?.(`Correcting report (attempt ${correctionLoops})`, 'running');

      const { correctedSections, llmCallCount: corrLLMCalls } =
        await correctSections(sections, validation.issues, context, insights, llm);

      totalLLMCalls += corrLLMCalls;
      sections = correctedSections;

      validation = validateReport(sections, config.type);
      callbacks?.onStep?.(
        `Correcting report (attempt ${correctionLoops})`,
        validation.pass ? 'complete' : 'error',
      );
    }

    // FAIL-CLOSED: if validation still fails after max loops, abort
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

    return {
      report,
      context,
      llmCallsCount: totalLLMCalls,
      totalDurationMs: report.metadata.total_duration_ms,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
  const sources: string[] = [];

  for (const ticker of context.tickers) {
    const filings = context.filings[ticker] || [];
    for (const filing of filings.slice(0, 3)) {
      sources.push(`- [${ticker} ${filing.filing_type} (${filing.date_filed})](${filing.primary_document_url})`);
    }
  }

  if (sources.length === 0) {
    sources.push('- No SEC filings were retrieved for this analysis.');
  }

  sources.push('');
  sources.push('*All data sourced from SEC EDGAR. This analysis is generated from public SEC filings and is not financial advice.*');

  return {
    id: 'data_sources',
    title: 'Data Sources',
    content: sources.join('\n'),
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
