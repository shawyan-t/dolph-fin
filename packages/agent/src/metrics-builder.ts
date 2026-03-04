/**
 * Deterministic Key Metrics Section Builder.
 *
 * Generates a clean Markdown table from ratios and trends data.
 * NO LLM involved — pure code.
 */

import { formatCompactCurrency, formatCompactShares } from '@dolph/shared';
import type { AnalysisContext, ReportSection } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';

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
  rows.push('| Metric | Current Value | Prior Period | Change (%) |');
  rows.push('|:---|---:|---:|---:|');

  for (const [name, data] of Object.entries(tickerInsights.keyMetrics)) {
    const current = formatValue(data.current, data.unit);
    const prior = data.prior !== null ? formatValue(data.prior, data.unit) : '—';
    const change = data.change !== null ? `${(data.change * 100).toFixed(1)}%` : '—';
    rows.push(`| ${name} | ${current} | ${prior} | ${change} |`);
  }

  return rows.join('\n');
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
  rows.push(`| Metric | ${tickers.join(' | ')} |`);
  rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);

  for (const name of allMetricNames) {
    const values = tickers.map(ticker => {
      const data = insights[ticker]?.keyMetrics[name];
      if (!data) return '—';
      return formatValue(data.current, data.unit);
    });
    rows.push(`| ${name} | ${values.join(' | ')} |`);
  }

  // Also include comparison matrix data if available
  if (context.comparison && context.comparison.metrics.length > 0) {
    rows.push('');
    rows.push(`| Comparison Metric | ${tickers.join(' | ')} |`);
    rows.push(`|:---|${tickers.map(() => '---:').join('|')}|`);

    for (const m of context.comparison.metrics) {
      const values = tickers.map(t => {
        const val = m.values[t];
        if (val === null || val === undefined) return '—';
        return formatCompactCurrency(val, { smallDecimals: 0, compactDecimals: 1 });
      });
      rows.push(`| ${m.metric} | ${values.join(' | ')} |`);
    }
  }

  return rows.join('\n');
}

function formatValue(value: number, unit: string): string {
  if (!isFinite(value)) return 'N/A';
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'USD') return formatCompactCurrency(value, { smallDecimals: 0, compactDecimals: 1 });
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${value.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(value);
  return `${value}`;
}
