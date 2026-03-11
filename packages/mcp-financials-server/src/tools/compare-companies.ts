/**
 * Tool: compare_companies
 * Compares financial metrics across multiple tickers.
 */

import { z } from 'zod';
import type { CompanyComparison, RatioName } from '@shawyan/shared';
import { getCompanyFacts } from '@shawyan/mcp-sec-server/tools/get-company-facts.js';
import { getLatestValue } from '../xbrl/normalizer.js';
import { calculateRatios } from '../math/ratios.js';

/** Known ratio names that can be computed from raw facts */
const KNOWN_RATIO_NAMES = new Set<string>([
  'eps', 'bvps', 'de', 'roe', 'roa', 'current_ratio', 'quick_ratio',
  'gross_margin', 'operating_margin', 'net_margin', 'fcf',
]);

export const CompareCompaniesInput = z.object({
  tickers: z.array(z.string()).min(2).max(10),
  metrics: z.array(z.string()).min(1),
});

export type CompareCompaniesParams = z.infer<typeof CompareCompaniesInput>;

export async function compareCompanies(
  params: CompareCompaniesParams,
): Promise<CompanyComparison> {
  const { tickers, metrics } = params;

  // Fetch facts for all tickers in parallel
  const factsMap = new Map<string, Awaited<ReturnType<typeof getCompanyFacts>>>();

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const facts = await getCompanyFacts({ ticker });
      factsMap.set(ticker.toUpperCase(), facts);
    }),
  );

  // Note any failures
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === 'rejected') {
      console.error(`Failed to fetch facts for ${tickers[i]}: ${result.reason}`);
    }
  }

  // Build comparison matrix
  const comparisonMetrics = metrics.map(metric => {
    const values: Record<string, number | null> = {};
    const numericValues: Array<{ ticker: string; value: number }> = [];

    for (const ticker of tickers) {
      const key = ticker.toUpperCase();
      const facts = factsMap.get(key);

      if (!facts) {
        values[key] = null;
        continue;
      }

      let val: number | null = null;

      // If the metric is a known ratio name, compute it from component facts
      if (KNOWN_RATIO_NAMES.has(metric)) {
        const computed = calculateRatios(facts, [metric as RatioName]);
        if (computed.length > 0 && computed[0]!.value !== null) {
          val = computed[0]!.value;
        }
      }

      // Fall back to raw fact lookup
      if (val === null) {
        val = getLatestValue(facts, metric, '10-K');
      }

      values[key] = val;

      if (val !== null) {
        numericValues.push({ ticker: key, value: val });
      }
    }

    // Rank companies per metric (highest value = rank 1 by default)
    // For metrics where lower is better (like debt ratios), flip the sort
    const lowerIsBetter = [
      'total_liabilities', 'current_liabilities', 'total_debt',
      'long_term_debt', 'short_term_debt', 'operating_expenses', 'cost_of_revenue',
      'sga_expenses', 'capex', 'de',
    ].includes(metric);

    numericValues.sort((a, b) =>
      lowerIsBetter ? a.value - b.value : b.value - a.value,
    );

    const rankings: Record<string, number> = {};
    numericValues.forEach((item, idx) => {
      rankings[item.ticker] = idx + 1;
    });

    // Tickers with null values get no ranking
    for (const ticker of tickers) {
      const key = ticker.toUpperCase();
      if (!(key in rankings)) {
        rankings[key] = 0; // unranked
      }
    }

    return { metric, values, rankings };
  });

  return {
    tickers: tickers.map(t => t.toUpperCase()),
    metrics: comparisonMetrics,
  };
}
