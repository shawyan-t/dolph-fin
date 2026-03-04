/**
 * DETERMINISTIC analyzer — computes derived insights from raw data.
 * No LLM calls. Pure code.
 */

import type { AnalysisContext, TrendData, Ratio } from '@dolph/shared';
import { getMappingByName } from '@dolph/shared';

export interface AnalysisInsights {
  topTrends: Array<{
    metric: string;
    displayName: string;
    direction: 'up' | 'down' | 'flat';
    cagr: number | null;
    latestValue: number | null;
    description: string;
  }>;
  redFlags: Array<{
    flag: string;
    severity: 'high' | 'medium' | 'low';
    detail: string;
  }>;
  strengths: Array<{
    metric: string;
    detail: string;
  }>;
  keyMetrics: Record<string, {
    current: number;
    prior: number | null;
    change: number | null;
    unit: string;
  }>;
}

/**
 * Analyze gathered data and compute insights deterministically.
 */
/** Correct unit for each ratio — avoids naive string-matching */
const RATIO_UNITS: Record<string, string> = {
  eps: 'USD/shares',
  bvps: 'USD/shares',
  de: 'x',
  roe: '%',
  roa: '%',
  current_ratio: 'x',
  quick_ratio: 'x',
  gross_margin: '%',
  operating_margin: '%',
  net_margin: '%',
  fcf: 'USD',
};

export function analyzeData(context: AnalysisContext): Record<string, AnalysisInsights> {
  const results: Record<string, AnalysisInsights> = {};

  for (const ticker of context.tickers) {
    const trends = context.trends[ticker] || [];
    const ratios = context.ratios[ticker] || [];

    results[ticker] = {
      topTrends: identifyTopTrends(trends),
      redFlags: identifyRedFlags(ratios, trends),
      strengths: identifyStrengths(ratios, trends),
      keyMetrics: buildKeyMetrics(ratios, trends),
    };
  }

  return results;
}

function identifyTopTrends(trends: TrendData[]): AnalysisInsights['topTrends'] {
  return trends
    .filter(t => t.cagr !== null)
    .sort((a, b) => Math.abs(b.cagr ?? 0) - Math.abs(a.cagr ?? 0))
    .slice(0, 5)
    .map(t => {
      const mapping = getMappingByName(t.metric);
      const latest = t.values[t.values.length - 1];
      const cagr = t.cagr ?? 0;

      let direction: 'up' | 'down' | 'flat' = 'flat';
      if (cagr > 0.02) direction = 'up';
      else if (cagr < -0.02) direction = 'down';

      const pct = (cagr * 100).toFixed(1);
      const description = direction === 'flat'
        ? `${mapping?.displayName || t.metric} has been roughly flat`
        : `${mapping?.displayName || t.metric} has ${direction === 'up' ? 'grown' : 'declined'} at a ${pct}% CAGR`;

      return {
        metric: t.metric,
        displayName: mapping?.displayName || t.metric,
        direction,
        cagr: t.cagr,
        latestValue: latest?.value ?? null,
        description,
      };
    });
}

function identifyRedFlags(ratios: Ratio[], trends: TrendData[]): AnalysisInsights['redFlags'] {
  const flags: AnalysisInsights['redFlags'] = [];

  // Check debt-to-equity ratio
  const deRatio = ratios.find(r => r.name === 'de');
  if (deRatio && isFinite(deRatio.value) && deRatio.value > 2) {
    flags.push({
      flag: 'High leverage',
      severity: deRatio.value > 5 ? 'high' : 'medium',
      detail: `Debt-to-equity ratio of ${deRatio.value.toFixed(2)} indicates high leverage`,
    });
  }

  // Check negative net margin
  const netMargin = ratios.find(r => r.name === 'net_margin');
  if (netMargin && isFinite(netMargin.value) && netMargin.value < 0) {
    flags.push({
      flag: 'Negative profitability',
      severity: 'high',
      detail: `Net margin of ${(netMargin.value * 100).toFixed(1)}% — company is unprofitable`,
    });
  }

  // Check declining revenue trend
  const revenueTrend = trends.find(t => t.metric === 'revenue');
  if (revenueTrend && revenueTrend.cagr !== null && isFinite(revenueTrend.cagr) && revenueTrend.cagr < -0.05) {
    flags.push({
      flag: 'Declining revenue',
      severity: 'high',
      detail: `Revenue declining at ${(revenueTrend.cagr * 100).toFixed(1)}% CAGR`,
    });
  }

  // Check negative operating cash flow
  const ocfTrend = trends.find(t => t.metric === 'operating_cash_flow');
  if (ocfTrend) {
    const latest = ocfTrend.values[ocfTrend.values.length - 1];
    if (latest && isFinite(latest.value) && latest.value < 0) {
      flags.push({
        flag: 'Negative operating cash flow',
        severity: 'high',
        detail: `Operating cash flow is negative — potential liquidity concern`,
      });
    }
  }

  // Check current ratio below 1
  const currentRatio = ratios.find(r => r.name === 'current_ratio');
  if (currentRatio && isFinite(currentRatio.value) && currentRatio.value < 1) {
    flags.push({
      flag: 'Low liquidity',
      severity: 'medium',
      detail: `Current ratio of ${currentRatio.value.toFixed(2)} — current liabilities exceed current assets`,
    });
  }

  // Check for anomalies in trends
  for (const trend of trends) {
    for (const anomaly of trend.anomalies) {
      const mapping = getMappingByName(trend.metric);
      flags.push({
        flag: `Anomaly in ${mapping?.displayName || trend.metric}`,
        severity: 'medium',
        detail: `${anomaly.description} (period: ${anomaly.period})`,
      });
    }
  }

  return flags;
}

function identifyStrengths(ratios: Ratio[], trends: TrendData[]): AnalysisInsights['strengths'] {
  const strengths: AnalysisInsights['strengths'] = [];

  const grossMargin = ratios.find(r => r.name === 'gross_margin');
  if (grossMargin && isFinite(grossMargin.value) && grossMargin.value > 0.5) {
    strengths.push({
      metric: 'gross_margin',
      detail: `Gross margin of ${(grossMargin.value * 100).toFixed(1)}% indicates strong pricing power`,
    });
  }

  const roe = ratios.find(r => r.name === 'roe');
  if (roe && isFinite(roe.value) && roe.value > 0.15) {
    strengths.push({
      metric: 'roe',
      detail: `ROE of ${(roe.value * 100).toFixed(1)}% indicates efficient use of shareholder capital`,
    });
  }

  const revenueTrend = trends.find(t => t.metric === 'revenue');
  if (revenueTrend && revenueTrend.cagr !== null && isFinite(revenueTrend.cagr) && revenueTrend.cagr > 0.1) {
    strengths.push({
      metric: 'revenue_growth',
      detail: `Revenue growing at ${(revenueTrend.cagr * 100).toFixed(1)}% CAGR — strong top-line growth`,
    });
  }

  const currentRatio = ratios.find(r => r.name === 'current_ratio');
  if (currentRatio && isFinite(currentRatio.value) && currentRatio.value > 1.5) {
    strengths.push({
      metric: 'current_ratio',
      detail: `Current ratio of ${currentRatio.value.toFixed(2)} indicates solid liquidity`,
    });
  }

  return strengths;
}

function buildKeyMetrics(
  ratios: Ratio[],
  trends: TrendData[],
): AnalysisInsights['keyMetrics'] {
  const metrics: AnalysisInsights['keyMetrics'] = {};

  // Add key ratios
  for (const ratio of ratios) {
    metrics[ratio.display_name] = {
      current: ratio.value,
      prior: null,
      change: null,
      unit: RATIO_UNITS[ratio.name] || 'x',
    };
  }

  // Add key absolute values from trends
  for (const trend of trends) {
    if (trend.values.length < 2) continue;
    const latest = trend.values[trend.values.length - 1]!;
    const prior = trend.values[trend.values.length - 2]!;
    const mapping = getMappingByName(trend.metric);

    metrics[mapping?.displayName || trend.metric] = {
      current: latest.value,
      prior: prior.value,
      change: latest.yoy_growth,
      unit: mapping?.unit || 'USD',
    };
  }

  return metrics;
}
