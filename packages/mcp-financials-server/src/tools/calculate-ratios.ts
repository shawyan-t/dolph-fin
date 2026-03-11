/**
 * Tool: calculate_ratios
 * Computes financial ratios with formulas and components for verification.
 */

import { z } from 'zod';
import type { Ratio, RatioName } from '@shawyan/shared';
import { getCompanyFacts } from '@shawyan/mcp-sec-server/tools/get-company-facts.js';
import { calculateRatios } from '../math/ratios.js';

export const CalculateRatiosInput = z.object({
  ticker: z.string().min(1).max(10),
  ratios: z.array(z.enum([
    'eps', 'bvps', 'de', 'roe', 'roa',
    'current_ratio', 'quick_ratio',
    'gross_margin', 'operating_margin', 'net_margin',
    'fcf',
  ])).optional(),
});

export type CalculateRatiosParams = z.infer<typeof CalculateRatiosInput>;

export async function calculateRatiosTool(
  params: CalculateRatiosParams,
): Promise<{ ticker: string; ratios: Ratio[] }> {
  const { ticker, ratios: requestedRatios } = params;

  const facts = await getCompanyFacts({ ticker });
  const computed = calculateRatios(facts, requestedRatios as RatioName[] | undefined);

  return {
    ticker: ticker.toUpperCase(),
    ratios: computed,
  };
}
