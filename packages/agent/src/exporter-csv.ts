/**
 * CSV exporter — writes deterministic filing-backed data to one unified CSV file.
 */

import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Report, AnalysisContext } from '@shawyan/shared';
import type { ReportModel } from './report-model.js';
import { buildReportDataRows } from './report-data-rows.js';
import {
  generateChartsForReportModel,
  serializePreparedChartDataset,
} from './charts.js';
import type {
  FactDataRow,
  MetricDataRow,
  RatioDataRow,
} from './report-data-rows.js';

interface CSVExportResult {
  combinedPath: string;
  chartDataDir: string;
  chartPaths: string[];
}

export async function exportCSV(
  report: Report,
  context: AnalysisContext,
  reportModel: ReportModel,
  outputDir: string,
): Promise<CSVExportResult> {
  await mkdir(outputDir, { recursive: true });

  const slug = report.tickers.join('-');
  const combinedPath = resolve(outputDir, `${slug}_data.csv`);
  const chartDataDir = resolve(outputDir, `${slug}_chart_data`);
  const obsoleteVizPath = resolve(outputDir, `${slug}_viz.csv`);
  const rows = buildReportDataRows(context, reportModel);
  const chartSet = generateChartsForReportModel(context, reportModel);

  const combinedRows = [
    ...rows.facts.map(row => unifyFactRow(report, row)),
    ...rows.metrics.map(row => unifyMetricRow(report, row)),
    ...rows.ratios.map(row => unifyRatioRow(report, row)),
  ].sort(compareUnifiedRows);

  const combinedCsv = rowsToCSV(combinedRows, UNIFIED_HEADERS);
  await writeFile(combinedPath, combinedCsv, 'utf8');
  await mkdir(chartDataDir, { recursive: true });
  const chartPaths: string[] = [];
  for (const [index, item] of chartSet.items.entries()) {
    const fileName = `${String(index + 1).padStart(2, '0')}_${sanitizeFileName(item.key)}.csv`;
    const chartPath = resolve(chartDataDir, fileName);
    await writeFile(chartPath, serializePreparedChartDataset(item.dataset), 'utf8');
    chartPaths.push(chartPath);
  }
  await unlink(obsoleteVizPath).catch(() => {});

  return { combinedPath, chartDataDir, chartPaths };
}

type UnifiedCsvRow = Record<typeof UNIFIED_HEADERS[number], string | number | boolean | null>;

const UNIFIED_HEADERS = [
  'dataset_type',
  'report_type',
  'request_tickers',
  'ticker',
  'company_name',
  'cik',
  'period',
  'period_role',
  'form',
  'fiscal_year',
  'fiscal_period',
  'filed',
  'field_key',
  'field_label',
  'value',
  'value_unit',
  'value_class',
  'availability_reason',
  'source_kind',
  'reported_or_derived',
  'formula',
  'components',
  'notes',
  'chart_meaningful',
  'chart_note',
  'reported_label',
  'reported_description',
  'reported_value',
  'reported_unit',
  'detail',
  'xbrl_tag',
  'namespace',
  'selection_policy',
  'concept_scope',
  'accession',
  'filing_url',
] as const;

function unifyFactRow(report: Report, row: FactDataRow): UnifiedCsvRow {
  return {
    dataset_type: 'fact',
    report_type: report.type,
    request_tickers: report.tickers.join('|'),
    ticker: row.ticker,
    company_name: row.company_name,
    cik: row.cik,
    period: row.period,
    period_role: 'historical',
    form: row.form,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    filed: row.filed,
    field_key: row.metric,
    field_label: row.reported_label || row.metric,
    value: row.reported_value,
    value_unit: row.reported_unit,
    value_class: 'reported_fact',
    availability_reason: 'reported',
    source_kind: 'reported',
    reported_or_derived: 'reported',
    formula: '',
    components: '',
    notes: '',
    chart_meaningful: '',
    chart_note: '',
    reported_label: row.reported_label,
    reported_description: row.reported_description,
    reported_value: row.reported_value,
    reported_unit: row.reported_unit,
    detail: '',
    xbrl_tag: row.xbrl_tag,
    namespace: row.namespace,
    selection_policy: row.selection_policy,
    concept_scope: row.concept_scope,
    accession: row.accession,
    filing_url: row.filing_url,
  };
}

function unifyMetricRow(report: Report, row: MetricDataRow): UnifiedCsvRow {
  return {
    dataset_type: 'metric',
    report_type: report.type,
    request_tickers: report.tickers.join('|'),
    ticker: row.ticker,
    company_name: row.company_name,
    cik: row.cik,
    period: row.period,
    period_role: row.period_role,
    form: row.form,
    fiscal_year: '',
    fiscal_period: '',
    filed: row.filed,
    field_key: row.metric_key,
    field_label: row.metric_label,
    value: row.resolved_value,
    value_unit: row.resolved_unit,
    value_class: 'canonical_metric',
    availability_reason: row.availability_reason,
    source_kind: row.source_kind,
    reported_or_derived: row.reported_or_derived,
    formula: '',
    components: '',
    notes: '',
    chart_meaningful: '',
    chart_note: '',
    reported_label: row.reported_label,
    reported_description: '',
    reported_value: row.reported_value,
    reported_unit: row.reported_unit,
    detail: row.detail,
    xbrl_tag: row.xbrl_tag,
    namespace: row.namespace,
    selection_policy: '',
    concept_scope: '',
    accession: row.accession,
    filing_url: row.filing_url,
  };
}

function unifyRatioRow(report: Report, row: RatioDataRow): UnifiedCsvRow {
  return {
    dataset_type: 'ratio',
    report_type: report.type,
    request_tickers: report.tickers.join('|'),
    ticker: row.ticker,
    company_name: row.company_name,
    cik: row.cik,
    period: row.period,
    period_role: row.period_role,
    form: '',
    fiscal_year: '',
    fiscal_period: '',
    filed: '',
    field_key: row.ratio_key,
    field_label: row.ratio_label,
    value: row.value,
    value_unit: 'ratio',
    value_class: 'canonical_ratio',
    availability_reason: row.availability_reason,
    source_kind: '',
    reported_or_derived: row.value === null ? 'missing' : 'derived',
    formula: row.formula,
    components: row.components,
    notes: row.notes,
    chart_meaningful: row.chart_meaningful,
    chart_note: row.chart_note,
    reported_label: '',
    reported_description: '',
    reported_value: '',
    reported_unit: '',
    detail: '',
    xbrl_tag: '',
    namespace: '',
    selection_policy: '',
    concept_scope: '',
    accession: '',
    filing_url: '',
  };
}

function compareUnifiedRows(left: UnifiedCsvRow, right: UnifiedCsvRow): number {
  return compareValues(left.ticker, right.ticker)
    || compareValues(datasetTypeOrder(left.dataset_type), datasetTypeOrder(right.dataset_type))
    || compareValues(periodRoleOrder(left.period_role), periodRoleOrder(right.period_role))
    || compareValues(left.period, right.period)
    || compareValues(left.field_label, right.field_label);
}

function datasetTypeOrder(value: string | number | boolean | null): number {
  const order: Record<string, number> = {
    fact: 0,
    metric: 1,
    ratio: 2,
  };
  return order[String(value ?? '')] ?? 99;
}

function periodRoleOrder(value: string | number | boolean | null): number {
  const order: Record<string, number> = {
    snapshot: 0,
    prior: 1,
    historical: 2,
  };
  return order[String(value ?? '')] ?? 99;
}

function compareValues(left: string | number | boolean | null, right: string | number | boolean | null): number {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function rowsToCSV<T extends object>(rows: T[], headers: readonly string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    const cells = headers.map(header => formatCell((row as Record<string, unknown>)[header]));
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

function formatCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]/gi, '_');
}
