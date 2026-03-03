/**
 * Main agent pipeline — orchestrates the full analysis flow.
 *
 * Cost breakdown per analysis:
 * - Planning: $0 (deterministic)
 * - Data fetching: $0 (SEC APIs)
 * - Analysis: $0 (deterministic)
 * - Narrative: ~$0.003 (single LLM call)
 * - Validation: $0 (code-based)
 * - Correction: ~$0-0.003 (conditional LLM call, rare)
 * Total: ~$0.003-0.006 per analysis
 */

import type { Report, LLMProvider } from '@filinglens/shared';
import { createPlan } from './planner.js';
import { executePlan } from './executor.js';
import { analyzeData } from './analyzer.js';
import { generateNarrative } from './narrator.js';
import { validateReport } from './validator.js';
import { correctSections } from './corrector.js';
import type { PipelineConfig, PipelineCallbacks, PipelineResult } from './types.js';

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
    callbacks?.onStep?.('Gathering SEC data', 'complete',
      `${successCount}/${context.results.length} tools succeeded`);

    // ── Step 3: ANALYZE (deterministic) ──────────────────────
    callbacks?.onStep?.('Analyzing financial data', 'running');
    const insights = analyzeData(context);
    callbacks?.onStep?.('Analyzing financial data', 'complete');

    // ── Step 4: NARRATE (single LLM call) ─────────────────────
    callbacks?.onStep?.('Generating narrative report', 'running');
    let { sections, llmCallCount } = await generateNarrative(context, insights, llm, config.tone);
    totalLLMCalls += llmCallCount;
    callbacks?.onStep?.('Generating narrative report', 'complete');

    // Emit partial report sections
    for (const section of sections) {
      callbacks?.onPartialReport?.(section.id, section.content);
    }

    // ── Step 5: VALIDATE (code-based) ─────────────────────────
    callbacks?.onStep?.('Validating report quality', 'running');
    let validation = validateReport(sections);
    callbacks?.onStep?.('Validating report quality',
      validation.pass ? 'complete' : 'error',
      validation.pass
        ? 'All checks passed'
        : `${validation.issues.length} issues found`);

    // ── Step 6: CORRECT (conditional LLM call) ────────────────
    let correctionLoops = 0;
    while (!validation.pass && correctionLoops < config.maxValidationLoops) {
      correctionLoops++;
      callbacks?.onStep?.(`Correcting report (attempt ${correctionLoops})`, 'running');

      const { correctedSections, llmCallCount: corrLLMCalls } =
        await correctSections(sections, validation.issues, context, insights, llm);

      totalLLMCalls += corrLLMCalls;
      sections = correctedSections;

      // Re-validate
      validation = validateReport(sections);
      callbacks?.onStep?.(
        `Correcting report (attempt ${correctionLoops})`,
        validation.pass ? 'complete' : 'error',
      );
    }

    // ── Step 7: DELIVER ───────────────────────────────────────
    const report: Report = {
      id: generateId(),
      tickers: config.tickers,
      type: config.type,
      generated_at: new Date().toISOString(),
      sections,
      sources: extractSources(context),
      validation,
      metadata: {
        llm_calls: totalLLMCalls,
        total_duration_ms: Date.now() - startTime,
        data_points_used: countDataPoints(context),
      },
    };

    await callbacks?.onComplete?.(report);

    return {
      report,
      context,
      llmCallsCount: totalLLMCalls,
      totalDurationMs: Date.now() - startTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    callbacks?.onError?.(message);
    throw err;
  }
}

function generateId(): string {
  return `fl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractSources(context: import('@filinglens/shared').AnalysisContext) {
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

function countDataPoints(context: import('@filinglens/shared').AnalysisContext): number {
  let count = 0;

  for (const ticker of context.tickers) {
    count += (context.filings[ticker]?.length || 0);
    count += (context.facts[ticker]?.facts.length || 0);
    count += (context.ratios[ticker]?.length || 0);
    count += (context.trends[ticker]?.length || 0);
    count += (context.statements[ticker]?.length || 0);
  }

  return count;
}
