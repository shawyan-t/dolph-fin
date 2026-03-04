/**
 * Tool: get_trend_analysis
 * Computes YoY growth, CAGR, and anomaly detection for specified metrics.
 */

import { z } from 'zod';
import type { TrendData } from '@dolph/shared';
import { getCompanyFacts } from '@dolph/mcp-sec-server/tools/get-company-facts.js';
import { analyzeTrends } from '../math/trends.js';

export const GetTrendAnalysisInput = z.object({
  ticker: z.string().min(1).max(10),
  metrics: z.array(z.string()).min(1),
  periods: z.number().min(2).max(20).optional().default(10),
});

export type GetTrendAnalysisParams = z.infer<typeof GetTrendAnalysisInput>;

export async function getTrendAnalysis(
  params: GetTrendAnalysisParams,
): Promise<{ ticker: string; trends: TrendData[] }> {
  const { ticker, metrics, periods } = params;

  const facts = await getCompanyFacts({ ticker });
  const trends = analyzeTrends(facts, metrics, 'annual', periods);

  return {
    ticker: ticker.toUpperCase(),
    trends,
  };
}
