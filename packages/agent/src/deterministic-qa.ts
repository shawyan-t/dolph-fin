import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AnalysisContext, Report } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import { normalizeMissingDataMarkdown, parseMetricRows } from './pdf-render-rules.js';
import {
  buildCanonicalAnnualPeriodMap,
  corporateActionEvidence,
  SHARE_CHANGE_ALERT_THRESHOLD,
  shareBasisDivergence,
} from './report-facts.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';

type GateId =
  | 'data.cross_section_equality'
  | 'data.period_coherence'
  | 'data.sanity'
  | 'data.units'
  | 'data.no_fake_na'
  | 'narrative.threshold_alignment'
  | 'narrative.templated_repetition'
  | 'layout.truncation'
  | 'layout.orphan_headers'
  | 'layout.split_modules'
  | 'layout.trailing_pages'
  | 'layout.dead_area';

export interface QAFailure {
  gate: GateId;
  source: string;
  message: string;
}

export interface DeterministicQAResult {
  pass: boolean;
  failures: QAFailure[];
  periodBasis: Record<string, { current: string | null; prior: string | null; note?: string }>;
  mappingFixes: string[];
  recomputedMetrics: Record<string, string[]>;
}

const METRIC_DEPENDENCIES: Record<string, string[]> = {
  'Total Debt': ['long_term_debt', 'short_term_debt'],
  'Free Cash Flow': ['operating_cash_flow', 'capex'],
  'Earnings Per Share (Diluted)': ['eps_diluted'],
  'Book Value Per Share': ['stockholders_equity', 'shares_outstanding'],
  'Debt-to-Equity': ['stockholders_equity'],
  'Current Ratio': ['current_assets', 'current_liabilities'],
  'Quick Ratio': ['current_assets', 'current_liabilities'],
  'Operating Margin': ['operating_income', 'revenue'],
  'Net Margin': ['net_income', 'revenue'],
  'Gross Margin': ['gross_profit', 'revenue'],
};

const REQUIRED_DASHBOARD_METRICS = new Set([
  'Revenue',
  'Net Income',
  'Operating Cash Flow',
  'Capital Expenditures',
  'Total Debt',
  'Debt-to-Equity',
]);

type InsightsMap = Record<string, AnalysisInsights>;

export function runDeterministicQAGates(
  report: Report,
  context: AnalysisContext,
  canonicalPackage: CanonicalReportPackage,
): DeterministicQAResult {
  const pkg = requireCanonicalReportPackage(canonicalPackage, 'runDeterministicQAGates');
  const insights = pkg.insights;
  const failures: QAFailure[] = [];
  const periodBasis: DeterministicQAResult['periodBasis'] = {};
  const mappingFixes: string[] = [];
  const recomputedMetrics: DeterministicQAResult['recomputedMetrics'] = {};

  for (const ticker of context.tickers) {
    const insight = insights[ticker];
    periodBasis[ticker] = {
      current: insight?.snapshotPeriod ?? null,
      prior: insight?.priorPeriod ?? null,
      note: insight?.periodBasis?.note,
    };
    if (!insight?.snapshotPeriod) {
      failures.push({
        gate: 'data.period_coherence',
        source: ticker,
        message: 'Missing current period lock.',
      });
    }

    const fixed: string[] = [];
    if (insight?.keyMetrics['Free Cash Flow']?.prior !== null) fixed.push('Free Cash Flow (prior)');
    if (insight?.keyMetrics['Earnings Per Share (Diluted)']?.prior !== null) fixed.push('Diluted EPS (prior)');
    if (insight?.keyMetrics['Book Value Per Share']?.prior !== null) fixed.push('Book Value Per Share (prior)');
    recomputedMetrics[ticker] = fixed;

    const mappingFlags = (insight?.redFlags || []).filter(
      f => /mapping|reconciliation|plausibility|gross profit/i.test(f.flag),
    );
    for (const f of mappingFlags) {
      mappingFixes.push(`${ticker}: ${f.flag} — ${f.detail}`);
    }

    runSanityGatesForTicker(report, context, ticker, insight, failures);
  }

  if (report.type === 'single') {
    runSingleReportCrossSectionGates(report, context, insights, failures);
  } else {
    runComparisonReportCrossSectionGates(report, context, insights, failures);
  }

  runNarrativeGates(report, context, insights, failures);

  return {
    pass: failures.length === 0,
    failures,
    periodBasis,
    mappingFixes,
    recomputedMetrics,
  };
}

function runSingleReportCrossSectionGates(
  report: Report,
  context: AnalysisContext,
  insights: InsightsMap,
  failures: QAFailure[],
): void {
  const ticker = report.tickers[0]!;
  const insight = insights[ticker];
  if (!insight) return;

  const keyMetricsSection = report.sections.find(s => s.id === 'key_metrics')?.content || '';
  const rows = parseMetricRows(normalizeMissingDataMarkdown(keyMetricsSection));
  const rowMap = new Map(rows.map(r => [r.metric, r]));

  for (const [name, metric] of Object.entries(insight.keyMetrics)) {
    const row = rowMap.get(name);
    if (!row) {
      if (REQUIRED_DASHBOARD_METRICS.has(name)) {
        failures.push({
          gate: 'data.cross_section_equality',
          source: `dashboard:${name}`,
          message: 'Required canonical metric is missing from dashboard output.',
        });
      }
      continue;
    }

    const parsedCurrent = parseDisplayNumber(row.current, metric.unit);
    const parsedPrior = parseDisplayNumber(row.prior, metric.unit);

    if (parsedCurrent === null && metric.current !== null) {
      failures.push({
        gate: 'data.no_fake_na',
        source: `dashboard:${name}`,
        message: 'Current value is N/A in dashboard but computable in canonical metrics.',
      });
    } else if (parsedCurrent !== null && !withinTolerance(parsedCurrent, metric.current, metric.unit)) {
      failures.push({
        gate: 'data.cross_section_equality',
        source: `dashboard:${name}`,
        message: `Current value mismatch (dashboard ${row.current} vs canonical ${metric.current}).`,
      });
    }

    if (parsedPrior === null && metric.prior !== null) {
      failures.push({
        gate: 'data.no_fake_na',
        source: `dashboard:${name}`,
        message: 'Prior value is N/A in dashboard but computable in canonical metrics.',
      });
    } else if (
      metric.prior !== null &&
      parsedPrior !== null &&
      !withinTolerance(parsedPrior, metric.prior, metric.unit)
    ) {
      failures.push({
        gate: 'data.cross_section_equality',
        source: `dashboard:${name}`,
        message: `Prior value mismatch (dashboard ${row.prior} vs canonical ${metric.prior}).`,
      });
    }

    if (metric.unit === 'USD') {
      if (/\$0\.00B/i.test(row.current) && Math.abs(metric.current) < 100_000_000) {
        failures.push({
          gate: 'data.units',
          source: `dashboard:${name}`,
          message: 'Value displayed as $0.00B; unit scaling should switch to $M.',
        });
      }
      if (metric.prior !== null && /\$0\.00B/i.test(row.prior) && Math.abs(metric.prior) < 100_000_000) {
        failures.push({
          gate: 'data.units',
          source: `dashboard:${name}`,
          message: 'Prior value displayed as $0.00B; unit scaling should switch to $M.',
        });
      }
    }
  }

  const periodValues = buildPeriodValueMap(context, ticker);
  const current = insight.snapshotPeriod;
  const prior = insight.priorPeriod;
  if (!current) return;

  for (const [metricName, deps] of Object.entries(METRIC_DEPENDENCIES)) {
    const m = insight.keyMetrics[metricName];
    const currentBucket = periodValues.get(current) || {};
    const currentInputs = metricName === 'Debt-to-Equity'
      ? hasDebtInputs(currentBucket)
      : metricName === 'Total Debt'
        ? hasTotalDebtInputs(currentBucket)
      : hasDependencies(currentBucket, deps);
    if (currentInputs && !m) {
      failures.push({
        gate: 'data.no_fake_na',
        source: `metric:${metricName}`,
        message: 'Metric missing despite all current-period inputs existing.',
      });
    }

    if (!prior) continue;
    const priorBucket = periodValues.get(prior) || {};
    const priorInputs = metricName === 'Debt-to-Equity'
      ? hasDebtInputs(priorBucket)
      : metricName === 'Total Debt'
        ? hasTotalDebtInputs(priorBucket)
      : hasDependencies(priorBucket, deps);
    if (priorInputs && m && m.prior === null) {
      failures.push({
        gate: 'data.no_fake_na',
        source: `metric:${metricName}`,
        message: 'Prior metric value is missing despite all prior-period inputs existing.',
      });
    }
  }
}

function runComparisonReportCrossSectionGates(
  report: Report,
  context: AnalysisContext,
  insights: InsightsMap,
  failures: QAFailure[],
): void {
  const policy = report.policy || context.policy;
  const comparisonBasis = report.comparison_basis || context.comparison_basis;
  const missingSnapshotPeriods = context.tickers.filter(ticker => !insights[ticker]?.snapshotPeriod);
  if (
    policy?.comparisonRequireOverlap
    && (
      !comparisonBasis
      || comparisonBasis.effective_mode !== 'overlap_normalized'
      || comparisonBasis.status !== 'resolved'
    )
  ) {
    failures.push({
      gate: 'data.period_coherence',
      source: 'comparison:policy',
      message: comparisonBasis?.fallback_reason
        ? `Institutional comparison mode requires overlap-normalized periods, but ${comparisonBasis.fallback_reason}`
        : 'Institutional comparison mode requires overlap-normalized periods, but no governed shared annual basis was available across all peers.',
    });
  }
  if (policy?.comparisonRequireOverlap && missingSnapshotPeriods.length > 0) {
    failures.push({
      gate: 'data.period_coherence',
      source: 'comparison:policy',
      message: `Institutional comparison mode requires shared current periods, but no snapshot period was locked for ${missingSnapshotPeriods.join(', ')}.`,
    });
  }
  const distinctPeriods = new Set(
    context.tickers
      .map(ticker => insights[ticker]?.snapshotPeriod)
      .filter((period): period is string => !!period),
  );
  if (
    policy?.comparisonRequireOverlap
    && comparisonBasis?.resolution_kind === 'exact_date_overlap'
    && distinctPeriods.size > 1
  ) {
    failures.push({
      gate: 'data.period_coherence',
      source: 'comparison:policy',
      message: 'Institutional comparison mode requires overlap-normalized periods, but peers are locked to different annual periods.',
    });
  }

  const keyMetricsSection = report.sections.find(s => s.id === 'key_metrics')?.content || '';
  const tableMap = parseComparisonMetricTable(keyMetricsSection, context.tickers);

  for (const ticker of context.tickers) {
    const insight = insights[ticker];
    if (!insight) continue;

    for (const [name, metric] of Object.entries(insight.keyMetrics)) {
      const row = tableMap.get(name);
      const cell = row?.get(ticker.toUpperCase());
      if (cell === undefined) {
        if (REQUIRED_DASHBOARD_METRICS.has(name)) {
          failures.push({
            gate: 'data.cross_section_equality',
            source: `comparison:${ticker}:${name}`,
            message: 'Required canonical metric is missing from comparison output.',
          });
        }
        continue;
      }

      const parsedCurrent = parseDisplayNumber(cell, metric.unit);
      if (parsedCurrent === null && metric.current !== null) {
        failures.push({
          gate: 'data.no_fake_na',
          source: `comparison:${ticker}:${name}`,
          message: 'Current value is N/A in comparison output but computable in canonical metrics.',
        });
      } else if (
        parsedCurrent !== null &&
        metric.current !== null &&
        !withinTolerance(parsedCurrent, metric.current, metric.unit)
      ) {
        failures.push({
          gate: 'data.cross_section_equality',
          source: `comparison:${ticker}:${name}`,
          message: `Current value mismatch (comparison ${cell} vs canonical ${metric.current}).`,
        });
      }

      if (metric.unit === 'USD' && /\$0\.00B/i.test(cell) && Math.abs(metric.current) < 100_000_000) {
        failures.push({
          gate: 'data.units',
          source: `comparison:${ticker}:${name}`,
          message: 'Value displayed as $0.00B; unit scaling should switch to $M.',
        });
      }
    }

    const current = insight.snapshotPeriod;
    if (!current) continue;
    const periodValues = buildPeriodValueMap(context, ticker);
    const currentBucket = periodValues.get(current) || {};
    for (const [metricName, deps] of Object.entries(METRIC_DEPENDENCIES)) {
      const m = insight.keyMetrics[metricName];
      const currentInputs = metricName === 'Debt-to-Equity'
        ? hasDebtInputs(currentBucket)
        : metricName === 'Total Debt'
          ? hasTotalDebtInputs(currentBucket)
          : hasDependencies(currentBucket, deps);
      if (currentInputs && !m) {
        failures.push({
          gate: 'data.no_fake_na',
          source: `comparison:${ticker}:${metricName}`,
          message: 'Metric missing despite all current-period inputs existing.',
        });
      }
    }
  }
}

function runSanityGatesForTicker(
  report: Report,
  context: AnalysisContext,
  ticker: string,
  insight: AnalysisInsights | undefined,
  failures: QAFailure[],
): void {
  if (!insight?.snapshotPeriod) return;
  const periodMap = buildPeriodValueMap(context, ticker);
  const current = periodMap.get(insight.snapshotPeriod) || {};
  const prior = insight.priorPeriod ? (periodMap.get(insight.priorPeriod) || {}) : {};

  const assets = finite(current['total_assets']);
  const liabilities = finite(current['total_liabilities']);
  const equity = finite(current['stockholders_equity']);
  if (assets !== null && liabilities !== null && equity !== null) {
    const gap = Math.abs(assets - (liabilities + equity));
    const tolerance = Math.max(Math.abs(assets) * 0.05, 1_000_000);
    if (gap > tolerance) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:balance_sheet`,
        message: `Assets do not reconcile with liabilities + equity (gap ${gap}).`,
      });
    }
  }

  const cfo = finite(current['operating_cash_flow']);
  const capex = finite(current['capex']);
  const fcf = insight.keyMetrics['Free Cash Flow']?.current ?? null;
  if (cfo !== null && capex !== null && fcf !== null) {
    const expected = cfo - Math.abs(capex);
    if (Math.abs(expected - fcf) > Math.max(Math.abs(expected) * 0.02, 5_000_000)) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:cash_flow`,
        message: `FCF does not reconcile with CFO - CapEx (expected ${expected}, got ${fcf}).`,
      });
    }
  }

  const gp = finite(current['gross_profit']);
  const op = finite(current['operating_income']);
  if (gp !== null && op !== null && gp < op) {
    failures.push({
      gate: 'data.sanity',
      source: `${ticker}:income_statement`,
      message: 'Gross profit is below operating income.',
    });
  }

  const dna = finite(current['depreciation_and_amortization']);
  const dep = finite(current['depreciation_expense']);
  const amort = finite(current['amortization_expense']);
  if (dna !== null && dep !== null && amort !== null) {
    const componentSum = dep + amort;
    if (materiallyDiffers(dna, componentSum, 0.1, 50_000)) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:depreciation_and_amortization`,
        message: 'Depreciation & amortization does not reconcile with depreciation + amortization components.',
      });
    }
  }

  // Debt completeness: if components exist, total debt must be resolved.
  const longTermDebt = finite(current['long_term_debt']);
  const shortTermDebt = finite(current['short_term_debt']);
  const totalDebt = finite(current['total_debt']);
  if ((longTermDebt !== null || shortTermDebt !== null) && totalDebt === null) {
    failures.push({
      gate: 'data.no_fake_na',
      source: `${ticker}:total_debt`,
      message: 'Total Debt is missing even though long-term or short-term debt is present.',
    });
  }

  // Cash-flow sign conventions for explicit outflow lines.
  for (const outflowMetric of ['capex', 'dividends_paid', 'share_repurchases'] as const) {
    const currentValue = finite(current[outflowMetric]);
    if (currentValue !== null && currentValue > 0) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:${outflowMetric}`,
        message: `${outflowMetric} is positive; outflows must be negative or parenthesized.`,
      });
    }
    const priorValue = finite(prior[outflowMetric]);
    if (priorValue !== null && priorValue > 0) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:${outflowMetric}:prior`,
        message: `${outflowMetric} prior is positive; outflows must be negative or parenthesized.`,
      });
    }
  }

  // Shares-basis validation and labeling.
  const currShares = finite(current['shares_outstanding']);
  const prevShares = finite(prior['shares_outstanding']);
  const currWeightedShares = finite(current['weighted_avg_shares_diluted']);
  const prevWeightedShares = finite(prior['weighted_avg_shares_diluted']);
  const currShareBasis = currWeightedShares ?? currShares;
  const prevShareBasis = prevWeightedShares ?? prevShares;
  const currentShareBasisGap = shareBasisDivergence(
    finite(current['net_income']),
    finite(current['eps_diluted']),
    currShareBasis,
  );
  const priorShareBasisGap = shareBasisDivergence(
    finite(prior['net_income']),
    finite(prior['eps_diluted']),
    prevShareBasis,
  );

  const hasShareJump = currShares !== null
    && prevShares !== null
    && prevShares > 0
    && Math.max(currShares / prevShares, prevShares / currShares) >= SHARE_CHANGE_ALERT_THRESHOLD;
  const hasBasisGap = (currentShareBasisGap ?? 0) > 0.2 || (priorShareBasisGap ?? 0) > 0.2;
  const corroboratedShareChange = corroboratesShareChange(
    currShares,
    prevShares,
    currWeightedShares,
    prevWeightedShares,
  );

  if (hasShareJump) {
    const text = context.filing_content[ticker]?.raw_text || '';
    if (!corporateActionEvidence(text) && !corroboratedShareChange) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:shares_outstanding`,
        message: `Shares outstanding changed by >= ${SHARE_CHANGE_ALERT_THRESHOLD.toFixed(1)}x without filing-text evidence or weighted-share corroboration.`,
      });
    }
  }

  if (hasShareJump || hasBasisGap) {
    const reportText = report.sections.map(section => section.content).join('\n');
    const hasWeightedAverageLabel = /weighted[-\s]?average/i.test(reportText);
    const hasPeriodEndLabel = /period[-\s]?end shares?/i.test(reportText);
    if (!hasWeightedAverageLabel || !hasPeriodEndLabel) {
      failures.push({
        gate: 'data.sanity',
        source: `${ticker}:share_basis`,
        message: 'Per-share basis labeling is missing; EPS must state weighted-average shares and BVPS must state period-end shares.',
      });
    }
  }
}

function parseComparisonMetricTable(
  markdown: string,
  tickers: string[],
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));
  const lines = normalizeMissingDataMarkdown(markdown).split('\n');
  let activeHeaders: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      activeHeaders = null;
      continue;
    }
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.length < 2) continue;
    const first = cells[0]!.toLowerCase();
    if (first === 'metric') {
      activeHeaders = cells.map(c => c.toUpperCase());
      continue;
    }
    if (/^:?-{2,}:?$/.test(first)) continue;
    if (!activeHeaders || activeHeaders[0] !== 'METRIC') continue;

    const metric = cells[0]!;
    if (!metric || /snapshot period/i.test(metric)) continue;
    const row = out.get(metric) || new Map<string, string>();
    for (let idx = 1; idx < cells.length; idx++) {
      const header = activeHeaders[idx];
      if (!header || !tickerSet.has(header)) continue;
      row.set(header, normalizeCell(cells[idx] || 'N/A'));
    }
    if (row.size > 0) out.set(metric, row);
  }

  return out;
}

function runNarrativeGates(
  report: Report,
  context: AnalysisContext,
  insights: InsightsMap,
  failures: QAFailure[],
): void {
  if (report.narrative?.sections) {
    const validFactIds = new Set<string>();
    const sectionContentById = new Map(report.sections.map(section => [section.id, section.content.trim()]));
    for (const insight of Object.values(insights)) {
      for (const factId of Object.keys(insight.canonicalFacts || {})) validFactIds.add(factId);
    }
    for (const section of report.narrative.sections) {
      const rendered = section.rendered_content?.trim();
      const actual = sectionContentById.get(section.id) || '';
      if (!rendered) {
        failures.push({
          gate: 'narrative.threshold_alignment',
          source: `narrative:${section.id}`,
          message: 'Structured narrative section is missing rendered_content.',
        });
      } else if (rendered !== actual) {
        failures.push({
          gate: 'narrative.threshold_alignment',
          source: `narrative:${section.id}`,
          message: 'Structured narrative rendered_content does not match the rendered report section.',
        });
      }
      for (const paragraph of section.paragraphs) {
        if (!paragraph.text.trim()) {
          failures.push({
            gate: 'narrative.threshold_alignment',
            source: `narrative:${section.id}`,
            message: 'Structured narrative contains an empty paragraph.',
          });
          continue;
        }
        if (paragraph.fact_ids.length === 0) {
          failures.push({
            gate: 'narrative.threshold_alignment',
            source: `narrative:${section.id}`,
            message: 'Structured narrative paragraph has no fact bindings.',
          });
          continue;
        }
        const invalid = paragraph.fact_ids.filter(factId => !validFactIds.has(factId));
        if (invalid.length > 0) {
          failures.push({
            gate: 'narrative.threshold_alignment',
            source: `narrative:${section.id}`,
            message: `Structured narrative references unsupported fact ids: ${invalid.join(', ')}.`,
          });
        }
      }
    }
  }

  const narrativeSectionIds = report.type === 'comparison'
    ? ['executive_summary', 'relative_strengths', 'risk_factors', 'analyst_notes']
    : ['executive_summary', 'trend_analysis', 'risk_factors', 'analyst_notes'];

  const narrative = report.sections
    .filter(s => narrativeSectionIds.includes(s.id))
    .map(s => s.content)
    .join('\n');

  const repeatedPattern = /\b([a-z][a-z'’-]*)[ \t]+\1[ \t]+is currently\b/i;
  if (repeatedPattern.test(narrative)) {
    failures.push({
      gate: 'narrative.templated_repetition',
      source: 'narrative',
      message: 'Detected templated repetition pattern ("X X is currently").',
    });
  }

  if (report.type === 'single') {
    const ticker = context.tickers[0]!;
    const de = insights[ticker]?.keyMetrics['Debt-to-Equity']?.current ?? null;
    const currentRatio = insights[ticker]?.keyMetrics['Current Ratio']?.current ?? null;
    const operatingCashFlow = insights[ticker]?.keyMetrics['Operating Cash Flow']?.current ?? null;
    const freeCashFlow = insights[ticker]?.keyMetrics['Free Cash Flow']?.current ?? null;
    const low = narrative.toLowerCase();
    const leverageMagnitude = de === null ? null : Math.abs(de);

    if (/strong liquidity/.test(low) && (currentRatio === null || currentRatio < 1.5)) {
      failures.push({
        gate: 'narrative.threshold_alignment',
        source: 'narrative',
        message: 'Narrative claims strong liquidity but current ratio threshold is not met.',
      });
    }
    if (
      /strong liquidity|conservatively positioned|significant strategic flexibility/.test(low)
      && ((operatingCashFlow !== null && operatingCashFlow < 0) || (freeCashFlow !== null && freeCashFlow < 0))
    ) {
      failures.push({
        gate: 'narrative.threshold_alignment',
        source: 'narrative',
        message: 'Narrative presents balance-sheet strength without acknowledging negative operating or free cash flow.',
      });
    }
    if ((/high leverage|elevated leverage/.test(low)) && (leverageMagnitude === null || leverageMagnitude < 2)) {
      failures.push({
        gate: 'narrative.threshold_alignment',
        source: 'narrative',
        message: 'Narrative claims high leverage but debt-to-equity is below threshold.',
      });
    }
    if (/conservative leverage/.test(low) && (leverageMagnitude === null || leverageMagnitude > 1)) {
      failures.push({
        gate: 'narrative.threshold_alignment',
        source: 'narrative',
        message: 'Narrative claims conservative leverage but debt-to-equity is above threshold.',
      });
    }
    return;
  }

  const low = narrative.toLowerCase();
  const comparisonDebt = context.tickers.map(ticker => ({
    ticker,
    debtToEquity: insights[ticker]?.keyMetrics['Debt-to-Equity']?.current ?? null,
  }));
  if (
    /most conservative leverage|conservative leverage profile|lowest leverage/i.test(low)
    && comparisonDebt.some(entry => entry.debtToEquity === null)
  ) {
    failures.push({
      gate: 'narrative.threshold_alignment',
      source: 'comparison:narrative',
      message: 'Peer leverage ranking is claimed even though one or more peers have no debt-to-equity value.',
    });
  }

  const periods = context.tickers.map(ticker => insights[ticker]?.snapshotPeriod ?? null).filter(Boolean);
  const distinctPeriods = new Set(periods);
  if (
    /same reported annual period|figures are aligned to the same reported annual period/i.test(low)
    && distinctPeriods.size > 1
  ) {
    failures.push({
      gate: 'narrative.threshold_alignment',
      source: 'comparison:narrative',
      message: 'Narrative claims synchronized peer periods even though locked annual periods differ.',
    });
  }
}

function buildPeriodValueMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, Record<string, number>> {
  return buildCanonicalAnnualPeriodMap(context, ticker);
}

function hasDependencies(values: Record<string, number>, deps: string[]): boolean {
  return deps.every(dep => values[dep] !== undefined && isFinite(values[dep]!));
}

function hasDebtInputs(values: Record<string, number>): boolean {
  const equity = finite(values['stockholders_equity']);
  if (equity === null || equity === 0) return false;
  const totalDebt = finite(values['total_debt']);
  const longTerm = finite(values['long_term_debt']);
  const shortTerm = finite(values['short_term_debt']);
  return totalDebt !== null || longTerm !== null || shortTerm !== null;
}

function hasTotalDebtInputs(values: Record<string, number>): boolean {
  const totalDebt = finite(values['total_debt']);
  if (totalDebt !== null) return true;
  const longTerm = finite(values['long_term_debt']);
  const shortTerm = finite(values['short_term_debt']);
  return longTerm !== null || shortTerm !== null;
}

function parseDisplayNumber(raw: string, unit: string): number | null {
  const text = raw.trim();
  if (!text || /^n\/a$/i.test(text)) return null;
  const clean = text.replace(/,/g, '');

  if (unit === '%') {
    const n = Number.parseFloat(clean.replace('%', ''));
    return isFinite(n) ? n / 100 : null;
  }
  if (unit === 'x') {
    const n = Number.parseFloat(clean.replace('x', ''));
    return isFinite(n) ? n : null;
  }
  if (unit === 'USD/shares') {
    const n = Number.parseFloat(clean.replace('$', ''));
    return isFinite(n) ? n : null;
  }
  if (unit === 'shares') {
    return parseCompactNumber(clean);
  }
  // USD compact
  return parseCompactNumber(clean.replace('$', ''));
}

function normalizeCell(v: string): string {
  const trimmed = v.trim();
  if (!trimmed || /^[-—]$/.test(trimmed) || /^n\/a$/i.test(trimmed)) return 'N/A';
  return trimmed;
}

function parseCompactNumber(clean: string): number | null {
  const n = Number.parseFloat(clean.replace(/[^0-9.\-]/g, ''));
  if (!isFinite(n)) return null;
  if (/B$/i.test(clean)) return n * 1e9;
  if (/M$/i.test(clean)) return n * 1e6;
  if (/K$/i.test(clean)) return n * 1e3;
  return n;
}

function withinTolerance(parsed: number, canonical: number, unit: string): boolean {
  const abs = Math.abs(canonical);
  if (unit === '%' || unit === 'x' || unit === 'USD/shares') {
    return Math.abs(parsed - canonical) <= 0.02;
  }
  const tol = Math.max(abs * 0.03, 1_000_000);
  return Math.abs(parsed - canonical) <= tol;
}

function finite(v: number | undefined): number | null {
  if (v === undefined) return null;
  return isFinite(v) ? v : null;
}

function shareRatio(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || current <= 0 || prior <= 0) return null;
  return current / prior;
}

function corroboratesShareChange(
  currentShares: number | null,
  priorShares: number | null,
  currentWeightedShares: number | null,
  priorWeightedShares: number | null,
): boolean {
  const periodRatio = shareRatio(currentShares, priorShares);
  const weightedRatio = shareRatio(currentWeightedShares, priorWeightedShares);
  if (periodRatio === null || weightedRatio === null) return false;

  const sameDirection = (periodRatio >= 1 && weightedRatio >= 1) || (periodRatio <= 1 && weightedRatio <= 1);
  if (!sameDirection) return false;

  const relativeGap = Math.abs(periodRatio - weightedRatio) / Math.max(Math.abs(periodRatio), Math.abs(weightedRatio), 1);
  return relativeGap <= 0.35;
}

function materiallyDiffers(a: number, b: number, relativeTolerance: number, absoluteTolerance: number): boolean {
  const gap = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return gap > Math.max(scale * relativeTolerance, absoluteTolerance);
}

export async function writeQAFailureReport(
  report: Report,
  qa: DeterministicQAResult,
  outputDir: string,
): Promise<string> {
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date(report.generated_at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = resolve(dir, `${report.tickers.join('-')}-${timestamp}-qa-failure.md`);

  const lines: string[] = [];
  lines.push(`# QA Failure Report — ${report.tickers.join(', ')}`);
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Report ID: ${report.id}`);
  lines.push('');
  lines.push('## Period Basis');
  for (const [ticker, basis] of Object.entries(qa.periodBasis)) {
    lines.push(`- ${ticker}: current=${basis.current ?? 'N/A'}, prior=${basis.prior ?? 'N/A'}${basis.note ? ` (${basis.note})` : ''}`);
  }
  lines.push('');
  lines.push('## Mapping Fixes / Signals');
  if (qa.mappingFixes.length === 0) {
    lines.push('- None');
  } else {
    for (const fix of qa.mappingFixes) lines.push(`- ${fix}`);
  }
  lines.push('');
  lines.push('## Metrics Computed (previously missing-sensitive)');
  for (const [ticker, metrics] of Object.entries(qa.recomputedMetrics)) {
    lines.push(`- ${ticker}: ${metrics.length > 0 ? metrics.join(', ') : 'None'}`);
  }
  lines.push('');
  lines.push('## Validation Failures');
  if (qa.failures.length === 0) {
    lines.push('- None');
  } else {
    for (const f of qa.failures) {
      lines.push(`- [${f.gate}] ${f.source}: ${f.message}`);
    }
  }

  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}
