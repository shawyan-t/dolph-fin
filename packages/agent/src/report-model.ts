import type {
  AnalysisContext,
  ComparisonBasisResolution,
  FinancialStatement,
  MetricAvailabilityReasonCode,
  MetricBasisUsage,
  ReportingPolicy,
} from '@dolph/shared';
import {
  formatCompactCurrency,
  formatCompactShares,
  formatFiscalPeriodLabel,
  formatMetricChange,
  getMappingByName,
  getMappingsForStatement,
} from '@dolph/shared';
import type { AnalysisInsights, LedgerMetric } from './analyzer.js';
import {
  buildCanonicalAnnualPeriodMap,
  buildCanonicalAnnualSourceMap,
  normalizeMetricValue,
  type CanonicalFactSource,
} from './report-facts.js';
import { INSTITUTIONAL_DEFAULTS } from './report-policy.js';

export interface CanonicalMetricCell {
  key: string;
  label: string;
  unit: string;
  current: number | null;
  prior: number | null;
  change: number | null;
  currentDisplay: string;
  priorDisplay: string;
  changeDisplay: string;
  availability: {
    current: MetricAvailabilityReasonCode;
    prior: MetricAvailabilityReasonCode;
  };
  basis?: MetricBasisUsage;
  note?: string;
}

export interface CanonicalMetricGroup {
  title: string;
  rows: CanonicalMetricCell[];
}

export interface CanonicalStatementRow {
  key: string;
  label: string;
  values: Array<number | null>;
  displays: string[];
  sourceKinds: string[];
}

export interface CanonicalStatementTable {
  statementType: FinancialStatement['statement_type'];
  title: string;
  periods: string[];
  periodLabels: string[];
  rows: CanonicalStatementRow[];
}

export interface CanonicalFilingReference {
  accessionNumber: string | null;
  form: string | null;
  filed: string | null;
  url: string | null;
  metrics: string[];
  periods: string[];
  sourceKinds: string[];
}

export interface CanonicalAlignedFiling {
  accessionNumber: string;
  documentUrl: string;
  form: string | null;
  filed: string | null;
  period: string;
}

export interface CompanyReportModel {
  ticker: string;
  companyName: string;
  policy: ReportingPolicy;
  fxNote: string | null;
  snapshotPeriod: string | null;
  priorPeriod: string | null;
  periodNote: string | null;
  snapshotLabel: string;
  priorLabel: string;
  metrics: CanonicalMetricCell[];
  metricsByLabel: Map<string, CanonicalMetricCell>;
  dashboardGroups: CanonicalMetricGroup[];
  comparisonGroups: CanonicalMetricGroup[];
  statementTables: CanonicalStatementTable[];
  canonicalPeriodMap: Map<string, Record<string, number>>;
  sourceMap: Map<string, Record<string, CanonicalFactSource>>;
  filingReferences: CanonicalFilingReference[];
  alignedFiling: CanonicalAlignedFiling | null;
}

export interface ReportModel {
  type: 'single' | 'comparison';
  comparisonBasis: ComparisonBasisResolution | null;
  companies: CompanyReportModel[];
  companiesByTicker: Map<string, CompanyReportModel>;
}

const METRIC_GROUPS: Array<{ title: string; metrics: string[] }> = [
  {
    title: 'Profitability',
    metrics: [
      'Gross Profit',
      'Return on Equity',
      'Return on Assets',
      'Gross Margin',
      'Operating Margin',
      'Net Margin',
      'Earnings Per Share (Diluted)',
    ],
  },
  {
    title: 'Liquidity & Leverage',
    metrics: [
      'Current Assets',
      'Current Liabilities',
      'Cash & Equivalents',
      'Long-Term Debt',
      'Short-Term Debt',
      'Total Debt',
      'Current Ratio',
      'Quick Ratio',
      'Debt-to-Equity',
    ],
  },
  {
    title: 'Scale',
    metrics: [
      'Revenue',
      'Gross Profit',
      'Operating Income',
      'Net Income',
      'Total Assets',
      'Total Liabilities',
      "Stockholders' Equity",
      'Shares Outstanding',
    ],
  },
  {
    title: 'Cash Flow & Per Share',
    metrics: [
      'Operating Cash Flow',
      'Capital Expenditures',
      'Free Cash Flow',
      'Working Capital',
      'Asset Turnover',
      'Book Value Per Share',
    ],
  },
];

const STATEMENT_DEFS: Array<{ type: FinancialStatement['statement_type']; title: string }> = [
  { type: 'income', title: 'Income Statement' },
  { type: 'balance_sheet', title: 'Balance Sheet' },
  { type: 'cash_flow', title: 'Cash Flow Statement' },
];

const CORE_FILING_METRICS = [
  'revenue',
  'net_income',
  'operating_income',
  'operating_cash_flow',
  'total_assets',
  'stockholders_equity',
];

const CONTRA_ACCOUNT_METRICS = new Set([
  'treasury_stock',
]);

const DEFAULT_REPORT_MODEL_POLICY: ReportingPolicy = { ...INSTITUTIONAL_DEFAULTS };

export function buildReportModel(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): ReportModel {
  const companies = context.tickers.map(ticker => buildCompanyReportModel(context, insights, ticker));
  return {
    type: context.type,
    comparisonBasis: context.comparison_basis || null,
    companies,
    companiesByTicker: new Map(companies.map(company => [company.ticker, company])),
  };
}

export function buildCompanyReportModel(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  ticker: string,
): CompanyReportModel {
  const insight = insights[ticker];
  const canonicalPeriodMap = buildCanonicalAnnualPeriodMap(context, ticker);
  const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
  const metricCells = buildMetricCells(insight);
  const dashboardGroups = buildMetricGroups(metricCells);
  const comparisonGroups = buildComparisonGroups(metricCells);
  const statementTables = buildStatementTables(context, ticker, insight, canonicalPeriodMap, sourceMap);
  const filingReferences = collectFilingReferences(
    context,
    ticker,
    sourceMap,
    selectedPeriodsForSources(statementTables, insight?.snapshotPeriod, insight?.priorPeriod),
  );

  return {
    ticker,
    companyName: context.facts[ticker]?.company_name || ticker,
    policy: context.policy || DEFAULT_REPORT_MODEL_POLICY,
    fxNote: context.facts[ticker]?.fx_note || null,
    snapshotPeriod: insight?.snapshotPeriod ?? null,
    priorPeriod: insight?.priorPeriod ?? null,
    periodNote: insight?.periodBasis?.note || null,
    snapshotLabel: insight?.snapshotPeriod ? formatFiscalPeriodLabel(insight.snapshotPeriod) : 'N/A',
    priorLabel: insight?.priorPeriod ? formatFiscalPeriodLabel(insight.priorPeriod) : 'N/A',
    metrics: metricCells,
    metricsByLabel: new Map(metricCells.map(metric => [metric.label, metric])),
    dashboardGroups,
    comparisonGroups,
    statementTables,
    canonicalPeriodMap,
    sourceMap,
    filingReferences,
    alignedFiling: selectAlignedFiling(context, ticker, sourceMap, insight?.snapshotPeriod ?? null),
  };
}

function buildMetricCells(insight?: AnalysisInsights): CanonicalMetricCell[] {
  if (!insight) return [];
  return Object.values(insight.canonicalFacts || {})
    .map(metric => ({
      key: metric.key,
      label: metric.displayName,
      unit: metric.unit,
      current: metric.current,
      prior: metric.prior,
      change: metric.change,
      currentDisplay: metric.current !== null
        ? formatMetricValue(metric.current, metric.unit)
        : formatMetricUnavailable(metric.availability.current),
      priorDisplay: metric.prior !== null
        ? formatMetricValue(metric.prior, metric.unit)
        : formatMetricUnavailable(metric.availability.prior),
      changeDisplay: formatMetricChangeDisplay(metric),
      availability: metric.availability,
      basis: metric.basis,
      note: metric.note,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildMetricGroups(metricCells: CanonicalMetricCell[]): CanonicalMetricGroup[] {
  const used = new Set<string>();
  const metricMap = new Map(metricCells.map(metric => [metric.label, metric]));

  const groups = METRIC_GROUPS.map(group => {
    const rows = group.metrics
      .map(name => metricMap.get(name) || null)
      .filter((metric): metric is CanonicalMetricCell => !!metric && metric.current !== null);
    for (const row of rows) used.add(row.label);
    return { title: group.title, rows };
  });

  const extras = metricCells
    .filter(metric => !used.has(metric.label) && metric.current !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (extras.length >= 3) {
    groups.push({ title: 'Additional Metrics', rows: extras });
  }

  return groups.filter(group => group.rows.length > 0);
}

function buildComparisonGroups(metricCells: CanonicalMetricCell[]): CanonicalMetricGroup[] {
  return buildMetricGroups(metricCells).map(group => ({
    title: group.title,
    rows: group.rows.filter(row => row.current !== null),
  })).filter(group => group.rows.length > 0);
}

function buildStatementTables(
  context: AnalysisContext,
  ticker: string,
  insight: AnalysisInsights | undefined,
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
): CanonicalStatementTable[] {
  const statementTables: CanonicalStatementTable[] = [];

  for (const def of STATEMENT_DEFS) {
    const table = buildStatementTable(context, ticker, def.type, def.title, insight, canonicalPeriodMap, sourceMap);
    if (table) statementTables.push(table);
  }

  return statementTables;
}

function buildStatementTable(
  context: AnalysisContext,
  ticker: string,
  statementType: FinancialStatement['statement_type'],
  title: string,
  insight: AnalysisInsights | undefined,
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
): CanonicalStatementTable | null {
  const periods = selectStatementPeriods(canonicalPeriodMap, insight?.snapshotPeriod ?? null, insight?.priorPeriod ?? null);
  if (periods.length === 0) return null;

  const statement = (context.statements[ticker] || []).find(s => s.statement_type === statementType);
  const statementData = new Map<string, Record<string, number>>();
  for (const period of statement?.periods || []) {
    statementData.set(period.period, period.data);
  }

  const orderedKeys = new Set<string>();
  for (const mapping of getMappingsForStatement(statementType)) {
    if (periods.some(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, statementData, period, mapping.standardName) !== null)) {
      orderedKeys.add(mapping.standardName);
    }
  }

  for (const period of periods) {
    const row = statementData.get(period);
    if (!row) continue;
    for (const metric of Object.keys(row)) {
      if (periods.some(selected => getStatementMetricValue(canonicalPeriodMap, sourceMap, statementData, selected, metric) !== null)) {
        orderedKeys.add(metric);
      }
    }
  }

  const rows: CanonicalStatementRow[] = [];
  for (const key of orderedKeys) {
    const mapping = getMappingByName(key);
    const values = periods.map(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, statementData, period, key));
    if (values.every(value => value === null)) continue;
    const sourceKinds = periods
      .map(period => sourceKindLabel(canonicalPeriodMap, sourceMap, statementData, period, key))
      .filter((kind): kind is string => !!kind);
    if (sourceKinds.length > 0 && sourceKinds.every(kind => kind === 'derived')) continue;
    rows.push({
      key,
      label: decorateStatementLabel(key, mapping?.displayName || humanizeMetricKey(key), sourceKinds),
      values,
      displays: values.map(value => value === null ? 'Not reported' : formatStatementValue(key, value, mapping?.unit)),
      sourceKinds,
    });
  }

  if (rows.length === 0) return null;

  return {
    statementType,
    title,
    periods,
    periodLabels: periods.map(period => formatFiscalPeriodLabel(period)),
    rows,
  };
}

function getStatementMetricValue(
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  statementData: Map<string, Record<string, number>>,
  period: string,
  metric: string,
): number | null {
  const source = sourceMap.get(period)?.[metric];
  const canonical = canonicalPeriodMap.get(period)?.[metric];
  if (source?.kind === 'adjusted' && canonical !== undefined && isFinite(canonical)) return canonical;

  const raw = statementData.get(period)?.[metric];
  if (raw !== undefined && raw !== null && isFinite(raw)) return normalizeMetricValue(metric, raw);

  if ((source?.kind === 'xbrl' || source?.kind === 'statement') && canonical !== undefined && isFinite(canonical)) {
    return canonical;
  }
  return null;
}

function sourceKindLabel(
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  statementData: Map<string, Record<string, number>>,
  period: string,
  metric: string,
): string | null {
  const source = sourceMap.get(period)?.[metric];
  if (source?.kind === 'adjusted' && canonicalPeriodMap.get(period)?.[metric] !== undefined) {
    return 'adjusted';
  }
  if (statementData.get(period)?.[metric] !== undefined) return 'statement';
  if (canonicalPeriodMap.get(period)?.[metric] !== undefined) {
    if (source?.kind) return source.kind;
  }
  return null;
}

function selectStatementPeriods(
  canonicalPeriodMap: Map<string, Record<string, number>>,
  snapshotPeriod: string | null,
  priorPeriod: string | null,
): string[] {
  const all = Array.from(canonicalPeriodMap.keys()).sort((a, b) => b.localeCompare(a));
  const chosen: string[] = [];
  if (snapshotPeriod && canonicalPeriodMap.has(snapshotPeriod)) chosen.push(snapshotPeriod);
  if (priorPeriod && canonicalPeriodMap.has(priorPeriod) && !chosen.includes(priorPeriod)) chosen.push(priorPeriod);
  for (const period of all) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(period)) chosen.push(period);
  }
  return chosen.slice(0, 3);
}

function selectedPeriodsForSources(
  statementTables: CanonicalStatementTable[],
  snapshotPeriod: string | null,
  priorPeriod: string | null,
): string[] {
  const periods = new Set<string>();
  if (snapshotPeriod) periods.add(snapshotPeriod);
  if (priorPeriod) periods.add(priorPeriod);
  for (const table of statementTables) {
    for (const period of table.periods) {
      periods.add(period);
    }
  }
  return Array.from(periods);
}

function collectFilingReferences(
  context: AnalysisContext,
  ticker: string,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  periods: string[],
): CanonicalFilingReference[] {
  const refs = new Map<string, CanonicalFilingReference>();

  for (const period of periods) {
    const bucket = sourceMap.get(period) || {};
    for (const [metric, source] of Object.entries(bucket)) {
      const accession = source.provenance?.accession_number || source.provenance?.filing_url || `${source.kind}:${period}`;
      const existing = refs.get(accession);
      if (existing) {
        if (!existing.metrics.includes(metric)) existing.metrics.push(metric);
        if (!existing.periods.includes(period)) existing.periods.push(period);
        if (source.kind && !existing.sourceKinds.includes(source.kind)) existing.sourceKinds.push(source.kind);
        continue;
      }
      refs.set(accession, {
        accessionNumber: source.provenance?.accession_number || null,
        form: source.form || null,
        filed: source.filed || null,
        url: resolvePrimaryDocumentUrl(context, ticker, source.provenance?.accession_number || null, source.provenance?.filing_url || null),
        metrics: [metric],
        periods: [period],
        sourceKinds: [source.kind],
      });
    }
  }

  return Array.from(refs.values())
    .filter(ref => !!ref.url || ref.sourceKinds.includes('statement'))
    .sort((a, b) => (b.filed || '').localeCompare(a.filed || ''));
}

function selectAlignedFiling(
  context: AnalysisContext,
  ticker: string,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  snapshotPeriod: string | null,
): CanonicalAlignedFiling | null {
  if (!snapshotPeriod) return null;
  const bucket = sourceMap.get(snapshotPeriod);
  if (!bucket) return null;

  const accessionCounts = new Map<string, { count: number; source: CanonicalFactSource }>();
  for (const metric of CORE_FILING_METRICS) {
    const source = bucket[metric];
    const accession = source?.provenance?.accession_number;
    const filingUrl = source?.provenance?.filing_url;
    if (!source || !accession || !filingUrl) continue;
    const current = accessionCounts.get(accession);
    if (current) {
      current.count += 1;
      continue;
    }
    accessionCounts.set(accession, { count: 1, source });
  }

  const ranked = Array.from(accessionCounts.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.source.filed || '').localeCompare(a.source.filed || '');
  });
  const best = ranked[0]?.source;
  if (!best?.provenance?.accession_number || !best.provenance.filing_url) return null;

  return {
    accessionNumber: best.provenance.accession_number,
    documentUrl: resolvePrimaryDocumentUrl(context, ticker, best.provenance.accession_number, best.provenance.filing_url)!,
    form: best.form || null,
    filed: best.filed || null,
    period: snapshotPeriod,
  };
}

function resolvePrimaryDocumentUrl(
  context: AnalysisContext,
  ticker: string,
  accessionNumber: string | null,
  fallbackUrl: string | null,
): string | null {
  if (accessionNumber) {
    const filing = (context.filings[ticker] || []).find(item => item.accession_number === accessionNumber);
    if (filing?.primary_document_url) return filing.primary_document_url;
  }
  return fallbackUrl;
}

function humanizeMetricKey(metric: string): string {
  return metric
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function decorateStatementLabel(key: string, label: string, sourceKinds: string[]): string {
  const unique = Array.from(new Set(sourceKinds));
  const baseLabel = key === 'cash_ending'
    ? `${label} (cash-flow statement)`
    : label;
  if (unique.length === 0) return baseLabel;
  if (unique.every(kind => kind === 'derived')) return `${baseLabel} (derived)`;
  if (unique.every(kind => kind === 'adjusted')) return `${baseLabel} (split-adjusted)`;
  if (unique.includes('adjusted')) return `${baseLabel} (reported/split-adjusted)`;
  if (unique.includes('derived')) return `${baseLabel} (reported/reconciled)`;
  return baseLabel;
}

export function formatMetricValue(value: number, unit: string): string {
  if (!isFinite(value)) return 'N/A';
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'USD') return formatCompactCurrency(value, { smallDecimals: 0, smartDecimals: true });
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${value.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(value);
  return `${value}`;
}

function formatMetricUnavailable(reason: MetricAvailabilityReasonCode): string {
  switch (reason) {
    case 'comparability_policy':
    case 'policy_disallowed':
      return 'Policy-excluded';
    case 'basis_conflict':
      return 'Basis conflict';
    case 'sanity_excluded':
      return 'QA-excluded';
    case 'statement_gap':
      return 'Statement gap';
    case 'missing_inputs':
    case 'source_unavailable':
      return 'Unavailable';
    case 'ratio_fallback':
      return 'Derived unavailable';
    case 'reported':
    case 'derived':
    default:
      return 'Unavailable';
  }
}

function formatMetricChangeDisplay(metric: LedgerMetric): string {
  if (metric.current !== null && metric.prior !== null) {
    return formatMetricChange(metric.change, metric.current, metric.prior);
  }
  const currentReason = metric.availability.current;
  const priorReason = metric.availability.prior;
  if (currentReason === 'comparability_policy' || priorReason === 'comparability_policy') {
    return 'Policy-excluded';
  }
  if (currentReason === 'basis_conflict' || priorReason === 'basis_conflict') {
    return 'Basis conflict';
  }
  if (currentReason === 'sanity_excluded' || priorReason === 'sanity_excluded') {
    return 'QA-excluded';
  }
  return 'Unavailable';
}

export function formatByUnit(value: number, unit?: string): string {
  if (!isFinite(value)) return 'N/A';
  switch (unit) {
    case 'USD':
      return formatCompactCurrency(value, { smallDecimals: 0, smartDecimals: true });
    case 'USD/share':
    case 'USD/shares':
      return `$${value.toFixed(2)}`;
    case 'shares':
      return formatCompactShares(value);
    case 'pure':
      return `${value.toFixed(2)}x`;
    default:
      return formatCompactCurrency(value, { smallDecimals: 0, smartDecimals: true });
  }
}

function formatStatementValue(metric: string, value: number, unit?: string): string {
  if (CONTRA_ACCOUNT_METRICS.has(metric)) {
    return formatByUnit(-Math.abs(value), unit);
  }
  return formatByUnit(value, unit);
}
