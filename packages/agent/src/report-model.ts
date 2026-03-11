import type {
  AnalysisContext,
  ComparisonBasisResolution,
  FinancialStatement,
  MetricAvailabilityReasonCode,
  MetricBasisUsage,
  ReportingPolicy,
} from '@shawyan/shared';
import {
  formatCompactCurrency,
  formatCompactShares,
  formatFiscalPeriodLabel,
  formatMetricChange,
  getMappingByName,
  getMappingsForStatement,
} from '@shawyan/shared';
import type { AnalysisInsights, LedgerMetric } from './analyzer.js';
import {
  buildCanonicalAnnualPeriodMap,
  buildCanonicalAnnualSourceMap,
  hasCashPresentationAlternative,
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

export interface CanonicalMetricGroupContract {
  title: string;
  rowLabels: string[];
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
  metricsByKey: Map<string, CanonicalMetricCell>;
  metricsByLabel: Map<string, CanonicalMetricCell>;
  allMetricsByLabel: Map<string, CanonicalMetricCell>;
  dashboardGroups: CanonicalMetricGroup[];
  comparisonGroups: CanonicalMetricGroup[];
  statementTables: CanonicalStatementTable[];
  appendixSupportNotes: string[];
  canonicalPeriodMap: Map<string, Record<string, number>>;
  sourceMap: Map<string, Record<string, CanonicalFactSource>>;
  filingReferences: CanonicalFilingReference[];
  alignedFiling: CanonicalAlignedFiling | null;
}

export interface ReportModel {
  type: 'single' | 'comparison';
  comparisonBasis: ComparisonBasisResolution | null;
  comparisonRowGroups: CanonicalMetricGroupContract[];
  companies: CompanyReportModel[];
  companiesByTicker: Map<string, CompanyReportModel>;
}

export function collectMetricBasisDisclosures(company: CompanyReportModel): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const metric of company.metrics) {
    const basis = metric.basis;
    if (!basis) continue;
    const text = `${basis.displayName}: ${basis.disclosureText || basis.note || humanizeBasis(basis.basis)}${basis.fallbackUsed ? ' Fallback was applied and is audit-traceable.' : ''}`;
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
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
      'Cash, Cash Equivalents & Restricted Cash',
      'Restricted Cash',
      'Cash, Cash Equivalents & Short-Term Investments',
      'Short-Term Investments',
      'Marketable Securities',
      'Long-Term Debt',
      'Short-Term Debt',
      'Total Debt',
      'Current Ratio',
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
    ],
  },
  {
    title: 'Cash Flow & Per Share',
    metrics: [
      'Operating Cash Flow',
      'Cash at End of Period (cash-flow statement)',
      'Capital Expenditures',
      'Free Cash Flow',
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

const CASH_FAMILY_DUPLICATE_PREFERENCES = [
  {
    primary: 'cash_and_equivalents',
    duplicate: 'cash_and_equivalents_and_restricted_cash',
  },
  {
    primary: 'cash_and_equivalents',
    duplicate: 'cash_and_equivalents_and_short_term_investments',
  },
] as const;

const DEFAULT_REPORT_MODEL_POLICY: ReportingPolicy = { ...INSTITUTIONAL_DEFAULTS };

export function buildReportModel(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): ReportModel {
  const baseCompanies = context.tickers.map(ticker => buildCompanyReportModel(context, insights, ticker));
  const comparisonRowGroups = buildComparisonRowGroups(baseCompanies);
  const companies = baseCompanies.map(company => ({
    ...company,
    comparisonGroups: applyComparisonRowGroups(company, comparisonRowGroups),
  }));
  return {
    type: context.type,
    comparisonBasis: context.comparison_basis || null,
    comparisonRowGroups,
    companies,
    companiesByTicker: new Map(companies.map(company => [company.ticker, company])),
  } satisfies ReportModel;
}

export function buildCompanyReportModel(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  ticker: string,
): CompanyReportModel {
  const insight = insights[ticker];
  const canonicalPeriodMap = buildCanonicalAnnualPeriodMap(context, ticker);
  const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
  const rawMetricCells = buildMetricCells(insight);
  const allMetricsByLabel = new Map(rawMetricCells.map(metric => [metric.label, metric]));
  const metricCells = suppressDuplicateCashFamilyCells(rawMetricCells);
  const dashboardGroups = buildMetricGroups(metricCells);
  const statementTables = buildStatementTables(context, ticker, insight, canonicalPeriodMap, sourceMap);
  const baseCompany = {
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
    metricsByKey: new Map(metricCells.map(metric => [metric.key, metric])),
    metricsByLabel: new Map(metricCells.map(metric => [metric.label, metric])),
    allMetricsByLabel,
    dashboardGroups,
    comparisonGroups: [],
    statementTables,
    appendixSupportNotes: [] as string[],
    canonicalPeriodMap,
    sourceMap,
    filingReferences: [] as CanonicalFilingReference[],
    alignedFiling: selectAlignedFiling(context, ticker, sourceMap, insight?.snapshotPeriod ?? null),
  } satisfies CompanyReportModel;
  const filingReferences = collectFilingReferences(
    context,
    ticker,
    sourceMap,
    selectedPeriodsForSources(insight?.snapshotPeriod ?? null, insight?.priorPeriod ?? null),
  );
  return {
    ...baseCompany,
    appendixSupportNotes: buildAppendixSupportNotes(baseCompany),
    filingReferences,
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

function suppressDuplicateCashFamilyCells(
  metricCells: CanonicalMetricCell[],
): CanonicalMetricCell[] {
  const byKey = new Map(metricCells.map(metric => [metric.key, metric]));
  const suppressed = new Set<string>();

  for (const preference of CASH_FAMILY_DUPLICATE_PREFERENCES) {
    const primary = byKey.get(preference.primary);
    const duplicate = byKey.get(preference.duplicate);
    if (!primary || !duplicate) continue;
    if (cashMetricCellsEquivalent(primary, duplicate)) {
      suppressed.add(duplicate.key);
    }
  }

  return metricCells.filter(metric => !suppressed.has(metric.key));
}

function cashMetricCellsEquivalent(
  left: CanonicalMetricCell,
  right: CanonicalMetricCell,
): boolean {
  const pairs: Array<[number | null, number | null]> = [
    [left.current, right.current],
    [left.prior, right.prior],
  ];
  let compared = 0;
  for (const [a, b] of pairs) {
    if (a === null && b === null) continue;
    if (a === null || b === null) return false;
    compared += 1;
    if (!materiallyEquivalent(a, b)) return false;
  }
  return compared > 0;
}

function materiallyEquivalent(a: number, b: number): boolean {
  const delta = Math.abs(a - b);
  return delta <= Math.max(Math.abs(a), Math.abs(b), 1) * 0.01 + 100_000;
}

function createUnavailableCell(
  label: string,
  reasonCode: MetricAvailabilityReasonCode = 'source_unavailable',
): CanonicalMetricCell {
  return {
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label,
    unit: 'USD',
    current: null,
    prior: null,
    change: null,
    currentDisplay: formatMetricUnavailable(reasonCode),
    priorDisplay: formatMetricUnavailable(reasonCode),
    changeDisplay: formatMetricUnavailable(reasonCode),
    availability: { current: reasonCode, prior: reasonCode },
  };
}

function buildMetricGroups(metricCells: CanonicalMetricCell[]): CanonicalMetricGroup[] {
  const metricMap = new Map(metricCells.map(metric => [metric.label, metric]));
  return metricGroupContract()
    .map(group => ({
      title: group.title,
      rows: group.rowLabels.map(label =>
        metricMap.get(label) || createUnavailableCell(label),
      ),
    }));
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
  _context: AnalysisContext,
  _ticker: string,
  statementType: FinancialStatement['statement_type'],
  title: string,
  insight: AnalysisInsights | undefined,
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
): CanonicalStatementTable | null {
  const periods = selectStatementPeriods(canonicalPeriodMap, insight?.snapshotPeriod ?? null, insight?.priorPeriod ?? null);
  if (periods.length === 0) return null;

  const orderedKeys = new Set<string>();
  for (const mapping of getMappingsForStatement(statementType)) {
    if (periods.some(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, period, mapping.standardName) !== null)) {
      orderedKeys.add(mapping.standardName);
    }
  }

  const rows: CanonicalStatementRow[] = [];
  const currentPeriod = insight?.snapshotPeriod ?? periods[0] ?? null;
  for (const key of orderedKeys) {
    const mapping = getMappingByName(key);
    const values = periods.map(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, period, key));
    if (values.every(value => value === null)) continue;
    if (isDuplicateCashFamilyStatementRow(key, periods, canonicalPeriodMap, sourceMap)) {
      continue;
    }
    if (
      currentPeriod
      && values[0] === null
      && hasCashPresentationAlternative(canonicalPeriodMap.get(currentPeriod), key)
    ) {
      continue;
    }
    const sourceKinds = periods
      .map(period => sourceKindLabel(canonicalPeriodMap, sourceMap, period, key))
      .filter((kind): kind is string => !!kind);
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
  period: string,
  metric: string,
): number | null {
  const source = sourceMap.get(period)?.[metric];
  const canonical = canonicalPeriodMap.get(period)?.[metric];
  if (!source || canonical === undefined || canonical === null || !isFinite(canonical)) return null;
  if (
    source.kind === 'adjusted'
    || source.kind === 'xbrl'
    || source.kind === 'statement'
    || source.kind === 'derived'
  ) {
    return canonical;
  }
  return null;
}

function sourceKindLabel(
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  period: string,
  metric: string,
): string | null {
  const source = sourceMap.get(period)?.[metric];
  if (source?.kind === 'adjusted' && canonicalPeriodMap.get(period)?.[metric] !== undefined) {
    return 'adjusted';
  }
  if (canonicalPeriodMap.get(period)?.[metric] !== undefined) {
    if (source?.kind) return source.kind;
  }
  return null;
}

function isDuplicateCashFamilyStatementRow(
  key: string,
  periods: string[],
  canonicalPeriodMap: Map<string, Record<string, number>>,
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
): boolean {
  const preference = CASH_FAMILY_DUPLICATE_PREFERENCES.find(item => item.duplicate === key);
  if (!preference) return false;

  const candidateValues = periods.map(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, period, key));
  const primaryValues = periods.map(period => getStatementMetricValue(canonicalPeriodMap, sourceMap, period, preference.primary));

  let compared = 0;
  for (let idx = 0; idx < candidateValues.length; idx++) {
    const candidate = candidateValues[idx];
    const primary = primaryValues[idx];
    if (candidate === null && primary === null) continue;
    if (candidate === null || primary === null) return false;
    compared += 1;
    if (!materiallyEquivalent(candidate, primary)) return false;
  }

  return compared > 0;
}

function selectStatementPeriods(
  canonicalPeriodMap: Map<string, Record<string, number>>,
  snapshotPeriod: string | null,
  priorPeriod: string | null,
): string[] {
  const chosen: string[] = [];
  if (snapshotPeriod && canonicalPeriodMap.has(snapshotPeriod)) chosen.push(snapshotPeriod);
  if (priorPeriod && canonicalPeriodMap.has(priorPeriod) && !chosen.includes(priorPeriod)) chosen.push(priorPeriod);
  return chosen.slice(0, 2);
}

function selectedPeriodsForSources(
  snapshotPeriod: string | null,
  priorPeriod: string | null,
): string[] {
  const periods = new Set<string>();
  if (snapshotPeriod) periods.add(snapshotPeriod);
  if (priorPeriod) periods.add(priorPeriod);
  return Array.from(periods);
}

function metricGroupContract(): CanonicalMetricGroupContract[] {
  return METRIC_GROUPS.map(group => ({
    title: group.title,
    rowLabels: [...group.metrics],
  }));
}

function buildComparisonRowGroups(
  _companies: CompanyReportModel[],
): CanonicalMetricGroupContract[] {
  return metricGroupContract();
}

function applyComparisonRowGroups(
  company: CompanyReportModel,
  comparisonRowGroups: CanonicalMetricGroupContract[],
): CanonicalMetricGroup[] {
  return comparisonRowGroups.map(group => ({
    title: group.title,
    rows: group.rowLabels.map(label =>
      company.allMetricsByLabel.get(label) || createUnavailableCell(label),
    ),
  }));
}

function buildAppendixSupportNotes(company: CompanyReportModel): string[] {
  const periods = [company.snapshotLabel, company.priorLabel]
    .filter(label => label && label !== 'N/A')
    .join(' and ');
  const basisNotes = collectMetricBasisDisclosures(company)
    .map(note => `${note.replace(/[.\s]+$/g, '')}.`);

  const notes = [
    periods
      ? `Appendix figures use ${periods}.`
      : 'Appendix figures use the same current and prior annual periods shown in the main report.',
    'Appendix rows follow the standard statement line set used throughout the report.',
    'Cash-family labels follow the filing directly, and the cash-flow ending balance remains separate unless the filing presents the same concept on the balance sheet.',
    'Cells marked "Not reported" mean the filing did not disclose the value for the periods shown and the report does not estimate it.',
    ...basisNotes,
    `Primary filing anchor: ${company.alignedFiling?.form || 'annual filing'}${company.alignedFiling?.filed ? ` filed ${company.alignedFiling.filed}` : ''}.`,
  ];

  if (company.fxNote) {
    notes.push(`FX note: ${company.fxNote}.`);
  }

  return notes;
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

export function resolveAlignedFilingForTicker(
  context: AnalysisContext,
  ticker: string,
  snapshotPeriod: string | null,
): CanonicalAlignedFiling | null {
  const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
  return selectAlignedFiling(context, ticker, sourceMap, snapshotPeriod);
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
      return 'N/A';
    case 'intentionally_suppressed':
      return 'Extraction failure';
    case 'basis_conflict':
      return 'Extraction failure';
    case 'sanity_excluded':
      return 'Extraction failure';
    case 'statement_gap':
      return 'Extraction failure';
    case 'missing_inputs':
      return 'Not reported';
    case 'source_unavailable':
      return 'Not reported';
    case 'ratio_fallback':
      return 'Not reported';
    case 'reported':
    case 'derived':
    default:
      return 'Not reported';
  }
}

function formatMetricChangeDisplay(metric: LedgerMetric): string {
  if (metric.current !== null && metric.prior !== null) {
    return formatMetricChange(metric.change, metric.current, metric.prior);
  }
  const currentReason = metric.availability.current;
  const priorReason = metric.availability.prior;
  if (currentReason === 'comparability_policy' || priorReason === 'comparability_policy') {
    return 'N/A';
  }
  if (currentReason === 'intentionally_suppressed' || priorReason === 'intentionally_suppressed') {
    return 'Extraction failure';
  }
  if (currentReason === 'basis_conflict' || priorReason === 'basis_conflict') {
    return 'Extraction failure';
  }
  if (currentReason === 'sanity_excluded' || priorReason === 'sanity_excluded') {
    return 'Extraction failure';
  }
  if (currentReason === 'statement_gap' || priorReason === 'statement_gap') {
    return 'Extraction failure';
  }
  if (
    currentReason === 'missing_inputs'
    || priorReason === 'missing_inputs'
    || currentReason === 'source_unavailable'
    || priorReason === 'source_unavailable'
    || currentReason === 'ratio_fallback'
    || priorReason === 'ratio_fallback'
  ) {
    return 'Not reported';
  }
  return 'Not reported';
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

function humanizeBasis(basis: string): string {
  return basis.replace(/_/g, ' ');
}
