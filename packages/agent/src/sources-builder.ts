import type { ReportSection } from '@shawyan/shared';
import type { CanonicalReportPackage } from './canonical-report-package.js';
import { requireCanonicalReportPackage } from './canonical-report-package.js';

export interface CanonicalSourceRow {
  ticker: string;
  cik: string;
  companyName: string;
  accession: string;
  form: string;
  filed: string;
  url: string;
  periods: string[];
  metrics: string[];
  sourceKinds: string[];
}

export function buildCanonicalSourceRows(
  canonicalPackage: CanonicalReportPackage,
): CanonicalSourceRow[] {
  const { context, reportModel } = requireCanonicalReportPackage(canonicalPackage, 'buildCanonicalSourceRows');
  const rows: CanonicalSourceRow[] = [];

  for (const company of reportModel.companies) {
    const cik = context.facts[company.ticker]?.cik || 'Not reported';
    const companyName = context.facts[company.ticker]?.company_name || company.companyName;
    for (const filing of company.filingReferences) {
      if (!filing.url) continue;
      rows.push({
        ticker: company.ticker,
        cik,
        companyName,
        accession: filing.accessionNumber || 'Not reported',
        form: filing.form || 'SEC filing',
        filed: filing.filed || 'Not reported',
        url: filing.url,
        periods: [...filing.periods],
        metrics: [...filing.metrics],
        sourceKinds: [...filing.sourceKinds],
      });
    }
  }

  rows.sort((a, b) => {
    if (a.ticker !== b.ticker) return a.ticker.localeCompare(b.ticker);
    return b.filed.localeCompare(a.filed);
  });
  return rows;
}

export function buildDataSourcesSection(
  canonicalPackage: CanonicalReportPackage,
): ReportSection {
  const { context } = requireCanonicalReportPackage(canonicalPackage, 'buildDataSourcesSection');
  const rows = buildCanonicalSourceRows(canonicalPackage);
  const lines: string[] = [];

  if (rows.length === 0) {
    lines.push('- No SEC filing references were captured for this run.');
  } else {
    for (const row of rows) {
      const periodText = row.periods.length > 0 ? `; periods: ${row.periods.join(', ')}` : '';
      const kindText = row.sourceKinds.length > 0 ? `; sources: ${row.sourceKinds.join(', ')}` : '';
      lines.push(`- [${row.ticker} ${row.form} (${row.filed})](${row.url})${periodText}${kindText}`);
    }
  }

  if ((context.comparison_exclusions || []).length > 0) {
    lines.push('');
    lines.push('Excluded issuers:');
    for (const exclusion of context.comparison_exclusions || []) {
      lines.push(`- ${exclusion.ticker}: ${exclusion.reason}`);
    }
  }

  lines.push('');
  lines.push('Source: SEC EDGAR public filings.');
  lines.push('Disclaimer: For research use only; not investment advice.');

  return {
    id: 'data_sources',
    title: 'Data Sources',
    content: lines.join('\n'),
  };
}
