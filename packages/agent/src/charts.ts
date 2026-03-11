import type { AnalysisContext } from '@shawyan/shared';
import type { CompanyReportModel, ReportModel } from './report-model.js';
import {
  buildReportDataRows,
  type MetricDataRow,
  type RatioDataRow,
} from './report-data-rows.js';

export interface PreparedChartItem {
  key: string;
  title: string;
  caption: string;
  visualization: string;
  dataset: PreparedChartDataset;
  metadataPatch: Record<string, unknown>;
  folderPath: string;
  exportWidth: number;
  exportHeight: number;
  plainExport: boolean;
  layout: 'standard' | 'compact';
  format: DisplayFormatSpec | null;
  asset: RenderedChartAsset | null;
  renderStatus: ChartRenderStatus;
  exportDiagnostics: ChartRenderDiagnostic[];
  fallbackUsed: boolean;
  datawrapperChartId: string | null;
}

export interface PreparedChartDataset {
  shape: 'categorical' | 'timeseries' | 'comparison';
  headers: string[];
  rows: string[][];
}

interface PreparedChartOptions {
  exportWidth?: number;
  exportHeight?: number;
  plainExport?: boolean;
  layout?: 'standard' | 'compact';
  format?: DisplayFormatSpec | null;
  metadataPatch?: Record<string, unknown>;
}

export interface ChartSet {
  items: PreparedChartItem[];
}

export type ChartAssetType = 'svg' | 'png';

export type ChartRenderStatus = 'pending' | 'rendered' | 'failed';

export interface RenderedChartAsset {
  assetType: ChartAssetType;
  mimeType: string;
  content: string;
}

export interface ChartRenderDiagnostic {
  chartId: string | null;
  chartTitle: string;
  stage: 'create' | 'upload' | 'metadata' | 'publish' | 'export';
  exportFormat: ChartAssetType | null;
  endpoint: string;
  httpStatus: number | null;
  ok: boolean;
  message: string;
  fallbackTriggered: boolean;
  finalAssetType: ChartAssetType | null;
  finalRenderResult: ChartRenderStatus;
}

interface CurrencyScale {
  divisor: number;
  suffix: string;
  label: string;
  decimals: number;
}

interface DisplayFormatSpec {
  prepend?: string;
  append?: string;
  decimals?: number;
}

export function generateChartsForReportModel(
  context: AnalysisContext,
  reportModel: ReportModel,
): ChartSet {
  const rows = buildReportDataRows(context, reportModel);
  const folderPath = `Dolph/${reportModel.type === 'comparison' ? 'comparisons' : 'standalone'}/${context.tickers.join('-')}`;
  const items = reportModel.type === 'comparison'
    ? prepareComparisonCharts(reportModel, rows.metrics, rows.ratios, folderPath)
    : prepareStandaloneCharts(reportModel.companies[0] || null, rows.metrics, rows.ratios, folderPath);

  return { items };
}

function prepareStandaloneCharts(
  company: CompanyReportModel | null,
  metricRows: MetricDataRow[],
  ratioRows: RatioDataRow[],
  folderPath: string,
): PreparedChartItem[] {
  if (!company) return [];
  const charts: Array<PreparedChartItem | null> = [
    buildRevenueTrend(company, metricRows, folderPath),
    buildMarginTrend(company, ratioRows, folderPath),
    buildCashFlowProfile(company, metricRows, folderPath),
    buildBalanceSheetPosture(company, metricRows, folderPath),
    buildLiquidityAndLeverage(company, ratioRows, folderPath),
    buildReturnProfile(company, ratioRows, folderPath),
    buildPerShareMetrics(company, metricRows, folderPath),
  ];
  return charts.filter((chart): chart is PreparedChartItem => !!chart);
}

function prepareComparisonCharts(
  reportModel: ReportModel,
  metricRows: MetricDataRow[],
  ratioRows: RatioDataRow[],
  folderPath: string,
): PreparedChartItem[] {
  const tickers = reportModel.companies.map(company => company.ticker);
  const charts: Array<PreparedChartItem | null> = [
    buildComparisonAbsoluteChart('revenue_comparison', 'Revenue Comparison', 'Current-year revenue across the peer set.', tickers, metricRows, 'revenue', 'Revenue', 'd3-bars', folderPath),
    buildComparisonRatioChart('profitability_comparison', 'Profitability Comparison', 'Current-year gross, operating, and net margins across the peer set.', tickers, ratioRows, [
      ['gross_margin', 'Gross Margin'],
      ['operating_margin', 'Operating Margin'],
      ['net_margin', 'Net Margin'],
    ], 'd3-bars-split', folderPath),
    buildComparisonAbsoluteChart('cash_generation_comparison', 'Cash Generation Comparison', 'Current-year operating cash flow and free cash flow across the peer set.', tickers, metricRows, ['operating_cash_flow', 'fcf'], ['Operating Cash Flow', 'Free Cash Flow'], 'd3-bars-split', folderPath),
    buildComparisonRatioChart('liquidity_leverage_comparison', 'Liquidity and Leverage Comparison', 'Current-year liquidity and leverage ratios across the peer set.', tickers, ratioRows, [
      ['current_ratio', 'Current Ratio'],
      ['quick_ratio', 'Quick Ratio'],
      ['de', 'Debt-to-Equity'],
    ], 'd3-bars-split', folderPath),
    buildComparisonRatioChart('return_comparison', 'Return Comparison', 'Current-year return metrics across the peer set.', tickers, ratioRows, [
      ['roe', 'Return on Equity'],
      ['roa', 'Return on Assets'],
    ], 'd3-bars-split', folderPath),
    buildComparisonBalanceSheetStrengthChart(tickers, metricRows, folderPath),
    buildComparisonAbsoluteChart('per_share_comparison', 'Per-Share Comparison', 'Current-year diluted EPS and book value per share where reliable.', tickers, metricRows, ['eps', 'bvps'], ['Diluted EPS', 'Book Value Per Share'], 'd3-bars-split', folderPath),
  ];
  return charts.filter((chart): chart is PreparedChartItem => !!chart);
}

function buildRevenueTrend(
  company: CompanyReportModel,
  metricRows: MetricDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const revenueSeries = selectMetricSeries(metricRows, company.ticker, 'revenue').filter(row => row.resolved_value !== null).slice(-5);
  if (revenueSeries.length < 3) return null;
  const headers = ['Period', 'Revenue'];
  const rows = revenueSeries.map(row => [
    shortPeriodLabel(row.period),
    formatNullableNumber(row.resolved_value),
  ]);
  const dataset = buildTimeSeriesChartDataset(headers.slice(1), rows);

  return preparedChart(
    'revenue_trend',
    `${company.companyName} Revenue Trend`,
    'Annual revenue by fiscal year.',
    'column-chart',
    dataset,
    folderPath,
    {
      exportWidth: 1040,
      exportHeight: 300,
      layout: 'standard',
      format: { prepend: '$', decimals: 0 },
      metadataPatch: buildRevenueTrendMetadataPatch(),
    },
  );
}

function buildMarginTrend(
  company: CompanyReportModel,
  ratioRows: RatioDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const gross = ratioSeriesByPeriod(ratioRows, company.ticker, 'gross_margin');
  const operating = ratioSeriesByPeriod(ratioRows, company.ticker, 'operating_margin');
  const net = ratioSeriesByPeriod(ratioRows, company.ticker, 'net_margin');
  const periods = uniquePeriodsFromRatioSeries([gross, operating, net]).slice(-5);
  if (periods.length < 2) return null;
  const rows = periods.map(period => {
    const grossValue = percentValue(gross.get(period) ?? null);
    const operatingValue = percentValue(operating.get(period) ?? null);
    const netValue = percentValue(net.get(period) ?? null);
    return [
      shortPeriodLabel(period),
      formatNullableNumber(grossValue),
      formatNullableNumber(operatingValue),
      formatNullableNumber(netValue),
    ];
  });
  if (rows.every(row => row.slice(1).every(value => value === ''))) return null;
  const dataset = buildTimeSeriesChartDataset(['Gross Margin', 'Operating Margin', 'Net Margin'], rows);

  return preparedChart(
    'margin_trend',
    `${company.companyName} Margin Trend`,
    'Gross, operating, and net margin by fiscal year.',
    'grouped-column-chart',
    dataset,
    folderPath,
    {
      exportWidth: 1040,
      exportHeight: 300,
      layout: 'standard',
      format: { append: '%', decimals: 1 },
      metadataPatch: buildMarginTrendMetadataPatch(),
    },
  );
}

function buildCashFlowProfile(
  company: CompanyReportModel,
  metricRows: MetricDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const netIncome = currentMetric(metricRows, company.ticker, 'net_income');
  const cfo = currentMetric(metricRows, company.ticker, 'operating_cash_flow');
  const capex = currentMetric(metricRows, company.ticker, 'capex');
  const fcf = currentMetric(metricRows, company.ticker, 'fcf');
  if (!netIncome || !cfo || netIncome.resolved_value === null || cfo.resolved_value === null) return null;

  const rows: string[][] = [
    ['Net Income', formatNullableNumber(netIncome.resolved_value)],
    ['Operating Cash Flow', formatNullableNumber(cfo.resolved_value)],
  ];
  if (capex?.resolved_value !== null && capex?.resolved_value !== undefined) {
    rows.push(['Capital Expenditures', formatNullableNumber(capex.resolved_value)]);
  }
  if (fcf?.resolved_value !== null && fcf?.resolved_value !== undefined) {
    rows.push(['Free Cash Flow', formatNullableNumber(fcf.resolved_value)]);
  }
  const dataset = buildCategoricalChartDataset('Metric', ['Value'], rows);

  return preparedChart(
    'cash_flow_profile',
    `${company.companyName} Cash Flow Profile`,
    'Current-period earnings, operating cash flow, capital spending, and free cash flow.',
    'column-chart',
    dataset,
    folderPath,
    {
      exportWidth: 960,
      exportHeight: 300,
      layout: 'compact',
      format: { prepend: '$', decimals: 0 },
      metadataPatch: buildCashFlowProfileMetadataPatch(),
    },
  );
}

function buildBalanceSheetPosture(
  company: CompanyReportModel,
  metricRows: MetricDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const cashKey = preferredCashMetricKey(metricRows);
  const fields: Array<[string, string]> = [
    ['total_assets', 'Total Assets'],
    ['total_liabilities', 'Total Liabilities'],
    ['stockholders_equity', "Total Stockholders' Equity"],
    ['total_debt', 'Total Debt'],
    [cashKey, 'Cash & Equivalents'],
  ];
  const resolvedValues = fields.map(([key]) => currentMetric(metricRows, company.ticker, key)?.resolved_value ?? null);
  if (resolvedValues.filter(value => value !== null && value !== undefined).length < 2) return null;
  const rows: string[][] = fields
    .map(([, label], idx) => [label, formatNullableNumber(resolvedValues[idx] ?? null)])
    .filter((row) => row[1] !== '');
  const dataset = buildCategoricalChartDataset('Metric', ['Value'], rows);
  return preparedChart(
    'balance_sheet_posture',
    `${company.companyName} Balance Sheet Posture`,
    'Current-period balance-sheet scale, capital structure, and liquidity.',
    'd3-bars',
    dataset,
    folderPath,
    {
      exportWidth: 960,
      exportHeight: 260,
      layout: 'compact',
      format: { prepend: '$', decimals: 0 },
      metadataPatch: buildBalanceSheetPostureMetadataPatch(),
    },
  );
}

function buildLiquidityAndLeverage(
  company: CompanyReportModel,
  ratioRows: RatioDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const fields: Array<[string, string]> = [
    ['current_ratio', 'Current Ratio'],
    ['quick_ratio', 'Quick Ratio'],
    ['de', 'Debt-to-Equity'],
  ];
  const resolvedValues = fields.map(([key]) => {
    const ratio = currentRatio(ratioRows, company.ticker, key);
    if (!ratio || ratio.value === null || !ratio.chart_meaningful) return null;
    return ratio.value;
  });
  if (resolvedValues.every(value => value === null)) return null;
  const rows: string[][] = fields
    .map(([, label], idx) => [label, formatNullableNumber(resolvedValues[idx])])
    .filter((row) => row[1] !== '');
  const dataset = buildCategoricalChartDataset('Ratio', ['Value'], rows);
  return preparedChart(
    'liquidity_leverage',
    `${company.companyName} Liquidity Profile`,
    'Current-period liquidity and leverage ratios.',
    'd3-bars',
    dataset,
    folderPath,
    {
      exportWidth: 900,
      exportHeight: 220,
      layout: 'compact',
      format: { decimals: 2 },
      metadataPatch: buildLiquidityProfileMetadataPatch(),
    },
  );
}

function buildReturnProfile(
  company: CompanyReportModel,
  ratioRows: RatioDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const fields: Array<[string, string]> = [
    ['roe', 'Return on Equity'],
    ['roa', 'Return on Assets'],
  ];
  const resolvedValues = fields.map(([key]) => {
    const ratio = currentRatio(ratioRows, company.ticker, key);
    if (!ratio || ratio.value === null || !ratio.chart_meaningful) return null;
    return percentValue(ratio.value);
  });
  if (resolvedValues.every(value => value === null)) return null;
  const rows: string[][] = fields
    .map(([, label], idx) => [label, formatNullableNumber(resolvedValues[idx])])
    .filter((row) => row[1] !== '');
  const dataset = buildCategoricalChartDataset('Metric', ['Value'], rows);
  return preparedChart(
    'return_profile',
    `${company.companyName} Profitability Profile`,
    'Current-period return on equity and return on assets.',
    'd3-pies',
    dataset,
    folderPath,
    {
      exportWidth: 900,
      exportHeight: 220,
      layout: 'compact',
      format: { append: '%', decimals: 1 },
      metadataPatch: buildReturnProfileMetadataPatch(),
    },
  );
}

function buildPerShareMetrics(
  company: CompanyReportModel,
  metricRows: MetricDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const periodRows = ['prior', 'snapshot']
    .map(role => {
      const eps = metricRows.find(row => row.ticker === company.ticker && row.metric_key === 'eps' && row.period_role === role);
      const bvps = metricRows.find(row => row.ticker === company.ticker && row.metric_key === 'bvps' && row.period_role === role);
      if (!eps && !bvps) return null;
      const period = eps?.period || bvps?.period;
      if (!period) return null;
      return [shortPeriodLabel(period), formatNullableNumber(eps?.resolved_value ?? null), formatNullableNumber(bvps?.resolved_value ?? null)];
    })
    .filter((row): row is string[] => !!row);
  if (periodRows.length === 0) return null;
  const dataset = buildTimeSeriesChartDataset(['Diluted EPS', 'Book Value Per Share'], periodRows);
  return preparedChart(
    'per_share_metrics',
    `${company.companyName} Per Share Metrics`,
    'Current and prior diluted EPS and book value per share.',
    'd3-bars-bullet',
    dataset,
    folderPath,
    {
      exportWidth: 960,
      exportHeight: 230,
      layout: 'compact',
      format: { prepend: '$', decimals: 2 },
      metadataPatch: buildPerShareMetricsMetadataPatch(periodRows.map(row => row[0])),
    },
  );
}

function buildComparisonAbsoluteChart(
  key: string,
  title: string,
  caption: string,
  tickers: string[],
  metricRows: MetricDataRow[],
  metricKeys: string | string[],
  labels: string | string[],
  visualization: string,
  folderPath: string,
): PreparedChartItem | null {
  const keys = Array.isArray(metricKeys) ? metricKeys : [metricKeys];
  const headerLabels = Array.isArray(labels) ? labels : [labels];
  const isPerShare = key === 'per_share_comparison';
  const seriesLabels = keys.map((_, idx) => headerLabels[idx] || `Series ${idx + 1}`);
  const scale = chooseCurrencyScale(
    tickers.flatMap(ticker => keys.map(metricKey => currentMetric(metricRows, ticker, metricKey)?.resolved_value ?? null)),
  );
  const rows = tickers.map(ticker => {
    const values = keys.map(metricKey => currentMetric(metricRows, ticker, metricKey)?.resolved_value ?? null);
    return [ticker, ...values.map(value => formatScaledValue(value, scale.divisor, scale.decimals))];
  });
  if (rows.every(row => row.slice(1).every(value => value === ''))) return null;
  if (key === 'revenue_comparison') {
    rows.sort((left, right) => {
      const leftValue = Number.parseFloat(left[1] || '');
      const rightValue = Number.parseFloat(right[1] || '');
      const safeLeft = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
      const safeRight = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
      return safeRight - safeLeft;
    });
  }
  const dataset = buildComparisonChartDataset(seriesLabels, rows);
  return preparedChart(key, title, isPerShare ? caption : `${caption} ${scale.label}.`, visualization, dataset, folderPath, {
    exportWidth: 980,
    exportHeight: 250,
    layout: 'compact',
    format: isPerShare
      ? { prepend: '$', decimals: 2 }
      : { prepend: '$', append: scale.suffix, decimals: scale.decimals },
  });
}

function buildComparisonRatioChart(
  key: string,
  title: string,
  caption: string,
  tickers: string[],
  ratioRows: RatioDataRow[],
  ratioDefs: Array<[string, string]>,
  visualization: string,
  folderPath: string,
): PreparedChartItem | null {
  const percentRatioKeys = new Set(['gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa']);
  const seriesLabels = ratioDefs.map(([, label]) => label);
  const rows = tickers.map(ticker => {
    const values = ratioDefs.map(([ratioKey]) => {
      const ratio = currentRatio(ratioRows, ticker, ratioKey);
      if (!ratio || ratio.value === null || !ratio.chart_meaningful) return null;
      return percentRatioKeys.has(ratioKey) ? percentValue(ratio.value) : ratio.value;
    });
    return [ticker, ...values.map(formatNullableNumber)];
  });
  if (rows.every(row => row.slice(1).every(value => value === ''))) return null;
  const isPercentChart = ratioDefs.every(([ratioKey]) => percentRatioKeys.has(ratioKey));
  const dataset = buildComparisonChartDataset(seriesLabels, rows);
  return preparedChart(key, title, caption, visualization, dataset, folderPath, {
    exportWidth: 980,
    exportHeight: 250,
    layout: 'compact',
    format: isPercentChart ? { append: '%', decimals: 1 } : { append: 'x', decimals: 2 },
  });
}

function buildComparisonBalanceSheetStrengthChart(
  tickers: string[],
  metricRows: MetricDataRow[],
  folderPath: string,
): PreparedChartItem | null {
  const seriesLabels = ['Total Assets', 'Total Liabilities', "Stockholders' Equity", 'Total Debt', 'Cash & Equivalents'];
  const scale = chooseCurrencyScale(
    tickers.flatMap(ticker => [
      currentMetric(metricRows, ticker, 'total_assets')?.resolved_value ?? null,
      currentMetric(metricRows, ticker, 'total_liabilities')?.resolved_value ?? null,
      currentMetric(metricRows, ticker, 'stockholders_equity')?.resolved_value ?? null,
      currentMetric(metricRows, ticker, 'total_debt')?.resolved_value ?? null,
      currentPreferredCashMetric(metricRows, ticker)?.resolved_value ?? null,
    ]),
  );
  const rows = tickers.map(ticker => [
    ticker,
    formatScaledValue(currentMetric(metricRows, ticker, 'total_assets')?.resolved_value ?? null, scale.divisor, scale.decimals),
    formatScaledValue(currentMetric(metricRows, ticker, 'total_liabilities')?.resolved_value ?? null, scale.divisor, scale.decimals),
    formatScaledValue(currentMetric(metricRows, ticker, 'stockholders_equity')?.resolved_value ?? null, scale.divisor, scale.decimals),
    formatScaledValue(currentMetric(metricRows, ticker, 'total_debt')?.resolved_value ?? null, scale.divisor, scale.decimals),
    formatScaledValue(currentPreferredCashMetric(metricRows, ticker)?.resolved_value ?? null, scale.divisor, scale.decimals),
  ]);
  if (rows.every(row => row.slice(1).every(value => value === ''))) return null;
  const dataset = buildComparisonChartDataset(seriesLabels, rows);
  return preparedChart(
    'balance_sheet_strength_comparison',
    'Balance Sheet Strength Comparison',
    `Current-year balance-sheet scale, capital structure, and cash position across peers, ${scale.label}.`,
    'd3-bars-split',
    dataset,
    folderPath,
    {
      exportWidth: 1040,
      exportHeight: 270,
      layout: 'standard',
      format: { prepend: '$', append: scale.suffix, decimals: scale.decimals },
    },
  );
}

function preparedChart(
  key: string,
  title: string,
  caption: string,
  visualization: string,
  dataset: PreparedChartDataset,
  folderPath: string,
  options: PreparedChartOptions = {},
): PreparedChartItem {
  return {
    key,
    title,
    caption,
    visualization,
    dataset,
    metadataPatch: options.metadataPatch ?? {},
    folderPath,
    exportWidth: options.exportWidth ?? 980,
    exportHeight: options.exportHeight ?? 280,
    plainExport: options.plainExport ?? true,
    layout: options.layout ?? 'standard',
    format: options.format ?? null,
    asset: null,
    renderStatus: 'pending',
    exportDiagnostics: [],
    fallbackUsed: false,
    datawrapperChartId: null,
  };
}

function buildCategoricalChartDataset(
  categoryLabel: string,
  valueLabels: string[],
  rows: string[][],
): PreparedChartDataset {
  return buildPreparedChartDataset('categorical', [categoryLabel, ...valueLabels], rows);
}

function buildTimeSeriesChartDataset(
  seriesLabels: string[],
  rows: string[][],
): PreparedChartDataset {
  return buildPreparedChartDataset('timeseries', ['Period', ...seriesLabels], rows);
}

function buildComparisonChartDataset(
  seriesLabels: string[],
  rows: string[][],
): PreparedChartDataset {
  return buildPreparedChartDataset('comparison', ['Company', ...seriesLabels], rows);
}

function buildPreparedChartDataset(
  shape: PreparedChartDataset['shape'],
  headers: string[],
  rows: string[][],
): PreparedChartDataset {
  validatePreparedChartDataset(shape, headers, rows);
  return {
    shape,
    headers,
    rows,
  };
}

function validatePreparedChartDataset(
  shape: PreparedChartDataset['shape'],
  headers: string[],
  rows: string[][],
): void {
  if (headers.length < 2) {
    throw new Error('Chart dataset must have at least two columns.');
  }
  if (rows.length === 0) {
    throw new Error(`Chart dataset must include at least one observation row for headers [${headers.join(', ')}].`);
  }
  const bannedMetadataHeaders = new Set([
    'dataset_type',
    'ticker',
    'company_name',
    'field_key',
    'field_label',
    'value',
    'value_unit',
    'availability_reason',
    'reported_or_derived',
    'form',
    'filed',
  ]);
  if (headers.some(header => bannedMetadataHeaders.has(header))) {
    throw new Error(`Chart dataset headers were not promoted into a chart-ready table: ${headers.join(', ')}`);
  }
  if (headers.some(header => header.includes('_'))) {
    throw new Error(`Chart dataset contains internal-style header labels instead of reader-facing labels: ${headers.join(', ')}`);
  }
  const expectedLeadingHeader = shape === 'timeseries'
    ? 'Period'
    : shape === 'comparison'
      ? 'Company'
      : headers[0];
  if (headers[0] !== expectedLeadingHeader) {
    throw new Error(`Chart dataset shape ${shape} must start with ${expectedLeadingHeader}.`);
  }
  for (const row of rows) {
    if (row.length !== headers.length) {
      throw new Error(`Chart dataset row length mismatch for headers [${headers.join(', ')}].`);
    }
    const firstCell = row[0] || '';
    if (bannedMetadataHeaders.has(firstCell)) {
      throw new Error(`Chart dataset contains a metadata row instead of an observation row: ${firstCell}`);
    }
    if (firstCell.includes('_')) {
      throw new Error(`Chart dataset contains an internal-style observation label instead of a reader-facing label: ${firstCell}`);
    }
  }
}

function selectMetricSeries(metricRows: MetricDataRow[], ticker: string, metricKey: string): MetricDataRow[] {
  return metricRows
    .filter(row => row.ticker === ticker && row.metric_key === metricKey && row.resolved_value !== null)
    .sort((a, b) => a.period.localeCompare(b.period));
}

function ratioSeriesByPeriod(ratioRows: RatioDataRow[], ticker: string, ratioKey: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of ratioRows) {
    if (row.ticker !== ticker || row.ratio_key !== ratioKey) continue;
    if (!row.chart_meaningful || row.value === null) {
      out.set(row.period, null);
      continue;
    }
    out.set(row.period, row.value);
  }
  return out;
}

function currentMetric(metricRows: MetricDataRow[], ticker: string, metricKey: string): MetricDataRow | undefined {
  return metricRows.find(row => row.ticker === ticker && row.metric_key === metricKey && row.period_role === 'snapshot');
}

function currentRatio(ratioRows: RatioDataRow[], ticker: string, ratioKey: string): RatioDataRow | undefined {
  return ratioRows.find(row => row.ticker === ticker && row.ratio_key === ratioKey && row.period_role === 'snapshot');
}

function preferredCashMetricKey(metricRows: MetricDataRow[]): string {
  const preference = [
    'cash_and_equivalents',
    'cash_and_equivalents_and_restricted_cash',
    'cash_and_equivalents_and_short_term_investments',
    'cash_ending',
  ];
  for (const key of preference) {
    if (metricRows.some(row => row.metric_key === key && row.resolved_value !== null)) return key;
  }
  return 'cash_and_equivalents';
}

function currentPreferredCashMetric(metricRows: MetricDataRow[], ticker: string): MetricDataRow | undefined {
  const preference = [
    'cash_and_equivalents',
    'cash_and_equivalents_and_restricted_cash',
    'cash_and_equivalents_and_short_term_investments',
    'cash_ending',
  ];
  for (const key of preference) {
    const row = currentMetric(metricRows, ticker, key);
    if (row && row.resolved_value !== null) return row;
  }
  return undefined;
}

function formatNullableNumber(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

function percentValue(value: number | null): number | null {
  return value === null || value === undefined ? null : value * 100;
}

function shortPeriodLabel(period: string): string {
  return period.slice(0, 4);
}

function uniquePeriodsFromRatioSeries(series: Array<Map<string, number | null>>): string[] {
  return Array.from(new Set(series.flatMap(map => Array.from(map.keys())))).sort();
}

function chooseCurrencyScale(values: Array<number | null | undefined>): CurrencyScale {
  const maxAbs = Math.max(
    ...values
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .map(value => Math.abs(value)),
    0,
  );
  if (maxAbs >= 1_000_000_000) {
    return { divisor: 1_000_000_000, suffix: 'B', label: 'USD, billions', decimals: maxAbs >= 100_000_000_000 ? 0 : 1 };
  }
  if (maxAbs >= 1_000_000) {
    return { divisor: 1_000_000, suffix: 'M', label: 'USD, millions', decimals: maxAbs >= 100_000_000 ? 0 : 1 };
  }
  if (maxAbs >= 1_000) {
    return { divisor: 1_000, suffix: 'K', label: 'USD, thousands', decimals: 1 };
  }
  return { divisor: 1, suffix: '', label: 'USD', decimals: 0 };
}

function buildRevenueTrendMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'custom-colors': {
        Revenue: '#2e7d32',
      },
      'custom-range': null,
      'show-legend': false,
      'show-grid': true,
      'show-x-grid': false,
      'show-value-labels': true,
      'value-label-position': 'outside',
      'column-spacing': 0.6,
      'plot-height': 300,
    },
    axes: {
      'y-grid': true,
      'y-labels': true,
      'y-position': 'outside',
      'y-label-alignment': 'left',
      'x-grid': false,
    },
    publish: {
      'embed-width': 1040,
      'embed-height': 300,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildMarginTrendMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'show-legend': true,
      'show-values': true,
      'value-label-alignment': 'right',
      'value-label-visibility': 'always',
      'labels-date-format': 'YYYY',
      'labels-alignment': 'left',
      'move-labels-to-new-line': false,
      'replace-flags': false,
      'stack-labels': false,
      'show-x-grid': false,
      'custom-range': null,
      'custom-colors': {
        'Gross Margin': '#35b24a',
        'Operating Margin': '#178f80',
        'Net Margin': '#2563eb',
      },
      'thicker-bars': false,
      'bar-background': false,
      'separating-lines': false,
      'sort-bars': false,
      'reverse-order': true,
      'group-bars-by-column': false,
    },
    publish: {
      'embed-width': 1040,
      'embed-height': 300,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildCashFlowProfileMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'custom-colors': {
        Value: '#2563eb',
      },
      'show-legend': false,
      'show-value-labels': true,
      'value-label-position': 'outside',
      'column-spacing': 0.6,
      'plot-height': 300,
      'sort-values': false,
      'reverse-order': false,
      'rotate-labels': 'never',
      'horizontal-label-alignment': 'below',
      'show-x-grid': false,
    },
    axes: {
      'y-grid': true,
      'y-labels': true,
      'y-position': 'outside',
      'y-label-alignment': 'left',
      'x-grid': false,
    },
    publish: {
      'embed-width': 960,
      'embed-height': 300,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildBalanceSheetPostureMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
      'highlighted-elements': ['Total Assets'],
    },
    visualize: {
      sharing: false,
      'bars-column': 'Value',
      'labels-alignment': 'left',
      'move-labels-to-new-line': false,
      'show-values': true,
      'value-alignment': 'left',
      'swap-labels-values': false,
      'replace-flags': false,
      'show-legend': true,
      'stack-labels': false,
      'x-grid': false,
      'custom-colors': {
        'Total Assets': '#0f766e',
        'Total Liabilities': '#dc2626',
        "Total Stockholders' Equity": '#6ee7b7',
        'Total Debt': '#f97316',
        'Cash & Equivalents': '#bbf7d0',
      },
      'separating-lines': false,
      'thicker-bars': true,
      'bar-background': true,
      'sort-bars': false,
      'reverse-order': false,
      'group-bars-by-column': false,
    },
    publish: {
      'embed-width': 960,
      'embed-height': 260,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildLiquidityProfileMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'bars-column': 'Value',
      'labels-alignment': 'left',
      'move-labels-to-new-line': false,
      'show-values': true,
      'value-alignment': 'left',
      'swap-labels-values': false,
      'replace-flags': false,
      'show-legend': false,
      'stack-labels': false,
      'x-grid': false,
      'custom-colors': {
        Value: '#2563eb',
      },
      'separating-lines': false,
      'bar-background': false,
      'thicker-bars': false,
      'sort-bars': false,
      'reverse-order': false,
      'group-bars-by-column': false,
    },
    publish: {
      'embed-width': 900,
      'embed-height': 220,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildReturnProfileMetadataPatch(): Record<string, unknown> {
  return {
    data: {
      transpose: false,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'pie-size': 0.75,
      'sort-by': 'value-desc',
      'convert-to-percentages': false,
      'inside-labels': true,
      'show-labels': true,
      'show-values': true,
      'outside-labels': false,
      'show-legend': true,
      'legend-position': 'top',
      'show-values-in-legend': false,
      'stack-labels': false,
      'max-slices': 5,
      'custom-colors': {
        'Return on Equity': '#38bdf8',
        'Return on Assets': '#1e3a8a',
      },
    },
    publish: {
      'embed-width': 900,
      'embed-height': 220,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function buildPerShareMetricsMetadataPatch(periodLabels: string[]): Record<string, unknown> {
  const earlier = periodLabels[0] || 'Earlier';
  const later = periodLabels[periodLabels.length - 1] || 'Later';
  return {
    data: {
      transpose: true,
    },
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
    },
    annotate: {
      notes: '',
    },
    visualize: {
      sharing: false,
      'labels-alignment': 'left',
      'replace-flags': false,
      'show-legend': true,
      'stack-labels': false,
      'custom-grid-lines': '0,25,50,100',
      'tick-position': 'below',
      'custom-colors': {
        [earlier]: '#2563eb',
        [later]: '#22c55e',
      },
      'outer-bar-series': earlier,
      'inner-bar-series': later,
      'thicker-bars': false,
      'separating-lines': false,
      'sort-bars': false,
      'reverse-order': false,
      'group-bars-by-column': false,
    },
    publish: {
      'embed-width': 960,
      'embed-height': 230,
      blocks: {
        download: true,
        embed: false,
        image: false,
        share: false,
      },
    },
  };
}

function formatScaledValue(value: number | null | undefined, divisor: number, decimals = 1): string {
  if (value === null || value === undefined) return '';
  const scaled = value / divisor;
  return scaled.toFixed(decimals);
}

function buildCsv(headers: string[], rows: string[][]): string {
  return `${[headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n')}\n`;
}

export function serializePreparedChartDataset(dataset: PreparedChartDataset): string {
  return buildCsv(dataset.headers, dataset.rows);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
