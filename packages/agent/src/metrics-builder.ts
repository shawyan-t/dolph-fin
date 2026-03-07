/**
 * Deterministic Key Metrics Section Builder.
 *
 * Generates clean Markdown tables from the locked canonical report model.
 * NO LLM involved — pure code.
 */

import type { ReportSection } from '@dolph/shared';
import type { CanonicalReportPackage } from './canonical-report-package.js';
import type { CompanyReportModel, ReportModel } from './report-model.js';
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
      rows.push(`*Period lock note: ${company.periodNote}*`);
    }
    rows.push('');
  }
  rows.push('The dashboard is grouped to surface headline signals first, then supporting detail.');
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
  for (const disclosure of mergeMetricBasisDisclosures(model.companies)) {
    rows.push(`*${disclosure}*`);
  }
  rows.push('');
  rows.push(`| Metric | ${tickers.join(' | ')} |`);
  rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);
  const periodValues = model.companies.map(company => company.snapshotLabel);
  rows.push(`| Snapshot Period | ${periodValues.join(' | ')} |`);
  rows.push('');

  const referenceGroups = mergeComparisonGroups(model.companies.map(company => company.comparisonGroups));
  for (const section of referenceGroups) {
    if (section.rows.length === 0) continue;
    const chunks = chunk(section.rows, FRONT_TABLE_MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const title = chunks.length === 1 ? section.title : `${section.title} (${i + 1}/${chunks.length})`;
      rows.push(`### ${title}`);
      rows.push('');
      rows.push(`| Metric | ${tickers.join(' | ')} |`);
      rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);

      for (const metric of chunks[i]!) {
        const values = model.companies.map(company => company.metricsByLabel.get(metric.label)?.currentDisplay || 'Unavailable');
        rows.push(`| ${metric.label} | ${values.join(' | ')} |`);
      }
      rows.push('');
    }
  }

  return rows.join('\n').trim();
}

function buildMetricBasisDisclosures(company: CompanyReportModel): string[] {
  const lines: string[] = [];
  const bases = company.metrics
    .filter(metric => metric.basis)
    .map(metric => metric.basis!);
  const seen = new Set<string>();
  for (const basis of bases) {
    const text = `${basis.displayName}: ${basis.disclosureText || basis.note || humanizeBasis(basis.basis)}${basis.fallbackUsed ? ' Fallback was applied and is audit-traceable.' : ''}`;
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines.slice(0, 4);
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
  return lines.slice(0, 5);
}

function companyComparisonDisclosure(model: ReportModel): string {
  const policy = model.companies[0]?.policy;
  const basis = model.comparisonBasis;
  if (!policy) {
    return 'Peer metrics are shown on the canonical latest annual basis available for each company.';
  }
  if (basis?.effective_mode === 'overlap_normalized') {
    if (basis.note) {
      return basis.note;
    }
    return 'Peer metrics are overlap-normalized to the same comparable annual periods across all companies.';
  }
  if ((basis?.effective_mode || policy.comparisonBasisMode) === 'latest_per_peer_screening') {
    return basis?.note || 'Peer metrics use each company’s latest annual filing and should be treated as screening output, not strict like-for-like comparison.';
  }
  return basis?.note || 'Peer metrics use each company’s latest annual filing with prominent disclosure that fiscal year-ends can differ across peers.';
}

function humanizeBasis(basis: string): string {
  return basis.replace(/_/g, ' ');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function mergeComparisonGroups(
  groupsByCompany: Array<Array<{ title: string; rows: Array<{ label: string }> }>>,
): Array<{ title: string; rows: Array<{ label: string }> }> {
  const merged = new Map<string, Map<string, { label: string }>>();
  for (const companyGroups of groupsByCompany) {
    for (const group of companyGroups) {
      let bucket = merged.get(group.title);
      if (!bucket) {
        bucket = new Map();
        merged.set(group.title, bucket);
      }
      for (const row of group.rows) {
        if (!bucket.has(row.label)) bucket.set(row.label, { label: row.label });
      }
    }
  }
  return Array.from(merged.entries()).map(([title, rows]) => ({
    title,
    rows: Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label)),
  }));
}
