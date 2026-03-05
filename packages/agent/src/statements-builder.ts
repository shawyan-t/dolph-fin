/**
 * Deterministic Financial Statements Section Builder.
 *
 * Generates clean Markdown tables from structured FinancialStatement data.
 * NO LLM involved — pure code. This replaces the LLM-generated
 * "Financial Statements" section to ensure consistent table formatting.
 */

import type { AnalysisContext, ReportSection, FinancialStatement } from '@dolph/shared';
import {
  getMappingByName,
  getMappingsForStatement,
  formatCompactCurrency,
  formatCompactShares,
} from '@dolph/shared';

/**
 * Build the Financial Statements section deterministically from pipeline data.
 * For single-company: income statement, balance sheet, cash flow tables.
 * For comparison: builds tables for EACH ticker (not just the first).
 */
export function buildFinancialStatementsSection(context: AnalysisContext): ReportSection {
  const parts: string[] = [];

  for (const ticker of context.tickers) {
    const statements = context.statements[ticker] || [];
    const facts = context.facts[ticker];
    const appendixLetter = String.fromCharCode(65 + Math.min(25, context.tickers.indexOf(ticker)));

    if (context.tickers.length > 1) {
      parts.push(`### Appendix ${appendixLetter} — ${ticker} Financial Statements`);
      parts.push('');
    } else {
      parts.push('### Appendix A — Financial Statements');
      parts.push('');
    }

    const incomeStmt = statements.find(s => s.statement_type === 'income');
    const balanceStmt = statements.find(s => s.statement_type === 'balance_sheet');
    const cashFlowStmt = statements.find(s => s.statement_type === 'cash_flow');

    let hasData = false;

    if (incomeStmt && incomeStmt.periods.length > 0) {
      parts.push('#### Income Statement');
      parts.push('');
      parts.push(buildStatementTable(incomeStmt));
      parts.push('');
      hasData = true;
    }

    if (balanceStmt && balanceStmt.periods.length > 0) {
      parts.push('#### Balance Sheet');
      parts.push('');
      parts.push(buildStatementTable(balanceStmt));
      parts.push('');
      hasData = true;
    }

    if (cashFlowStmt && cashFlowStmt.periods.length > 0) {
      parts.push('#### Cash Flow Statement');
      parts.push('');
      parts.push(buildStatementTable(cashFlowStmt));
      parts.push('');
      hasData = true;
    }

    // Fallback to facts summary if no structured statements
    if (!hasData && facts && facts.facts.length > 0) {
      parts.push(buildFactsSummaryTable(facts));
      parts.push('');
      hasData = true;
    }

    if (!hasData) {
      parts.push(`*Financial statement data not available for ${ticker}.*`);
      parts.push('');
    }

    // Add FX note if applicable
    if (facts?.fx_note) {
      parts.push(`*Note: ${facts.fx_note}. All values converted to USD.*`);
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

/**
 * Build a Markdown table from a FinancialStatement.
 * Takes the most recent 3 periods and formats values as $X.XB / $X.XM.
 */
function buildStatementTable(statement: FinancialStatement): string {
  // Take the most recent 3 periods
  const periods = statement.periods.slice(0, 3);
  if (periods.length === 0) return '*No data available.*';

  // Collect all metrics that appear across these periods
  const allMetrics = new Set<string>();
  for (const p of periods) {
    for (const key of Object.keys(p.data)) {
      allMetrics.add(key);
    }
  }

  if (allMetrics.size === 0) return '*No data available.*';

  // Build header row
  const periodLabels = periods.map(p => formatPeriodLabel(p.period));
  const header = `| Metric | ${periodLabels.join(' | ')} |`;
  const separator = `|:---|${periodLabels.map(() => '---:').join('|')}|`;

  const mappingOrder = new Map(
    getMappingsForStatement(statement.statement_type)
      .map((m, idx) => [m.standardName, idx] as const),
  );
  const orderedMetrics = Array.from(allMetrics).sort((a, b) => {
    const aIdx = mappingOrder.has(a) ? mappingOrder.get(a)! : 999;
    const bIdx = mappingOrder.has(b) ? mappingOrder.get(b)! : 999;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.localeCompare(b);
  });

  // Build data rows
  const rows: string[] = [];
  for (const metric of orderedMetrics) {
    const mapping = getMappingByName(metric);
    const displayName = mapping?.displayName || formatMetricName(metric);

    const values = periods.map(p => {
      const val = p.data[metric];
      if (val === undefined || val === null) return 'N/A';
      return formatByUnit(val, mapping?.unit);
    });

    rows.push(`| ${displayName} | ${values.join(' | ')} |`);
  }

  const chunks = chunk(rows, 14);
  if (chunks.length === 1) {
    return [header, separator, ...rows].join('\n');
  }

  const tables: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) tables.push(`*Table continuation (${i + 1}/${chunks.length})*`, '');
    tables.push([header, separator, ...chunks[i]!].join('\n'));
    tables.push('');
  }
  return tables.join('\n').trim();
}

/**
 * Build a summary table from raw facts when structured statements are unavailable.
 */
function buildFactsSummaryTable(facts: import('@dolph/shared').CompanyFacts): string {
  const lines: string[] = [];
  lines.push('### Key Financial Data');
  lines.push('');

  // Get the 3 most recent periods across all facts
  const allPeriods = new Set<string>();
  for (const fact of facts.facts) {
    for (const period of fact.periods.slice(0, 5)) {
      allPeriods.add(period.period);
    }
  }

  const periods = Array.from(allPeriods).sort((a, b) => b.localeCompare(a)).slice(0, 3);

  if (periods.length === 0) return '*No financial data available.*';

  const periodLabels = periods.map(formatPeriodLabel);
  const header = `| Metric | ${periodLabels.join(' | ')} |`;
  const separator = `|:---|${periodLabels.map(() => '---:').join('|')}|`;

  const rows: string[] = [];
  for (const fact of facts.facts) {
    const mapping = getMappingByName(fact.metric);
    const displayName = mapping?.displayName || formatMetricName(fact.metric);

    const values = periods.map(period => {
      const match = fact.periods.find(p => p.period === period);
      if (!match) return 'N/A';
      return formatByUnit(match.value, mapping?.unit);
    });

    rows.push(`| ${displayName} | ${values.join(' | ')} |`);
  }

  lines.push(header);
  lines.push(separator);
  lines.push(...rows);

  return lines.join('\n');
}

/**
 * Format a period string (e.g., "2024-12-31") to a fiscal year label.
 */
function formatPeriodLabel(period: string): string {
  const date = new Date(period);
  if (isNaN(date.getTime())) return period;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-indexed

  // Most fiscal years end in Q4 (Oct-Nov-Dec)
  if (month >= 10) return `FY${year}`;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  return `FY${year} (${monthNames[month - 1]})`;
}

/**
 * Format a metric name from snake_case to Title Case.
 */
function formatMetricName(metric: string): string {
  return metric
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Format a value using its XBRL unit metadata.
 */
function formatByUnit(n: number, unit?: string): string {
  if (!isFinite(n)) return 'N/A';
  switch (unit) {
    case 'USD/share':
    case 'USD/shares': return `$${n.toFixed(2)}`;
    case 'shares': return formatCompactShares(n);
    case 'pure': return n.toFixed(4);
    case 'USD':
    default: return formatCompactCurrency(n, { smallDecimals: 0, compactDecimals: 1 });
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
