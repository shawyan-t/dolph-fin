/**
 * Deterministic Financial Statements Section Builder.
 *
 * Generates clean Markdown tables from the locked canonical report model.
 * NO LLM involved — pure code. This replaces the LLM-generated
 * "Financial Statements" section to ensure consistent table formatting.
 */

import type { ReportSection } from '@dolph/shared';
import type { CanonicalReportPackage } from './canonical-report-package.js';
import type { CanonicalStatementTable } from './report-model.js';

/**
 * Build the Financial Statements section deterministically from pipeline data.
 * For single-company: income statement, balance sheet, cash flow tables.
 * For comparison: builds tables for EACH ticker using the same locked periods
 * as the cover, dashboard, and charts.
 */
export function buildFinancialStatementsSection(
  canonicalPackage: CanonicalReportPackage,
): ReportSection {
  const parts: string[] = [];
  const { context, reportModel: model } = canonicalPackage;

  for (const company of model.companies) {
    const appendixLetter = String.fromCharCode(65 + Math.min(25, context.tickers.indexOf(company.ticker)));

    if (context.tickers.length > 1) {
      parts.push(`### Appendix ${appendixLetter} — ${company.ticker} Financial Statements`);
      parts.push('');
    } else {
      parts.push('### Appendix A — Financial Statements');
      parts.push('');
    }

    let hasData = false;
    for (const table of company.statementTables) {
      parts.push(`#### ${table.title}`);
      parts.push('');
      parts.push(renderStatementTable(table));
      parts.push('');
      hasData = true;
    }

    if (!hasData) {
      parts.push(`*Financial statement data not available for ${company.ticker}.*`);
      parts.push('');
    } else {
      const basisNotes = company.metrics
        .filter(metric => metric.basis)
        .map(metric => metric.basis!)
        .filter((basis, idx, arr) => arr.findIndex(other => other.displayName === basis.displayName && other.basis === basis.basis && other.disclosureText === basis.disclosureText && other.note === basis.note) === idx)
        .slice(0, 4)
        .map(basis => `*${basis.displayName}: ${basis.disclosureText || basis.note || basis.basis}*`);
      for (const note of basisNotes) {
        parts.push(note);
      }
      parts.push('*Rows labeled "(derived)" are deterministic inferences from filing-linked data; "(reported/reconciled)" rows blend reported lines with governed reconciliation logic.*');
      parts.push('');
    }

    if (company.fxNote) {
      parts.push(`*Note: ${company.fxNote}. All values converted to USD.*`);
      parts.push('');
    }

    if (context.tickers.length > 1) {
      parts.push('---');
      parts.push('');
    }
  }

  if (parts.length === 0) {
    parts.push('*No financial statement data available.*');
  }

  return {
    id: 'financial_statements',
    title: 'Financial Statements',
    content: parts.join('\n'),
  };
}

function renderStatementTable(table: CanonicalStatementTable): string {
  const header = `| Metric | ${table.periodLabels.join(' | ')} |`;
  const separator = `|:---|${table.periodLabels.map(() => '---:').join('|')}|`;
  const bodyRows = table.rows.map(row => `| ${row.label} | ${row.displays.join(' | ')} |`);

  const chunks = chunk(bodyRows, 14);
  if (chunks.length === 1) {
    return [header, separator, ...bodyRows].join('\n');
  }

  const tables: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) tables.push(`*Table continuation (${i + 1}/${chunks.length})*`, '');
    tables.push([header, separator, ...chunks[i]!].join('\n'));
    tables.push('');
  }
  return tables.join('\n').trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
