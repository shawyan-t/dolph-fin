import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AnalysisContext,
  AnalysisType,
  MetricAvailabilityReasonCode,
  Report,
  ReportSection,
} from '@dolph/shared';
import {
  REQUIRED_COMPARISON_SECTIONS,
  REQUIRED_SINGLE_SECTIONS,
} from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import { isUnavailableDisplay, normalizeMissingDataMarkdown } from './pdf-render-rules.js';
import { buildKeyMetricsSection } from './metrics-builder.js';
import { buildFinancialStatementsSection } from './statements-builder.js';
import { buildDataSourcesSection } from './sources-builder.js';
import {
  buildCanonicalAnnualPeriodMap,
  buildCanonicalAnnualSourceMap,
  hasCashPresentationAlternative,
  corporateActionEvidence,
  SHARE_CHANGE_ALERT_THRESHOLD,
  shareBasisDivergence,
  type CanonicalFactSource,
} from './report-facts.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';

type GateId =
  | 'report.section_contract'
  | 'data.cross_section_equality'
  | 'data.period_coherence'
  | 'data.sanity'
  | 'data.mapping_confidence'
  | 'data.units'
  | 'data.no_fake_na'
  | 'narrative.threshold_alignment'
  | 'narrative.style_quality'
  | 'narrative.templated_repetition'
  | 'layout.truncation'
  | 'layout.orphan_headers'
  | 'layout.split_modules'
  | 'layout.trailing_pages'
  | 'layout.dead_area';

export type QASeverity = 'error' | 'warning';

export interface QAFailure {
  gate: GateId;
  severity: QASeverity;
  source: string;
  message: string;
}

const GATE_SEVERITY: Record<GateId, QASeverity> = {
  'report.section_contract': 'error',
  'data.cross_section_equality': 'error',
  'data.period_coherence': 'error',
  'data.sanity': 'error',
  'data.mapping_confidence': 'warning',
  'data.units': 'warning',
  'data.no_fake_na': 'error',
  'narrative.threshold_alignment': 'error',
  'narrative.style_quality': 'error',
  'narrative.templated_repetition': 'warning',
  'layout.truncation': 'warning',
  'layout.orphan_headers': 'warning',
  'layout.split_modules': 'warning',
  'layout.trailing_pages': 'warning',
  'layout.dead_area': 'warning',
};

function pushFailure(failures: QAFailure[], gate: GateId, source: string, message: string): void {
  failures.push({ gate, severity: GATE_SEVERITY[gate], source, message });
}

export interface DeterministicQAResult {
  pass: boolean;
  failures: QAFailure[];
  periodBasis: Record<string, { current: string | null; prior: string | null; note?: string }>;
  mappingFixes: string[];
  recomputedMetrics: Record<string, string[]>;
}

const METRIC_DEPENDENCIES: Record<string, string[]> = {
  'Total Debt': ['total_debt'],
  'Free Cash Flow': ['free_cash_flow'],
  'Earnings Per Share (Diluted)': ['net_income', 'weighted_avg_shares_diluted'],
  'Book Value Per Share': ['stockholders_equity', 'shares_outstanding'],
  'Debt-to-Equity': ['total_debt', 'stockholders_equity'],
  'Current Ratio': ['current_assets', 'current_liabilities'],
  'Quick Ratio': ['current_assets', 'current_liabilities', 'inventory'],
  'Operating Margin': ['operating_income', 'revenue'],
  'Net Margin': ['net_income', 'revenue'],
  'Gross Margin': ['gross_profit', 'revenue'],
  'Gross Profit': ['gross_profit'],
  'Working Capital': ['working_capital'],
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
      pushFailure(failures, 'data.period_coherence', ticker, 'Missing current period lock.');
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
    runSingleReportCrossSectionGates(report, context, canonicalPackage, failures);
  } else {
    runComparisonReportCrossSectionGates(report, context, canonicalPackage, failures);
  }

  runSectionContractGates(report, failures);
  runPackageContractGates(report, pkg, failures);
  runCashFamilyPresentationGates(pkg, failures);
  runNarrativeGates(report, context, insights, pkg, failures);

  return {
    pass: failures.filter(f => f.severity === 'error').length === 0,
    failures,
    periodBasis,
    mappingFixes,
    recomputedMetrics,
  };
}

function runSectionContractGates(
  report: Report,
  failures: QAFailure[],
): void {
  const requiredSections = requiredSectionIds(report.type);
  const sectionMap = new Map(report.sections.map(section => [section.id, section]));

  for (const id of requiredSections) {
    const section = sectionMap.get(id);
    if (!section) {
      pushFailure(failures, 'report.section_contract', id, `Missing required section: ${id}.`);
      continue;
    }
    if (section.content.trim().length < 20) {
      pushFailure(failures, 'report.section_contract', id, `Required section "${id}" has insufficient content.`);
    }
  }

  const keyMetrics = sectionMap.get('key_metrics');
  if (keyMetrics && !hasValidMarkdownTable(keyMetrics)) {
    pushFailure(failures, 'report.section_contract', 'key_metrics', 'Key metrics section is missing a valid markdown table.');
  }

  const statements = sectionMap.get('financial_statements');
  if (statements && !hasValidMarkdownTable(statements)) {
    pushFailure(failures, 'report.section_contract', 'financial_statements', 'Financial statements section is missing a valid markdown table.');
  }

  const sources = sectionMap.get('data_sources');
  if (sources && !hasDataSourceReference(sources)) {
    pushFailure(failures, 'report.section_contract', 'data_sources', 'Data sources section does not contain a filing reference or URL.');
  }
}

function runPackageContractGates(
  report: Report,
  canonicalPackage: CanonicalReportPackage,
  failures: QAFailure[],
): void {
  const model = canonicalPackage.reportModel;
  const expectedSections = new Map<string, string>([
    ['key_metrics', buildKeyMetricsSection(canonicalPackage).content.trim()],
    ['financial_statements', buildFinancialStatementsSection(canonicalPackage).content.trim()],
    ['data_sources', buildDataSourcesSection(canonicalPackage).content.trim()],
  ]);
  const actualSections = new Map(report.sections.map(section => [section.id, section.content.trim()]));

  for (const [sectionId, expected] of expectedSections) {
    const actual = actualSections.get(sectionId);
    if ((actual || '') !== expected) {
      pushFailure(failures, 'data.cross_section_equality', `section:${sectionId}`, 'Rendered deterministic section drifted from the sealed canonical package.');
    }
  }

  for (const company of model.companies) {
    const expectedPeriods = [company.snapshotPeriod, company.priorPeriod]
      .filter((period): period is string => !!period);

    for (const table of company.statementTables) {
      if (table.periods.length !== expectedPeriods.length) {
        pushFailure(failures, 'data.period_coherence', `${company.ticker}:${table.statementType}`, `Statement table uses ${table.periods.length} periods, but the locked contract requires ${expectedPeriods.length}.`);
        continue;
      }

      for (let idx = 0; idx < expectedPeriods.length; idx++) {
        if (table.periods[idx] !== expectedPeriods[idx]) {
          pushFailure(failures, 'data.period_coherence', `${company.ticker}:${table.statementType}`, `Statement table period contract drifted (${table.periods.join(', ')} vs locked ${expectedPeriods.join(', ')}).`);
          break;
        }
      }
    }
  }

  if (model.type !== 'comparison') return;

  const expectedGroups = model.comparisonRowGroups.map(group => ({
    title: group.title,
    rowLabels: group.rowLabels,
  }));
  for (const company of model.companies) {
    if (company.comparisonGroups.length !== expectedGroups.length) {
      pushFailure(failures, 'data.cross_section_equality', `${company.ticker}:comparison_groups`, 'Comparison row contract does not match the sealed report-level contract.');
      continue;
    }

    for (let idx = 0; idx < expectedGroups.length; idx++) {
      const expected = expectedGroups[idx]!;
      const actual = company.comparisonGroups[idx]!;
      const actualLabels = actual.rows.map(row => row.label);
      if (
        actual.title !== expected.title
        || actualLabels.length !== expected.rowLabels.length
        || actualLabels.some((label, labelIdx) => label !== expected.rowLabels[labelIdx])
      ) {
        pushFailure(failures, 'data.cross_section_equality', `${company.ticker}:comparison_groups:${expected.title}`, 'Comparison rows drifted from the sealed report-level row contract.');
        break;
      }
    }
  }
}

function runCashFamilyPresentationGates(
  canonicalPackage: CanonicalReportPackage,
  failures: QAFailure[],
): void {
  for (const company of canonicalPackage.reportModel.companies) {
    const currentValues = company.snapshotPeriod ? company.canonicalPeriodMap.get(company.snapshotPeriod) : null;
    if (!currentValues) continue;

    const balanceSheet = company.statementTables.find(table => table.statementType === 'balance_sheet');
    if (!balanceSheet) continue;

    for (const metric of ['cash_and_equivalents', 'restricted_cash', 'short_term_investments'] as const) {
      if (!hasCashPresentationAlternative(currentValues, metric)) continue;
      const row = balanceSheet.rows.find(candidate => candidate.key === metric);
      if (!row) continue;
      if (row.displays[0] === 'Not reported') {
        pushFailure(failures, 'data.cross_section_equality', `${company.ticker}:${metric}`, 'Appendix shows a narrower cash-family row as Not reported even though another governed current cash presentation is available from the filing.');
      }
    }
  }
}

function runSingleReportCrossSectionGates(
  report: Report,
  context: AnalysisContext,
  canonicalPackage: CanonicalReportPackage,
  failures: QAFailure[],
): void {
  const ticker = report.tickers[0]!;
  const insight = canonicalPackage.insights[ticker];
  if (!insight) return;
  const company = canonicalPackage.reportModel.companiesByTicker.get(ticker);
  if (!company) return;

  for (const [name, metric] of Object.entries(insight.keyMetrics)) {
    const row = company.metricsByLabel.get(name);
    if (!row) {
      if (REQUIRED_DASHBOARD_METRICS.has(name)) {
        pushFailure(failures, 'data.cross_section_equality', `dashboard:${name}`, 'Required canonical metric is missing from dashboard output.');
      }
      continue;
    }

    if (isUnavailableDisplay(row.currentDisplay) && metric.current !== null) {
      pushFailure(failures, 'data.no_fake_na', `dashboard:${name}`, 'Current value is N/A in dashboard but computable in canonical metrics.');
    }

    if (isUnavailableDisplay(row.priorDisplay) && metric.prior !== null) {
      pushFailure(failures, 'data.no_fake_na', `dashboard:${name}`, 'Prior value is N/A in dashboard but computable in canonical metrics.');
    }
  }

  const periodValues = buildPeriodValueMap(context, ticker);
  const current = insight.snapshotPeriod;
  const prior = insight.priorPeriod;
  if (!current) return;

  for (const [metricName, deps] of Object.entries(METRIC_DEPENDENCIES)) {
    const m = insight.keyMetrics[metricName];
    const currentBucket = periodValues.get(current) || {};
    const canonicalMetric = company.allMetricsByLabel.get(metricName) || company.metricsByLabel.get(metricName);
    if (!m && shouldRequireMetricPresence(metricName, canonicalMetric?.availability.current, currentBucket, deps)) {
      pushFailure(failures, 'data.no_fake_na', `metric:${metricName}`, 'Metric missing despite all current-period inputs existing.');
    }

    if (!prior) continue;
    const priorBucket = periodValues.get(prior) || {};
    if (m && m.prior === null && shouldRequireMetricPresence(metricName, canonicalMetric?.availability.prior, priorBucket, deps)) {
      pushFailure(failures, 'data.no_fake_na', `metric:${metricName}`, 'Prior metric value is missing despite all prior-period inputs existing.');
    }
  }
}

function runComparisonReportCrossSectionGates(
  report: Report,
  context: AnalysisContext,
  canonicalPackage: CanonicalReportPackage,
  failures: QAFailure[],
): void {
  const insights = canonicalPackage.insights;
  const reportModel = canonicalPackage.reportModel;
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
    pushFailure(failures, 'data.period_coherence', 'comparison:policy', comparisonBasis?.fallback_reason
        ? `Institutional comparison mode requires overlap-normalized periods, but ${comparisonBasis.fallback_reason}`
        : 'Institutional comparison mode requires overlap-normalized periods, but no governed shared annual basis was available across all peers.');
  }
  if (policy?.comparisonRequireOverlap && missingSnapshotPeriods.length > 0) {
    pushFailure(failures, 'data.period_coherence', 'comparison:policy', `Institutional comparison mode requires shared current periods, but no snapshot period was locked for ${missingSnapshotPeriods.join(', ')}.`);
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
    pushFailure(failures, 'data.period_coherence', 'comparison:policy', 'Institutional comparison mode requires overlap-normalized periods, but peers are locked to different annual periods.');
  }

  for (const ticker of context.tickers) {
    const insight = insights[ticker];
    const company = reportModel.companiesByTicker.get(ticker);
    if (!insight) continue;
    if (!company) continue;

    for (const [name, metric] of Object.entries(insight.keyMetrics)) {
      const row = company.metricsByLabel.get(name);
      if (!row) {
        if (REQUIRED_DASHBOARD_METRICS.has(name)) {
          pushFailure(failures, 'data.cross_section_equality', `comparison:${ticker}:${name}`, 'Required canonical metric is missing from comparison output.');
        }
        continue;
      }

      if (isUnavailableDisplay(row.currentDisplay) && metric.current !== null) {
        pushFailure(failures, 'data.no_fake_na', `comparison:${ticker}:${name}`, 'Current value is N/A in comparison output but computable in canonical metrics.');
      }
    }

    const current = insight.snapshotPeriod;
    if (!current) continue;
    const periodValues = buildPeriodValueMap(context, ticker);
    const currentBucket = periodValues.get(current) || {};
    for (const [metricName, deps] of Object.entries(METRIC_DEPENDENCIES)) {
      const m = insight.keyMetrics[metricName];
      const canonicalMetric = company.allMetricsByLabel.get(metricName) || company.metricsByLabel.get(metricName);
      if (!m && shouldRequireMetricPresence(metricName, canonicalMetric?.availability.current, currentBucket, deps)) {
        pushFailure(failures, 'data.no_fake_na', `comparison:${ticker}:${metricName}`, 'Metric missing despite all current-period inputs existing.');
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
  const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
  const current = periodMap.get(insight.snapshotPeriod) || {};
  const currentSources = sourceMap.get(insight.snapshotPeriod) || {};
  const prior = insight.priorPeriod ? (periodMap.get(insight.priorPeriod) || {}) : {};

  const assets = finite(current['total_assets']);
  const liabilities = finite(current['total_liabilities']);
  const equity = finite(current['stockholders_equity']);
  if (assets !== null && liabilities !== null && equity !== null) {
    const gap = Math.abs(assets - (liabilities + equity));
    const tolerance = Math.max(Math.abs(assets) * 0.05, 1_000_000);
    if (gap > tolerance) {
      pushFailure(failures, 'data.sanity', `${ticker}:balance_sheet`, `Assets do not reconcile with liabilities + equity (gap ${gap}).`);
    }
  }

  const cfo = finite(current['operating_cash_flow']);
  const capex = finite(current['capex']);
  const fcf = insight.keyMetrics['Free Cash Flow']?.current ?? null;
  if (cfo !== null && capex !== null && fcf !== null) {
    const expected = cfo - Math.abs(capex);
    if (Math.abs(expected - fcf) > Math.max(Math.abs(expected) * 0.02, 5_000_000)) {
      pushFailure(failures, 'data.sanity', `${ticker}:cash_flow`, `FCF does not reconcile with CFO - CapEx (expected ${expected}, got ${fcf}).`);
    }
  }

  const gp = finite(current['gross_profit']);
  const op = finite(current['operating_income']);
  if (gp !== null && op !== null && gp < op) {
    pushFailure(
      failures,
      'data.mapping_confidence',
      `${ticker}:income_statement`,
      'Gross profit was suppressed from reader-facing profitability metrics because the filing-backed concept fell below operating income and could not be trusted as a clean gross-profit measure.',
    );
  }

  const dna = finite(current['depreciation_and_amortization']);
  const dep = finite(current['depreciation_expense']);
  const amort = finite(current['amortization_expense']);
  if (dna !== null && dep !== null && amort !== null && shouldEnforceDnaReconciliation(currentSources)) {
    const componentSum = dep + amort;
    if (materiallyDiffers(dna, componentSum, 0.1, 50_000)) {
      pushFailure(failures, 'data.sanity', `${ticker}:depreciation_and_amortization`, 'Depreciation & amortization does not reconcile with depreciation + amortization components.');
    }
  }

  // Debt completeness: if components exist, total debt must be resolved.
  const longTermDebt = finite(current['long_term_debt']);
  const shortTermDebt = finite(current['short_term_debt']);
  const totalDebt = finite(current['total_debt']);
  const totalDebtSource = currentSources['total_debt'];
  const debtConflictSuppressed = totalDebt === null
    && totalDebtSource?.kind === 'unknown'
    && /suppressed/i.test(totalDebtSource.detail || '');
  if ((longTermDebt !== null || shortTermDebt !== null) && totalDebt === null && !debtConflictSuppressed) {
    pushFailure(failures, 'data.no_fake_na', `${ticker}:total_debt`, 'Total Debt is missing even though long-term or short-term debt is present.');
  }
  if (
    totalDebt !== null
    && (
      (longTermDebt !== null && totalDebt + 1_000_000 < longTermDebt)
      || (shortTermDebt !== null && totalDebt + 1_000_000 < shortTermDebt)
    )
  ) {
    pushFailure(failures, 'data.sanity', `${ticker}:total_debt`, 'Total Debt is lower than a reported debt component, so the debt concept set is internally inconsistent.');
  }

  // Cash-flow sign conventions for explicit outflow lines.
  for (const outflowMetric of ['capex', 'dividends_paid', 'share_repurchases'] as const) {
    const currentValue = finite(current[outflowMetric]);
    if (currentValue !== null && currentValue > 0) {
      pushFailure(failures, 'data.sanity', `${ticker}:${outflowMetric}`, `${outflowMetric} is positive; outflows must be negative or parenthesized.`);
    }
    const priorValue = finite(prior[outflowMetric]);
    if (priorValue !== null && priorValue > 0) {
      pushFailure(failures, 'data.sanity', `${ticker}:${outflowMetric}:prior`, `${outflowMetric} prior is positive; outflows must be negative or parenthesized.`);
    }
  }

  // NOTE: pretax_income ≈ net_income + income_tax_expense is NOT enforced here
  // as a QA gate. Unlike the balance sheet identity (A = L + E), this relationship
  // breaks legitimately due to minority interests, discontinued operations,
  // preferred dividends, etc. It is flagged as an informational red flag in
  // analyzer.ts runSanityChecks() instead.

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
      pushFailure(failures, 'data.sanity', `${ticker}:shares_outstanding`, `Shares outstanding changed by >= ${SHARE_CHANGE_ALERT_THRESHOLD.toFixed(1)}x without filing-text evidence or weighted-share corroboration.`);
    }
  }

  if (hasShareJump || hasBasisGap) {
    const reportText = report.sections.map(section => section.content).join('\n');
    const hasWeightedAverageLabel = /weighted[-\s]?average/i.test(reportText);
    const hasPeriodEndLabel = /period[-\s]?end shares?/i.test(reportText);
    if (!hasWeightedAverageLabel || !hasPeriodEndLabel) {
      pushFailure(failures, 'data.sanity', `${ticker}:share_basis`, 'Per-share basis labeling is missing; EPS must state weighted-average shares and BVPS must state period-end shares.');
    }
  }
}

function runNarrativeGates(
  report: Report,
  context: AnalysisContext,
  insights: InsightsMap,
  canonicalPackage: CanonicalReportPackage,
  failures: QAFailure[],
): void {
  const fillerPatterns = [
    /\btop-line momentum\b/i,
    /\bbroad-based operational momentum\b/i,
    /\bhas trended upward\b/i,
    /\bhas trended downward\b/i,
    /\bindicates pricing power\b/i,
    /\b[a-z]+(?:_[a-z0-9]+)+\b/,
  ];

  if (report.narrative?.sections) {
    const validFactIds = new Set<string>();
    const sectionContentById = new Map(report.sections.map(section => [section.id, section.content.trim()]));
    const seenParagraphs = new Set<string>();
    for (const insight of Object.values(insights)) {
      for (const factId of Object.keys(insight.canonicalFacts || {})) validFactIds.add(factId);
    }
    for (const company of canonicalPackage.reportModel.companies) {
      for (const metricKey of company.metricsByKey.keys()) validFactIds.add(metricKey);
      for (const periodValues of company.canonicalPeriodMap.values()) {
        for (const factId of Object.keys(periodValues)) validFactIds.add(factId);
      }
    }
    for (const section of report.narrative.sections) {
      const rendered = section.rendered_content?.trim();
      const actual = sectionContentById.get(section.id) || '';
      if (!rendered) {
        pushFailure(failures, 'narrative.threshold_alignment', `narrative:${section.id}`, 'Structured narrative section is missing rendered_content.');
      } else if (rendered !== actual) {
        pushFailure(failures, 'narrative.threshold_alignment', `narrative:${section.id}`, 'Structured narrative rendered_content does not match the rendered report section.');
      }
      for (const paragraph of section.paragraphs) {
        if (!paragraph.text.trim()) {
          pushFailure(failures, 'narrative.threshold_alignment', `narrative:${section.id}`, 'Structured narrative contains an empty paragraph.');
          continue;
        }
        if (/^#{1,6}\s|^[-*]\s|^\d+\.\s/.test(paragraph.text.trim())) {
          pushFailure(failures, 'narrative.style_quality', `narrative:${section.id}`, 'Structured narrative paragraph is still formatted like a heading or bullet rather than prose.');
        }
        if (paragraph.text.trim().length < 40) {
          pushFailure(failures, 'narrative.style_quality', `narrative:${section.id}`, 'Structured narrative paragraph is too short to read like analyst prose.');
        }
        if (!/[.!?]$/.test(paragraph.text.trim())) {
          pushFailure(failures, 'narrative.style_quality', `narrative:${section.id}`, 'Structured narrative paragraph is not written as a complete sentence.');
        }
        if (fillerPatterns.some(pattern => pattern.test(paragraph.text))) {
          pushFailure(failures, 'narrative.style_quality', `narrative:${section.id}`, 'Structured narrative contains filler language rather than specific analytical prose.');
        }
        if (paragraph.fact_ids.length === 0) {
          pushFailure(failures, 'narrative.threshold_alignment', `narrative:${section.id}`, 'Structured narrative paragraph has no fact bindings.');
          continue;
        }
        const invalid = paragraph.fact_ids.filter(factId => !validFactIds.has(factId));
        if (invalid.length > 0) {
          pushFailure(failures, 'narrative.threshold_alignment', `narrative:${section.id}`, `Structured narrative references unsupported fact ids: ${invalid.join(', ')}.`);
        }
        const paragraphKey = paragraph.text.trim().toLowerCase().replace(/\s+/g, ' ');
        if (seenParagraphs.has(paragraphKey)) {
          pushFailure(failures, 'narrative.style_quality', `narrative:${section.id}`, 'Structured narrative repeats the same paragraph content across sections.');
        } else {
          seenParagraphs.add(paragraphKey);
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
    pushFailure(failures, 'narrative.templated_repetition', 'narrative', 'Detected templated repetition pattern ("X X is currently").');
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
      pushFailure(failures, 'narrative.threshold_alignment', 'narrative', 'Narrative claims strong liquidity but current ratio threshold is not met.');
    }
    if (
      /strong liquidity|conservatively positioned|significant strategic flexibility/.test(low)
      && ((operatingCashFlow !== null && operatingCashFlow < 0) || (freeCashFlow !== null && freeCashFlow < 0))
    ) {
      pushFailure(failures, 'narrative.threshold_alignment', 'narrative', 'Narrative presents balance-sheet strength without acknowledging negative operating or free cash flow.');
    }
    if ((/high leverage|elevated leverage/.test(low)) && (leverageMagnitude === null || leverageMagnitude < 2)) {
      pushFailure(failures, 'narrative.threshold_alignment', 'narrative', 'Narrative claims high leverage but debt-to-equity is below threshold.');
    }
    if (/conservative leverage/.test(low) && (leverageMagnitude === null || leverageMagnitude > 1)) {
      pushFailure(failures, 'narrative.threshold_alignment', 'narrative', 'Narrative claims conservative leverage but debt-to-equity is above threshold.');
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
    pushFailure(failures, 'narrative.threshold_alignment', 'comparison:narrative', 'Peer leverage ranking is claimed even though one or more peers have no debt-to-equity value.');
  }

  const periods = context.tickers.map(ticker => insights[ticker]?.snapshotPeriod ?? null).filter(Boolean);
  const distinctPeriods = new Set(periods);
  if (
    /same reported annual period|figures are aligned to the same reported annual period/i.test(low)
    && distinctPeriods.size > 1
  ) {
    pushFailure(failures, 'narrative.threshold_alignment', 'comparison:narrative', 'Narrative claims synchronized peer periods even though locked annual periods differ.');
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

function shouldRequireMetricPresence(
  metricName: string,
  availability: MetricAvailabilityReasonCode | undefined,
  values: Record<string, number>,
  deps: string[],
): boolean {
  if (availabilityRequiresRenderedValue(availability)) {
    return true;
  }
  if (availability && availabilityDoesNotRequireValue(availability)) {
    return false;
  }
  return hasDependencies(values, deps) && metricFormulaIsDefined(metricName, values);
}

function availabilityRequiresRenderedValue(
  availability: MetricAvailabilityReasonCode | undefined,
): boolean {
  return availability === 'reported' || availability === 'derived';
}

function availabilityDoesNotRequireValue(
  availability: MetricAvailabilityReasonCode,
): boolean {
  switch (availability) {
    case 'intentionally_suppressed':
    case 'ratio_fallback':
    case 'missing_inputs':
    case 'policy_disallowed':
    case 'sanity_excluded':
    case 'basis_conflict':
    case 'comparability_policy':
    case 'source_unavailable':
    case 'statement_gap':
      return true;
    case 'reported':
    case 'derived':
    default:
      return false;
  }
}

function metricFormulaIsDefined(
  metricName: string,
  values: Record<string, number>,
): boolean {
  const revenue = finite(values['revenue']);
  const equity = finite(values['stockholders_equity']);
  const assets = finite(values['total_assets']);
  const currentLiabilities = finite(values['current_liabilities']);
  const dilutedShares = finite(values['weighted_avg_shares_diluted']) ?? finite(values['shares_outstanding']);

  switch (metricName) {
    case 'Gross Margin':
    case 'Operating Margin':
    case 'Net Margin':
      return revenue !== null && revenue !== 0;
    case 'Debt-to-Equity':
      return equity !== null && equity !== 0;
    case 'Current Ratio':
      return currentLiabilities !== null && currentLiabilities !== 0;
    case 'Quick Ratio':
      return currentLiabilities !== null && currentLiabilities !== 0 && finite(values['inventory']) !== null;
    case 'Earnings Per Share (Diluted)':
    case 'Book Value Per Share':
      return dilutedShares !== null && dilutedShares !== 0;
    case 'Return on Equity':
      return equity !== null && equity !== 0;
    case 'Return on Assets':
    case 'Asset Turnover':
      return assets !== null && assets !== 0;
    default:
      return true;
  }
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

function shouldEnforceDnaReconciliation(sources: Record<string, CanonicalFactSource>): boolean {
  const kinds = [
    sources['depreciation_and_amortization']?.kind,
    sources['depreciation_expense']?.kind,
    sources['amortization_expense']?.kind,
  ].filter((kind): kind is CanonicalFactSource['kind'] => !!kind);
  if (kinds.length === 0) return false;
  return kinds.some(kind => kind === 'derived' || kind === 'adjusted');
}

function requiredSectionIds(reportType: AnalysisType): readonly string[] {
  return reportType === 'comparison'
    ? REQUIRED_COMPARISON_SECTIONS
    : REQUIRED_SINGLE_SECTIONS;
}

function hasValidMarkdownTable(section: ReportSection): boolean {
  const lines = normalizeMissingDataMarkdown(section.content).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]!.trim();
    if (line.includes('|') && line.split('|').length >= 3) {
      if (nextLine.includes('|') && /[-:]{3,}/.test(nextLine)) {
        return true;
      }
    }
  }
  return false;
}

function hasDataSourceReference(section: ReportSection): boolean {
  const content = section.content;
  return /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/i.test(content) || /SEC EDGAR/i.test(content);
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
      const prefix = f.severity === 'error' ? '[ERROR]' : '[WARNING]';
      lines.push(`- ${prefix} [${f.gate}] ${f.source}: ${f.message}`);
    }
  }

  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}
