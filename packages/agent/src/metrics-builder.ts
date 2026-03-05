/**
 * Deterministic Key Metrics Section Builder.
 *
 * Generates a clean Markdown table from ratios and trends data.
 * NO LLM involved — pure code.
 */

import { formatCompactShares } from '@dolph/shared';
import type { AnalysisContext, ReportSection } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';

interface MetricDatum {
  current: number;
  prior: number | null;
  change: number | null;
  unit: string;
}

const METRIC_GROUPS: Array<{ title: string; metrics: string[] }> = [
  {
    title: 'Profitability',
    metrics: [
      'Operating Margin',
      'Net Margin',
      'Gross Margin',
      'Return on Equity',
      'Return on Assets',
    ],
  },
  {
    title: 'Liquidity & Leverage',
    metrics: [
      'Current Ratio',
      'Quick Ratio',
      'Debt-to-Equity',
    ],
  },
  {
    title: 'Scale',
    metrics: [
      'Revenue',
      'Net Income',
      'Operating Income',
      'Total Assets',
      "Stockholders' Equity",
      'Total Liabilities',
    ],
  },
  {
    title: 'Cash Flow & Per Share',
    metrics: [
      'Operating Cash Flow',
      'Free Cash Flow',
      'Capital Expenditures',
      'Earnings Per Share (Diluted)',
      'Book Value Per Share',
    ],
  },
];
const FRONT_TABLE_MAX_ROWS = 8;

/**
 * Build the Key Metrics section deterministically.
 * For single-company: a Metric | Current | Prior | Change table.
 * For comparison: a Metric | Ticker1 | Ticker2 | ... table.
 */
export function buildKeyMetricsSection(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): ReportSection {
  const content = context.type === 'comparison'
    ? buildComparisonMetricsTable(context, insights)
    : buildSingleMetricsTable(context, insights);

  return {
    id: 'key_metrics',
    title: context.type === 'comparison' ? 'Key Metrics Comparison' : 'Key Metrics Dashboard',
    content,
  };
}

function buildSingleMetricsTable(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const ticker = context.tickers[0]!;
  const tickerInsights = insights[ticker];

  if (!tickerInsights || Object.keys(tickerInsights.keyMetrics).length === 0) {
    return '*No key metrics data available.*';
  }

  const rows: string[] = [];
  if (tickerInsights.snapshotPeriod) {
    const snapshot = formatSnapshotLabel(tickerInsights.snapshotPeriod);
    const prior = tickerInsights.priorPeriod ? formatSnapshotLabel(tickerInsights.priorPeriod) : null;
    rows.push(
      prior
        ? `*Snapshot period: ${snapshot}. Prior period: ${prior}.*`
        : `*Snapshot period: ${snapshot}.*`,
    );
    if (tickerInsights.periodBasis?.note) {
      rows.push(`*Period lock note: ${tickerInsights.periodBasis.note}*`);
    }
    rows.push('');
  }
  rows.push('The dashboard is grouped to surface headline signals first, then supporting detail.');
  rows.push('');

  const grouped = groupMetrics(tickerInsights.keyMetrics);
  for (const section of grouped) {
    if (section.rows.length === 0) continue;
    const chunks = chunk(section.rows, FRONT_TABLE_MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const title = chunks.length === 1 ? section.title : `${section.title} (${i + 1}/${chunks.length})`;
      rows.push(`### ${title}`);
      rows.push('');
      rows.push('| Metric | Current Value | Prior Period | Change (%) |');
      rows.push('|:---|---:|---:|---:|');
      for (const [name, data] of chunks[i]!) {
        const current = formatValue(data.current, data.unit);
        const prior = data.prior !== null ? formatValue(data.prior, data.unit) : 'N/A';
        const change = data.change !== null ? `${(data.change * 100).toFixed(1)}%` : 'N/A';
        rows.push(`| ${name} | ${current} | ${prior} | ${change} |`);
      }
      rows.push('');
    }
  }

  return rows.join('\n').trim();
}

function buildComparisonMetricsTable(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const tickers = context.tickers;

  // Collect all metric names across all tickers
  const allMetricNames = new Set<string>();
  for (const ticker of tickers) {
    const metrics = insights[ticker]?.keyMetrics;
    if (metrics) {
      for (const name of Object.keys(metrics)) {
        allMetricNames.add(name);
      }
    }
  }

  if (allMetricNames.size === 0) {
    return '*No comparison metrics data available.*';
  }

  const rows: string[] = [];
  rows.push('Each company is shown at its own latest annual filing period; fiscal year-ends can differ across peers.');
  rows.push('');
  rows.push(`| Metric | ${tickers.join(' | ')} |`);
  rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);
  const periodValues = tickers.map(ticker => {
    const p = insights[ticker]?.snapshotPeriod;
    return p ? formatSnapshotLabel(p) : 'N/A';
  });
  rows.push(`| Snapshot Period | ${periodValues.join(' | ')} |`);
  rows.push('');

  const grouped = groupComparisonMetricNames(Array.from(allMetricNames));
  for (const section of grouped) {
    if (section.metrics.length === 0) continue;
    const chunks = chunk(section.metrics, FRONT_TABLE_MAX_ROWS);
    for (let i = 0; i < chunks.length; i++) {
      const title = chunks.length === 1 ? section.title : `${section.title} (${i + 1}/${chunks.length})`;
      rows.push(`### ${title}`);
      rows.push('');
      rows.push(`| Metric | ${tickers.join(' | ')} |`);
      rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);

      for (const name of chunks[i]!) {
        const values = tickers.map(ticker => {
          const data = insights[ticker]?.keyMetrics[name];
          if (!data) return 'N/A';
          return formatValue(data.current, data.unit);
        });
        rows.push(`| ${name} | ${values.join(' | ')} |`);
      }
      rows.push('');
    }
  }

  return rows.join('\n').trim();
}

function formatValue(value: number, unit: string): string {
  if (!isFinite(value)) return 'N/A';
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'USD') return formatUSDInBillions(value);
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${value.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(value);
  return `${value}`;
}

function formatUSDInBillions(value: number): string {
  const sign = value < 0 ? '-' : '';
  const billions = Math.abs(value) / 1e9;
  if (billions >= 100) return `${sign}$${billions.toFixed(0)}B`;
  if (billions >= 10) return `${sign}$${billions.toFixed(1)}B`;
  return `${sign}$${billions.toFixed(2)}B`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function formatSnapshotLabel(period: string): string {
  const date = new Date(period);
  if (isNaN(date.getTime())) return period;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (month === 11) return `FY${year}`;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  return `FY${year} (${monthNames[month] || 'Dec'})`;
}

function groupMetrics(
  metrics: Record<string, MetricDatum>,
): Array<{ title: string; rows: Array<[string, MetricDatum]> }> {
  const used = new Set<string>();
  const grouped = METRIC_GROUPS.map(group => {
    const rows: Array<[string, MetricDatum]> = [];
    for (const metric of group.metrics) {
      const data = metrics[metric];
      if (!data) continue;
      rows.push([metric, data]);
      used.add(metric);
    }
    return { title: group.title, rows };
  });

  const extras = Object.entries(metrics)
    .filter(([name]) => !used.has(name))
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (extras.length >= 3) {
    grouped.push({ title: 'Additional Metrics', rows: extras });
  }

  return grouped;
}

function groupComparisonMetricNames(
  metricNames: string[],
): Array<{ title: string; metrics: string[] }> {
  const used = new Set<string>();
  const grouped = METRIC_GROUPS.map(group => {
    const metrics = group.metrics.filter(name => metricNames.includes(name));
    for (const m of metrics) used.add(m);
    return { title: group.title, metrics };
  });

  const extras = metricNames
    .filter(name => !used.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (extras.length >= 3) {
    grouped.push({ title: 'Additional Metrics', metrics: extras });
  }

  return grouped;
}
