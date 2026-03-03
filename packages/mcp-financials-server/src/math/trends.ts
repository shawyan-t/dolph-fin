/**
 * Trend analysis — YoY growth, CAGR, anomaly detection.
 * All deterministic computation, no LLM.
 */

import type { CompanyFacts, TrendData, Period } from '@filinglens/shared';
import { getMetricTimeSeries } from '../xbrl/normalizer.js';

/**
 * Calculate year-over-year growth rate.
 */
function yoyGrowth(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}

/**
 * Calculate compound annual growth rate.
 */
function cagr(startValue: number, endValue: number, years: number): number | null {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return null;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

/**
 * Detect anomalies (values > 2 standard deviations from mean of YoY growth).
 */
function detectAnomalies(
  values: Array<{ period: string; value: number; yoy_growth: number | null }>,
): Array<{ period: string; description: string; yoy_growth: number }> {
  const growths = values
    .map(v => v.yoy_growth)
    .filter((g): g is number => g !== null);

  if (growths.length < 3) return []; // Not enough data

  const mean = growths.reduce((s, g) => s + g, 0) / growths.length;
  const variance = growths.reduce((s, g) => s + (g - mean) ** 2, 0) / growths.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return [];

  const anomalies: Array<{ period: string; description: string; yoy_growth: number }> = [];

  for (const v of values) {
    if (v.yoy_growth === null) continue;
    const zScore = (v.yoy_growth - mean) / stdDev;

    if (Math.abs(zScore) > 2) {
      const direction = v.yoy_growth > mean ? 'spike' : 'drop';
      const pct = (v.yoy_growth * 100).toFixed(1);
      anomalies.push({
        period: v.period,
        description: `Significant ${direction}: ${pct}% YoY change (${Math.abs(zScore).toFixed(1)}σ from mean)`,
        yoy_growth: v.yoy_growth,
      });
    }
  }

  return anomalies;
}

/**
 * Compute trend analysis for specified metrics.
 */
export function analyzeTrends(
  facts: CompanyFacts,
  metrics: string[],
  periodType: Period = 'annual',
  periodCount: number = 10,
): TrendData[] {
  const results: TrendData[] = [];

  for (const metric of metrics) {
    const series = getMetricTimeSeries(facts, metric, periodType, periodCount);

    if (series.length === 0) continue;

    // series is sorted descending (most recent first) — reverse for chronological
    const chronological = [...series].reverse();

    // Calculate YoY growth
    const values = chronological.map((point, idx) => {
      const prior = idx > 0 ? chronological[idx - 1]! : null;
      return {
        period: point.period,
        value: point.value,
        yoy_growth: prior ? yoyGrowth(point.value, prior.value) : null,
      };
    });

    // Calculate CAGR
    const startValue = chronological[0]?.value ?? 0;
    const endValue = chronological[chronological.length - 1]?.value ?? 0;
    const years = chronological.length - 1;
    const computedCagr = cagr(startValue, endValue, years);

    // Detect anomalies
    const anomalies = detectAnomalies(values);

    results.push({
      metric,
      values,
      cagr: computedCagr !== null ? Math.round(computedCagr * 10000) / 10000 : null,
      anomalies,
    });
  }

  return results;
}
