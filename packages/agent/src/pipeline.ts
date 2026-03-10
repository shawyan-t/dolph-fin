/**
 * Main agent pipeline — orchestrates the full analysis flow.
 *
 * Architecture:
 * - FAIL-CLOSED: if critical data steps fail, pipeline aborts with diagnostic
 * - Deterministic sections (key_metrics, financial_statements, data_sources)
 *   are built in code, never by the LLM
 * - LLM sections use structured per-section calls with exact IDs
 * - One sealed canonical package feeds QA, audit, and rendering
 * - Deterministic QA is the authoritative success gate
 *
 * Cost: deterministic mode uses 0 LLM calls; llm mode uses 1 executive-summary call.
 */

import { resolve } from 'node:path';
import type {
  Report,
  ReportSection,
  LLMProvider,
  AnalysisContext,
} from '@dolph/shared';
import { createPlan } from './planner.js';
import { executePlan } from './executor.js';
import { generateExecutiveSummaryOnly } from './narrator.js';
import { generateDeterministicNarrative } from './deterministic-narrative.js';
import { applyNarrativeQualityPass } from './narrative-quality.js';
import { runDeterministicQAGates, writeQAFailureReport } from './deterministic-qa.js';
import { buildFinancialStatementsSection } from './statements-builder.js';
import { buildKeyMetricsSection } from './metrics-builder.js';
import { buildDataSourcesSection } from './sources-builder.js';
import type { PipelineConfig, PipelineCallbacks, PipelineResult } from './types.js';
import { getFilingContent } from '@dolph/mcp-sec-server/tools/get-filing-content.js';
import { resolveReportingPolicy } from './report-policy.js';
import { buildCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';
import type { ReportModel } from './report-model.js';
import { resolveAlignedFilingForTicker } from './report-model.js';
import { writeAuditArtifacts } from './audit-artifacts.js';
import { defaultReportsDir } from './report-paths.js';
import { resolvePeriodAnchors, type PeriodBasis } from './analyzer.js';
import { classifyAllIssuerSupport, summarizeExcludedIssuers } from './issuer-support.js';
import { buildGracefulQAFallbackReport, buildLimitedCoverageReport } from './limited-coverage-report.js';

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
  const requestedTickers = [...config.tickers];

  try {
    throwIfAborted(signal);

    // ── Step 1: PLAN (deterministic) ──────────────────────────
    const policy = resolveReportingPolicy(config);
    callbacks?.onStep?.('Creating analysis plan', 'running');
    const plan = createPlan(config.tickers, config.type, policy);
    callbacks?.onStep?.('Creating analysis plan', 'complete',
      `${plan.steps.length} steps planned`);

    // ── Step 2: EXECUTE (MCP tool calls) ──────────────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Gathering SEC data', 'running');
    const context = await executePlan(plan, config.maxRetries, callbacks, signal);
    context.policy = policy;
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

    callbacks?.onStep?.('Gathering SEC data', 'complete',
      `${successCount}/${context.results.length} tools succeeded`);

    // ── Step 2b: COVERAGE PREFLIGHT ──────────────────────────
    callbacks?.onStep?.('Assessing issuer coverage', 'running');
    const issuerSupport = classifyAllIssuerSupport(context);
    context.issuer_support = issuerSupport;

    if (config.type === 'comparison') {
      const supportedTickers = requestedTickers.filter(ticker => issuerSupport[ticker]?.safe_for_comparison);
      const exclusions = summarizeExcludedIssuers(issuerSupport, requestedTickers, supportedTickers);
      context.comparison_exclusions = exclusions;

      if (supportedTickers.length < 2) {
        const limitedReport = buildLimitedCoverageReport({
          id: config.snapshotDate ? generateSnapshotId(requestedTickers, config.snapshotDate) : generateId(),
          generatedAt: config.snapshotDate ? `${config.snapshotDate}T00:00:00.000Z` : new Date().toISOString(),
          requestedTickers,
          supportedTickers,
          exclusions,
          context,
          issuerSupport,
          reason: exclusions.length > 0
            ? exclusions.map(item => `${item.ticker}: ${item.reason}`).join(' ')
            : 'Fewer than two issuers cleared the annual-coverage requirement for comparison.',
        });
        limitedReport.metadata.total_duration_ms = Date.now() - startTime;
        limitedReport.metadata.data_points_used = countDataPoints(context);
        callbacks?.onStep?.('Assessing issuer coverage', 'complete', 'Limited coverage result');
        for (const section of limitedReport.sections) {
          callbacks?.onPartialReport?.(section.id, section.content);
        }
        await callbacks?.onComplete?.(limitedReport, context, undefined);
        return {
          report: limitedReport,
          context,
          llmCallsCount: totalLLMCalls,
          totalDurationMs: limitedReport.metadata.total_duration_ms,
        };
      }

      if (exclusions.length > 0) {
        callbacks?.onStep?.(
          'Assessing issuer coverage',
          'complete',
          `Excluding ${exclusions.map(item => item.ticker).join(', ')}; proceeding with ${supportedTickers.join(', ')}`,
        );
        config.tickers = supportedTickers;
        context.tickers = supportedTickers;
      } else {
        callbacks?.onStep?.('Assessing issuer coverage', 'complete', 'All issuers support full annual comparison');
      }
    } else {
      const singleStatus = issuerSupport[requestedTickers[0]!];
      if (!singleStatus?.safe_for_standalone) {
        const limitedReport = buildLimitedCoverageReport({
          id: config.snapshotDate ? generateSnapshotId(requestedTickers, config.snapshotDate) : generateId(),
          generatedAt: config.snapshotDate ? `${config.snapshotDate}T00:00:00.000Z` : new Date().toISOString(),
          requestedTickers,
          context,
          issuerSupport,
          reason: singleStatus?.reason,
        });
        limitedReport.metadata.total_duration_ms = Date.now() - startTime;
        limitedReport.metadata.data_points_used = countDataPoints(context);
        callbacks?.onStep?.('Assessing issuer coverage', 'complete', 'Limited coverage result');
        for (const section of limitedReport.sections) {
          callbacks?.onPartialReport?.(section.id, section.content);
        }
        await callbacks?.onComplete?.(limitedReport, context, undefined);
        return {
          report: limitedReport,
          context,
          llmCallsCount: totalLLMCalls,
          totalDurationMs: limitedReport.metadata.total_duration_ms,
        };
      }
      callbacks?.onStep?.('Assessing issuer coverage', 'complete', 'Full annual coverage confirmed');
    }

    // ── Step 3: ANALYZE (deterministic) ──────────────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Analyzing financial data', 'running');
    const { periodBases } = resolvePeriodAnchors(context, policy);
    callbacks?.onStep?.('Analyzing financial data', 'complete');

    // ── Step 3b: Align filing excerpts to the locked annual basis ──────
    throwIfAborted(signal);
    callbacks?.onStep?.('Aligning filing context', 'running');
    await alignFilingContentToLockedPeriods(context, periodBases, signal);
    callbacks?.onStep?.('Aligning filing context', 'complete');
    const canonicalPackage = buildCanonicalReportPackage(context);
    const { insights, reportModel } = canonicalPackage;

    // ── Step 4: NARRATE ───────────────────────────────────────
    callbacks?.onStep?.('Generating narrative report', 'running');
    // Default to deterministic narrative for reliability. LLM mode is opt-in.
    const narrativeMode = config.narrativeMode ?? 'deterministic';
    const llmOptions = config.snapshotDate ? { temperature: 0, signal } : { signal };
    let sections: ReportSection[];
    let structuredNarrative = undefined as Report['narrative'] | undefined;
    let deterministicNarrative = generateDeterministicNarrative(canonicalPackage);

    if (narrativeMode === 'deterministic') {
      sections = deterministicNarrative.sections;
      structuredNarrative = deterministicNarrative.narrative;
      callbacks?.onStep?.('Generating narrative report', 'complete', 'deterministic mode');
    } else {
      if (!llm) {
        throw new Error(
          'LLM provider is required in llm narrative mode. ' +
          'Provide a provider or switch to deterministic mode.',
        );
      }
      const generated = await generateExecutiveSummaryOnly(context, insights, llm, config.tone, llmOptions, policy, reportModel);
      sections = deterministicNarrative.sections.map(section =>
        section.id === generated.section.id ? generated.section : section,
      );
      structuredNarrative = {
        mode: generated.narrative.mode,
        sections: deterministicNarrative.narrative.sections.map(section => {
          const override = generated.narrative.sections.find(candidate => candidate.id === section.id);
          return override || section;
        }),
      };
      totalLLMCalls += generated.llmCallCount;
      callbacks?.onStep?.('Generating narrative report', 'complete', 'executive summary via LLM, all other sections deterministic');
    }
    throwIfAborted(signal);

    // ── Step 4b: Fill deterministic sections ──────────────────
    sections = fillDeterministicSections(sections, canonicalPackage);

    // ── Step 4c: Final narrative quality pass ─────────────────
    const polishedNarrative = applyNarrativeQualityPass(sections, structuredNarrative);
    sections = polishedNarrative.sections;
    structuredNarrative = polishedNarrative.narrative;

    // ── Step 5: SEAL REPORT PACKAGE ─────────────────────────────
    throwIfAborted(signal);
    callbacks?.onStep?.('Validating report quality', 'running');
    // Real QA validation happens in finalizeGovernedReport below.
    // This placeholder is replaced with the actual result after QA runs.
    const validation: import('@dolph/shared').ValidationResult = {
      pass: false,
      issues: [],
      checked_at: new Date().toISOString(),
    };

    // ── Step 7: DELIVER ───────────────────────────────────────
    throwIfAborted(signal);
    const snapshotId = config.snapshotDate
      ? generateSnapshotId(config.tickers, config.snapshotDate)
      : undefined;

    const report: Report = {
      id: snapshotId || generateId(),
      tickers: config.tickers,
      type: config.type,
      policy,
      comparison_basis: context.comparison_basis || null,
      generated_at: config.snapshotDate
        ? `${config.snapshotDate}T00:00:00.000Z`
        : new Date().toISOString(),
      sections,
      sources: extractSources(reportModel),
      validation,
      metadata: {
        llm_calls: totalLLMCalls,
        total_duration_ms: Date.now() - startTime,
        data_points_used: countDataPoints(context),
        report_state: 'full',
        requested_tickers: requestedTickers,
        excluded_tickers: context.comparison_exclusions || [],
        snapshot_id: snapshotId,
        policy_mode: policy.mode,
        comparison_basis_mode: context.comparison_basis?.effective_mode || policy.comparisonBasisMode,
      },
      provenance: collectProvenance(context),
      narrative: structuredNarrative,
    };

    const auditOutputDir = config.auditOutputDir || defaultReportsDir();
    let finalizedReport: Report;
    try {
      finalizedReport = await finalizeGovernedReport(report, context, canonicalPackage, {
        auditOutputDir,
        persistAuditArtifacts: policy.persistAuditArtifacts,
      });
    } catch (err) {
      const qaPath = err instanceof Error && 'qaPath' in err ? String((err as { qaPath?: string }).qaPath || '') : '';
      const qa = err instanceof Error && 'qa' in err ? (err as { qa?: import('./deterministic-qa.js').DeterministicQAResult }).qa : undefined;
      const summary = buildUserFacingQASummary(qa, context);
      const gracefulReport = buildGracefulQAFallbackReport({
        baseReport: report,
        context,
        qaPath,
        summary,
      });
      gracefulReport.metadata.total_duration_ms = Date.now() - startTime;
      gracefulReport.metadata.data_points_used = countDataPoints(context);
      callbacks?.onStep?.('Validating report quality', 'complete', 'Limited coverage result');
      for (const section of gracefulReport.sections) {
        callbacks?.onPartialReport?.(section.id, section.content);
      }
      await callbacks?.onComplete?.(gracefulReport, context, undefined);
      return {
        report: gracefulReport,
        context,
        llmCallsCount: totalLLMCalls,
        totalDurationMs: gracefulReport.metadata.total_duration_ms,
      };
    }
    callbacks?.onStep?.('Validating report quality', 'complete', 'All checks passed');

    for (const section of finalizedReport.sections) {
      throwIfAborted(signal);
      callbacks?.onPartialReport?.(section.id, section.content);
    }

    await callbacks?.onComplete?.(finalizedReport, context, canonicalPackage);
    throwIfAborted(signal);

    return {
      report: finalizedReport,
      context,
      canonicalPackage,
      llmCallsCount: totalLLMCalls,
      totalDurationMs: report.metadata.total_duration_ms,
    };
  } catch (err) {
    const message = isAbortError(err) ? 'Analysis cancelled' : (err instanceof Error ? err.message : String(err));
    callbacks?.onError?.(message);
    throw err;
  }
}

interface FinalizeGovernedReportOptions {
  auditOutputDir: string;
  persistAuditArtifacts: boolean;
}

export async function finalizeGovernedReport(
  report: Report,
  context: AnalysisContext,
  canonicalPackage: CanonicalReportPackage,
  options: FinalizeGovernedReportOptions,
): Promise<Report> {
  let finalReport: Report = report;
  const qa = runDeterministicQAGates(finalReport, context, canonicalPackage);

  if (!qa.pass) {
    const qaPath = await writeQAFailureReport(finalReport, qa, options.auditOutputDir);
    const error = new Error(`Report failed deterministic QA: ${qaPath}`) as Error & { qaPath?: string; qa?: typeof qa };
    error.qaPath = qaPath;
    error.qa = qa;
    throw error;
  }

  finalReport = {
    ...finalReport,
    validation: {
      pass: qa.pass,
      checked_at: finalReport.generated_at,
      issues: qa.failures.map(failure => ({
        section: failure.source,
        issue: `[${failure.gate}] ${failure.message}`,
        severity: failure.severity,
      })),
    },
  };

  if (options.persistAuditArtifacts) {
    finalReport = {
      ...finalReport,
      audit: await writeAuditArtifacts({
        report: finalReport,
        context,
        insights: canonicalPackage.insights,
        reportModel: canonicalPackage.reportModel,
        qa,
        outputDir: options.auditOutputDir,
        pdfPath: null,
      }),
    };
  }

  return finalReport;
}

// ── Deterministic Section Builders ──────────────────────────────

/**
 * Replace placeholder deterministic sections with code-generated content.
 * For comparison mode, builds data for all tickers (not just the first).
 */
function fillDeterministicSections(
  sections: ReportSection[],
  canonicalPackage: CanonicalReportPackage,
): ReportSection[] {
  return sections.map(section => {
    switch (section.id) {
      case 'key_metrics':
        return buildKeyMetricsSection(canonicalPackage);
      case 'financial_statements':
        return buildFinancialStatementsSection(canonicalPackage);
      case 'data_sources':
        return buildDataSourcesSection(canonicalPackage);
      default:
        return section;
    }
  });
}

async function alignFilingContentToLockedPeriods(
  context: AnalysisContext,
  periodBases: Record<string, PeriodBasis>,
  signal?: AbortSignal,
): Promise<void> {
  for (const ticker of context.tickers) {
    if (signal?.aborted) throw new Error('Analysis cancelled');
    const aligned = resolveAlignedFilingForTicker(
      context,
      ticker,
      periodBases[ticker]?.current ?? null,
    );
    if (!aligned) continue;
    const filing = await getFilingContent({
      accession_number: aligned.accessionNumber,
      document_url: aligned.documentUrl,
    });
    context.filing_content[ticker] = filing;
  }
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

function extractSources(model: ReportModel) {
  const sources: Array<{ url: string; description: string; date: string }> = [];

  for (const company of model.companies) {
    for (const filing of company.filingReferences) {
      if (!filing.url) continue;
      sources.push({
        url: filing.url,
        description: `${company.ticker} ${filing.form || 'SEC filing'}`,
        date: filing.filed || '',
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

function buildUserFacingQASummary(
  qa: import('./deterministic-qa.js').DeterministicQAResult | undefined,
  context: AnalysisContext,
): string {
  const failures = (qa?.failures || []).filter(failure => failure.severity === 'error');
  if (failures.length === 0) {
    const debtConflicts = context.tickers.filter(ticker => context.issuer_support?.[ticker]?.debt_reliability === 'suppressed_conflict');
    if (debtConflicts.length > 0) {
      return `${debtConflicts.join(', ')} contained contradictory debt concepts in the filing data, so the full annual report was withheld.`;
    }
    return 'The report was downgraded because final validation identified a material consistency issue in the filing-backed output.';
  }

  const debtConflicts = new Set<string>();
  const profitabilityAmbiguities = new Set<string>();
  const unresolvedMetrics = new Set<string>();
  const accountingBreaks = new Set<string>();

  for (const failure of failures) {
    const source = failure.source;
    const message = failure.message.toLowerCase();
    const ticker = source.split(':').find(part => context.tickers.includes(part)) || null;

    if (/debt/.test(source) || /debt/.test(message)) {
      if (ticker) debtConflicts.add(ticker);
      continue;
    }
    if (/gross profit|gross margin|operating margin|net margin/.test(message) || /gross_profit|gross_margin|operating_margin|net_margin/.test(source)) {
      if (ticker) profitabilityAmbiguities.add(ticker);
      continue;
    }
    if (/assets do not reconcile|cash flow|fcf does not reconcile|sign/i.test(message)) {
      if (ticker) accountingBreaks.add(ticker);
      continue;
    }
    if (ticker) unresolvedMetrics.add(ticker);
  }

  if (debtConflicts.size > 0) {
    return `${Array.from(debtConflicts).join(', ')} contained contradictory debt concepts in the filing data, so the full annual report was withheld.`;
  }
  if (profitabilityAmbiguities.size > 0) {
    return `${Array.from(profitabilityAmbiguities).join(', ')} contained profitability concepts that could not be resolved cleanly from the filing data, so the full report was downgraded to limited coverage.`;
  }
  if (accountingBreaks.size > 0) {
    return `${Array.from(accountingBreaks).join(', ')} failed one or more core accounting consistency checks, so the full report was withheld.`;
  }
  if (unresolvedMetrics.size > 0) {
    return `${Array.from(unresolvedMetrics).join(', ')} had unresolved filing-backed metric conflicts after final validation, so the full report was downgraded to limited coverage.`;
  }

  return 'The report was downgraded because final validation identified a material consistency issue in the filing-backed output.';
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
