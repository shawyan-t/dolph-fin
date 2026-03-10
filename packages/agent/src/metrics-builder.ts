/**
 * Deterministic Key Metrics Section Builder.
 *
 * Generates clean Markdown tables from the locked canonical report model.
 * NO LLM involved — pure code.
 */

import type { ReportSection } from '@dolph/shared';
import type { CanonicalReportPackage } from './canonical-report-package.js';
import {
  collectMetricBasisDisclosures,
  type CompanyReportModel,
  type ReportModel,
} from './report-model.js';
const FRONT_TABLE_MAX_ROWS = 8;

/**
 * Build the Key Metrics section deterministically.
 * For single-company: a Metric | Current | Prior | Change table.
 * For comparison: a Metric | Ticker1 | Ticker2 | ... table.
 */
export function buildKeyMetricsSection(
  canonicalPackage: CanonicalReportPackage,
): ReportSection {
  const { context } = canonicalPackage;
  const content = context.type === 'comparison'
    ? buildComparisonMetricsTable(canonicalPackage)
    : buildSingleMetricsTable(canonicalPackage);

  return {
    id: 'key_metrics',
    title: context.type === 'comparison' ? 'Key Metrics Comparison' : 'Key Metrics Dashboard',
    content,
  };
}

function buildSingleMetricsTable(
  canonicalPackage: CanonicalReportPackage,
): string {
  const model = canonicalPackage.reportModel;
  const company = model.companies[0];

  if (!company || company.metrics.length === 0) {
    return '*No key metrics data available.*';
  }

  const rows: string[] = [];
  if (company.snapshotPeriod) {
    const snapshot = company.snapshotLabel;
    const prior = company.priorPeriod ? company.priorLabel : null;
    rows.push(
      prior
        ? `*Snapshot period: ${snapshot}. Prior period: ${prior}.*`
        : `*Snapshot period: ${snapshot}.*`,
    );
    if (company.periodNote) {
      rows.push(`*Period note: ${company.periodNote}*`);
    }
    rows.push('');
  }
  rows.push('The dashboard uses the same row order across reports, and values the filing does not disclose remain explicitly marked rather than being hidden.');
  for (const disclosure of buildMetricBasisDisclosures(company)) {
    rows.push(`*${disclosure}*`);
  }
  rows.push('');

  for (const section of company.dashboardGroups) {
    if (section.rows.length === 0) continue;
    const chunks = chunk(section.rows, FRONT_TABLE_MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const title = chunks.length === 1 ? section.title : `${section.title} (${i + 1}/${chunks.length})`;
      rows.push(`### ${title}`);
      rows.push('');
      rows.push('| Metric | Current Value | Prior Period | Change (%) |');
      rows.push('|:---|---:|---:|---:|');
      for (const metric of chunks[i]!) {
        rows.push(`| ${metric.label} | ${metric.currentDisplay} | ${metric.priorDisplay} | ${metric.changeDisplay} |`);
      }
      rows.push('');
    }
  }

  return rows.join('\n').trim();
}

function buildComparisonMetricsTable(
  canonicalPackage: CanonicalReportPackage,
): string {
  const model = canonicalPackage.reportModel;
  const tickers = model.companies.map(company => company.ticker);
  if (model.companies.length === 0) {
    return '*No comparison metrics data available.*';
  }

  const rows: string[] = [];
  rows.push(companyComparisonDisclosure(model));
  rows.push('*The comparison table uses the same row order for every company, and values missing from the filings remain explicitly marked.*');
  for (const disclosure of mergeMetricBasisDisclosures(model.companies)) {
    rows.push(`*${disclosure}*`);
  }
  rows.push('');
  rows.push(`| Metric | ${tickers.join(' | ')} |`);
  rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);
  const periodValues = model.companies.map(company => company.snapshotLabel);
  rows.push(`| Snapshot Period | ${periodValues.join(' | ')} |`);
  rows.push('');

  for (const section of model.comparisonRowGroups) {
    const companyRows = model.companies.map(company => {
      const group = company.comparisonGroups.find(candidate => candidate.title === section.title);
      return new Map((group?.rows || []).map(row => [row.label, row]));
    });
    if (section.rowLabels.length === 0) continue;
    const chunks = chunk(section.rowLabels, FRONT_TABLE_MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const title = chunks.length === 1 ? section.title : `${section.title} (${i + 1}/${chunks.length})`;
      rows.push(`### ${title}`);
      rows.push('');
      rows.push(`| Metric | ${tickers.join(' | ')} |`);
      rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);

      for (const label of chunks[i]!) {
        const values = companyRows.map(metricMap => metricMap.get(label)?.currentDisplay || 'Not reported');
        rows.push(`| ${label} | ${values.join(' | ')} |`);
      }
      rows.push('');
    }
  }

  return rows.join('\n').trim();
}

function buildMetricBasisDisclosures(company: CompanyReportModel): string[] {
  return collectMetricBasisDisclosures(company);
}

function mergeMetricBasisDisclosures(
  companies: ReportModel['companies'],
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const company of companies) {
    for (const disclosure of buildMetricBasisDisclosures(company)) {
      if (seen.has(disclosure)) continue;
      seen.add(disclosure);
      lines.push(disclosure);
    }
  }
  return lines;
}

function companyComparisonDisclosure(model: ReportModel): string {
  const policy = model.companies[0]?.policy;
  const basis = model.comparisonBasis;
  if (!policy) {
    return 'Peer metrics are shown for the latest annual filing available for each company.';
  }
  if (basis?.effective_mode === 'overlap_normalized') {
    if (basis.note) {
      return basis.note;
    }
    return 'Peer metrics are aligned to the same annual periods across all companies.';
  }
  if ((basis?.effective_mode || policy.comparisonBasisMode) === 'latest_per_peer_screening') {
    return basis?.note || 'Peer metrics use each company’s latest annual filing and should be read as a directional comparison rather than a strict like-for-like comparison.';
  }
  return basis?.note || 'Peer metrics use each company’s latest annual filing, and fiscal year-ends can differ across the companies shown.';
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
