import type { AnalysisContext, MetricAvailabilityReasonCode } from '@shawyan/shared';
import { getMappingByName } from '@shawyan/shared';
import type { ReportModel } from './report-model.js';

export interface FactDataRow {
  ticker: string;
  cik: string;
  company_name: string;
  metric: string;
  reported_label: string;
  reported_description: string;
  reported_value: number;
  reported_unit: string;
  period: string;
  form: string;
  fiscal_year: string;
  fiscal_period: string;
  filed: string;
  xbrl_tag: string;
  namespace: string;
  selection_policy: string;
  concept_scope: string;
  accession: string;
  filing_url: string;
}

export interface MetricDataRow {
  ticker: string;
  cik: string;
  company_name: string;
  period: string;
  period_role: 'snapshot' | 'prior' | 'historical';
  metric_key: string;
  metric_label: string;
  resolved_value: number | null;
  resolved_unit: string;
  source_kind: string;
  reported_or_derived: 'reported' | 'derived' | 'suppressed' | 'missing';
  availability_reason: MetricAvailabilityReasonCode;
  reported_value: number | null;
  reported_unit: string;
  reported_label: string;
  detail: string;
  form: string;
  filed: string;
  accession: string;
  filing_url: string;
  xbrl_tag: string;
  namespace: string;
}

export interface RatioDataRow {
  ticker: string;
  cik: string;
  company_name: string;
  period: string;
  period_role: 'snapshot' | 'prior' | 'historical';
  ratio_key: string;
  ratio_label: string;
  value: number | null;
  formula: string;
  components: string;
  notes: string;
  availability_reason: MetricAvailabilityReasonCode;
  chart_meaningful: boolean;
  chart_note: string;
}

export interface ReportDataRows {
  facts: FactDataRow[];
  metrics: MetricDataRow[];
  ratios: RatioDataRow[];
}

interface RatioExportDef {
  key: string;
  label: string;
  formula: string;
}

const RATIO_EXPORT_DEFS: RatioExportDef[] = [
  { key: 'gross_margin', label: 'Gross Margin', formula: 'gross_profit / revenue' },
  { key: 'operating_margin', label: 'Operating Margin', formula: 'operating_income / revenue' },
  { key: 'net_margin', label: 'Net Margin', formula: 'net_income / revenue' },
  { key: 'roe', label: 'Return on Equity', formula: 'net_income / equity_basis' },
  { key: 'roa', label: 'Return on Assets', formula: 'net_income / asset_basis' },
  { key: 'current_ratio', label: 'Current Ratio', formula: 'current_assets / current_liabilities' },
  { key: 'quick_ratio', label: 'Quick Ratio', formula: '(current_assets - inventory) / current_liabilities' },
  { key: 'de', label: 'Debt-to-Equity', formula: 'total_debt / stockholders_equity' },
  { key: 'asset_turnover', label: 'Asset Turnover', formula: 'revenue / asset_basis' },
];

export function buildReportDataRows(
  context: AnalysisContext,
  reportModel: ReportModel,
): ReportDataRows {
  return {
    facts: buildFactRows(context),
    metrics: buildMetricRows(context, reportModel),
    ratios: buildRatioRows(context, reportModel),
  };
}

function buildFactRows(context: AnalysisContext): FactDataRow[] {
  const rows: FactDataRow[] = [];
  for (const ticker of context.tickers) {
    const facts = context.facts[ticker];
    if (!facts) continue;
    for (const fact of facts.facts) {
      const mapping = getMappingByName(fact.metric);
      for (const period of fact.periods) {
        rows.push({
          ticker: facts.ticker,
          cik: facts.cik,
          company_name: facts.company_name,
          metric: fact.metric,
          reported_label: fact.label || mapping?.displayName || fact.metric,
          reported_description: fact.description || '',
          reported_value: period.value,
          reported_unit: period.unit,
          period: period.period,
          form: period.form,
          fiscal_year: period.fiscal_year?.toString() || '',
          fiscal_period: period.fiscal_period || '',
          filed: period.filed,
          xbrl_tag: period.provenance?.xbrl_tag || '',
          namespace: period.provenance?.namespace || '',
          selection_policy: period.provenance?.selection_policy || '',
          concept_scope: period.provenance?.concept_scope || '',
          accession: period.provenance?.accession_number || '',
          filing_url: period.provenance?.filing_url || '',
        });
      }
    }
  }
  return rows;
}

function buildMetricRows(
  context: AnalysisContext,
  reportModel: ReportModel,
): MetricDataRow[] {
  const rows: MetricDataRow[] = [];
  const seen = new Set<string>();

  for (const company of reportModel.companies) {
    const periods = Array.from(company.canonicalPeriodMap.keys()).sort((a, b) => a.localeCompare(b));
    for (const period of periods) {
      const periodRole = classifyPeriodRole(company, period);
      const values = company.canonicalPeriodMap.get(period) || {};
      const sourceBucket = company.sourceMap.get(period) || {};

      for (const [metricKey, resolvedValue] of Object.entries(values)) {
        const source = sourceBucket[metricKey];
        const mapping = getMappingByName(metricKey);
        rows.push({
          ticker: company.ticker,
          cik: context.facts[company.ticker]?.cik || '',
          company_name: company.companyName,
          period,
          period_role: periodRole,
          metric_key: metricKey,
          metric_label: mapping?.displayName || metricKey,
          resolved_value: resolvedValue,
          resolved_unit: mapping?.unit || source?.reportedUnit || '',
          source_kind: source?.kind || '',
          reported_or_derived: classifyPresenceKind(source?.kind),
          availability_reason: source?.kind === 'adjusted' || source?.kind === 'derived' ? 'derived' : 'reported',
          reported_value: source?.reportedValue ?? null,
          reported_unit: source?.reportedUnit || '',
          reported_label: source?.reportedLabel || '',
          detail: source?.detail || '',
          form: source?.form || '',
          filed: source?.filed || '',
          accession: source?.provenance?.accession_number || '',
          filing_url: source?.provenance?.filing_url || '',
          xbrl_tag: source?.provenance?.xbrl_tag || '',
          namespace: source?.provenance?.namespace || '',
        });
        seen.add(metricRowKey(company.ticker, period, metricKey));
      }
    }

    for (const metric of company.allMetricsByLabel.values()) {
      for (const binding of [
        { period: company.snapshotPeriod, role: 'snapshot' as const, value: metric.current, availability: metric.availability.current },
        { period: company.priorPeriod, role: 'prior' as const, value: metric.prior, availability: metric.availability.prior },
      ]) {
        if (!binding.period) continue;
        const rowKey = metricRowKey(company.ticker, binding.period, metric.key);
        if (seen.has(rowKey)) continue;
        rows.push({
          ticker: company.ticker,
          cik: context.facts[company.ticker]?.cik || '',
          company_name: company.companyName,
          period: binding.period,
          period_role: binding.role,
          metric_key: metric.key,
          metric_label: metric.label,
          resolved_value: binding.value,
          resolved_unit: metric.unit,
          source_kind: '',
          reported_or_derived: binding.value !== null
            ? 'derived'
            : binding.availability === 'intentionally_suppressed'
              ? 'suppressed'
              : 'missing',
          availability_reason: binding.availability,
          reported_value: null,
          reported_unit: '',
          reported_label: '',
          detail: metric.note || '',
          form: '',
          filed: '',
          accession: '',
          filing_url: '',
          xbrl_tag: '',
          namespace: '',
        });
      }
    }
  }

  return rows;
}

function buildRatioRows(
  context: AnalysisContext,
  reportModel: ReportModel,
): RatioDataRow[] {
  const rows: RatioDataRow[] = [];

  for (const company of reportModel.companies) {
    const periodsAsc = Array.from(company.canonicalPeriodMap.keys()).sort((a, b) => a.localeCompare(b));
    for (const [idx, period] of periodsAsc.entries()) {
      const role = classifyPeriodRole(company, period);
      const values = company.canonicalPeriodMap.get(period) || {};
      const previousValues = idx > 0 ? (company.canonicalPeriodMap.get(periodsAsc[idx - 1]!) || {}) : {};

      for (const def of RATIO_EXPORT_DEFS) {
        const currentMetric = company.metricsByKey.get(def.key);
        const snapshotMatch = period === company.snapshotPeriod;
        const priorMatch = period === company.priorPeriod;
        const explicitValue = snapshotMatch
          ? currentMetric?.current ?? null
          : priorMatch
            ? currentMetric?.prior ?? null
            : null;
        const explicitAvailability = snapshotMatch
          ? currentMetric?.availability.current
          : priorMatch
            ? currentMetric?.availability.prior
            : undefined;
        const computed = explicitValue !== null || explicitAvailability
          ? {
              value: explicitValue,
              availability: explicitAvailability || (explicitValue !== null ? 'derived' : 'missing_inputs'),
              note: currentMetric?.note || '',
            }
          : computeHistoricalRatio(def.key, values, previousValues, company.policy.returnMetricBasisMode);
        const componentText = ratioComponentsForPeriod(def.key, values, previousValues, company.policy.returnMetricBasisMode);
        const meaningful = isRatioMeaningful(def.key, values);
        const chartNote = ratioChartNote(def.key, values, meaningful, computed.availability);

        if (computed.value === null && !snapshotMatch && !priorMatch) continue;

        rows.push({
          ticker: company.ticker,
          cik: context.facts[company.ticker]?.cik || '',
          company_name: company.companyName,
          period,
          period_role: role,
          ratio_key: def.key,
          ratio_label: def.label,
          value: computed.value,
          formula: def.formula,
          components: componentText,
          notes: computed.note,
          availability_reason: computed.availability,
          chart_meaningful: meaningful && computed.value !== null,
          chart_note: chartNote,
        });
      }
    }
  }

  return rows;
}

function classifyPresenceKind(kind?: string): 'reported' | 'derived' | 'suppressed' | 'missing' {
  if (kind === 'derived' || kind === 'adjusted') return 'derived';
  if (kind === 'unknown') return 'suppressed';
  return 'reported';
}

function classifyPeriodRole(
  company: ReportModel['companies'][number],
  period: string,
): 'snapshot' | 'prior' | 'historical' {
  if (period === company.snapshotPeriod) return 'snapshot';
  if (period === company.priorPeriod) return 'prior';
  return 'historical';
}

function metricRowKey(ticker: string, period: string, metricKey: string): string {
  return `${ticker}:${period}:${metricKey}`;
}

function finiteOrNull(value: number | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return value;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function average(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return (a + b) / 2;
}

function computeHistoricalRatio(
  key: string,
  values: Record<string, number>,
  previousValues: Record<string, number>,
  returnMetricBasisMode: ReportModel['companies'][number]['policy']['returnMetricBasisMode'],
): { value: number | null; availability: MetricAvailabilityReasonCode; note: string } {
  const revenue = finiteOrNull(values['revenue']);
  const netIncome = finiteOrNull(values['net_income']);
  const operatingIncome = finiteOrNull(values['operating_income']);
  const grossProfit = finiteOrNull(values['gross_profit']);
  const currentAssets = finiteOrNull(values['current_assets']);
  const currentLiabilities = finiteOrNull(values['current_liabilities']);
  const inventory = finiteOrNull(values['inventory']);
  const equity = finiteOrNull(values['stockholders_equity']);
  const debt = finiteOrNull(values['total_debt']);
  const assets = finiteOrNull(values['total_assets']);
  const previousEquity = finiteOrNull(previousValues['stockholders_equity']);
  const previousAssets = finiteOrNull(previousValues['total_assets']);

  switch (key) {
    case 'gross_margin':
      return wrapComputed(safeDivide(grossProfit, revenue), ['gross_profit', 'revenue'], values);
    case 'operating_margin':
      return wrapComputed(safeDivide(operatingIncome, revenue), ['operating_income', 'revenue'], values);
    case 'net_margin':
      return wrapComputed(safeDivide(netIncome, revenue), ['net_income', 'revenue'], values);
    case 'current_ratio':
      return wrapComputed(safeDivide(currentAssets, currentLiabilities), ['current_assets', 'current_liabilities'], values);
    case 'quick_ratio': {
      if (inventory === null) return { value: null, availability: 'missing_inputs', note: '' };
      return wrapComputed(safeDivide(currentAssets !== null ? currentAssets - inventory : null, currentLiabilities), ['current_assets', 'inventory', 'current_liabilities'], values);
    }
    case 'de':
      return wrapComputed(safeDivide(debt, equity), ['total_debt', 'stockholders_equity'], values);
    case 'roe': {
      const equityBasis = returnMetricBasisMode === 'average_balance' ? average(equity, previousEquity) : equity;
      return wrapComputed(safeDivide(netIncome, equityBasis), ['net_income', 'stockholders_equity'], values);
    }
    case 'roa': {
      const assetBasis = returnMetricBasisMode === 'average_balance' ? average(assets, previousAssets) : assets;
      return wrapComputed(safeDivide(netIncome, assetBasis), ['net_income', 'total_assets'], values);
    }
    case 'asset_turnover': {
      const assetBasis = returnMetricBasisMode === 'average_balance' ? average(assets, previousAssets) : assets;
      return wrapComputed(safeDivide(revenue, assetBasis), ['revenue', 'total_assets'], values);
    }
    default:
      return { value: null, availability: 'source_unavailable', note: '' };
  }
}

function wrapComputed(
  value: number | null,
  dependencies: string[],
  values: Record<string, number>,
): { value: number | null; availability: MetricAvailabilityReasonCode; note: string } {
  if (value !== null) return { value, availability: 'derived', note: 'Historical ratio series computed from canonical annual values.' };
  const missing = dependencies.some(dep => finiteOrNull(values[dep]) === null);
  return { value: null, availability: missing ? 'missing_inputs' : 'source_unavailable', note: '' };
}

function ratioComponentsForPeriod(
  key: string,
  values: Record<string, number>,
  previousValues: Record<string, number>,
  returnMetricBasisMode: ReportModel['companies'][number]['policy']['returnMetricBasisMode'],
): string {
  const pairs: Array<[string, number | null]> = [];
  switch (key) {
    case 'gross_margin':
      pairs.push(['gross_profit', finiteOrNull(values['gross_profit'])], ['revenue', finiteOrNull(values['revenue'])]);
      break;
    case 'operating_margin':
      pairs.push(['operating_income', finiteOrNull(values['operating_income'])], ['revenue', finiteOrNull(values['revenue'])]);
      break;
    case 'net_margin':
      pairs.push(['net_income', finiteOrNull(values['net_income'])], ['revenue', finiteOrNull(values['revenue'])]);
      break;
    case 'roe': {
      const equity = finiteOrNull(values['stockholders_equity']);
      const previousEquity = finiteOrNull(previousValues['stockholders_equity']);
      const basis = returnMetricBasisMode === 'average_balance' ? average(equity, previousEquity) : equity;
      pairs.push(['net_income', finiteOrNull(values['net_income'])], ['equity_basis', basis]);
      break;
    }
    case 'roa': {
      const assets = finiteOrNull(values['total_assets']);
      const previousAssets = finiteOrNull(previousValues['total_assets']);
      const basis = returnMetricBasisMode === 'average_balance' ? average(assets, previousAssets) : assets;
      pairs.push(['net_income', finiteOrNull(values['net_income'])], ['asset_basis', basis]);
      break;
    }
    case 'current_ratio':
      pairs.push(['current_assets', finiteOrNull(values['current_assets'])], ['current_liabilities', finiteOrNull(values['current_liabilities'])]);
      break;
    case 'quick_ratio':
      pairs.push(['current_assets', finiteOrNull(values['current_assets'])], ['inventory', finiteOrNull(values['inventory'])], ['current_liabilities', finiteOrNull(values['current_liabilities'])]);
      break;
    case 'de':
      pairs.push(['total_debt', finiteOrNull(values['total_debt'])], ['stockholders_equity', finiteOrNull(values['stockholders_equity'])]);
      break;
    case 'asset_turnover': {
      const assets = finiteOrNull(values['total_assets']);
      const previousAssets = finiteOrNull(previousValues['total_assets']);
      const basis = returnMetricBasisMode === 'average_balance' ? average(assets, previousAssets) : assets;
      pairs.push(['revenue', finiteOrNull(values['revenue'])], ['asset_basis', basis]);
      break;
    }
    default:
      break;
  }

  return pairs
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
}

function isRatioMeaningful(
  key: string,
  values: Record<string, number>,
): boolean {
  const revenue = finiteOrNull(values['revenue']);
  const equity = finiteOrNull(values['stockholders_equity']);
  switch (key) {
    case 'gross_margin':
    case 'operating_margin':
    case 'net_margin':
      return revenue !== null && revenue !== 0;
    case 'de':
    case 'roe':
      return equity !== null && equity > 0;
    default:
      return true;
  }
}

function ratioChartNote(
  key: string,
  values: Record<string, number>,
  meaningful: boolean,
  availability: MetricAvailabilityReasonCode,
): string {
  if (availability === 'intentionally_suppressed') {
    return 'Suppressed because the source concept was not reliable enough for charting.';
  }
  if (!meaningful) {
    if ((key === 'de' || key === 'roe') && finiteOrNull(values['stockholders_equity']) !== null && finiteOrNull(values['stockholders_equity'])! <= 0) {
      return 'Suppressed for charting because negative equity makes the ratio non-comparable.';
    }
    if ((key === 'gross_margin' || key === 'operating_margin' || key === 'net_margin') && finiteOrNull(values['revenue']) === 0) {
      return 'Suppressed for charting because revenue is zero in the period shown.';
    }
  }
  return '';
}
