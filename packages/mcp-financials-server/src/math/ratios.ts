/**
 * Financial ratio calculations — all deterministic, no LLM needed.
 */

import type { CompanyFacts, Ratio, RatioName } from '@filinglens/shared';
import { getLatestValue } from '../xbrl/normalizer.js';

interface RatioDefinition {
  name: RatioName;
  displayName: string;
  formula: string;
  compute: (facts: CompanyFacts) => { value: number; components: Record<string, number> } | null;
}

const RATIO_DEFINITIONS: RatioDefinition[] = [
  {
    name: 'de',
    displayName: 'Debt-to-Equity',
    formula: 'total_liabilities / stockholders_equity',
    compute: (facts) => {
      const liabilities = getLatestValue(facts, 'total_liabilities', '10-K');
      const equity = getLatestValue(facts, 'stockholders_equity', '10-K');
      if (liabilities === null || equity === null || equity === 0) return null;
      return {
        value: liabilities / equity,
        components: { total_liabilities: liabilities, stockholders_equity: equity },
      };
    },
  },
  {
    name: 'roe',
    displayName: 'Return on Equity',
    formula: 'net_income / stockholders_equity',
    compute: (facts) => {
      const netIncome = getLatestValue(facts, 'net_income', '10-K');
      const equity = getLatestValue(facts, 'stockholders_equity', '10-K');
      if (netIncome === null || equity === null || equity === 0) return null;
      return {
        value: netIncome / equity,
        components: { net_income: netIncome, stockholders_equity: equity },
      };
    },
  },
  {
    name: 'roa',
    displayName: 'Return on Assets',
    formula: 'net_income / total_assets',
    compute: (facts) => {
      const netIncome = getLatestValue(facts, 'net_income', '10-K');
      const assets = getLatestValue(facts, 'total_assets', '10-K');
      if (netIncome === null || assets === null || assets === 0) return null;
      return {
        value: netIncome / assets,
        components: { net_income: netIncome, total_assets: assets },
      };
    },
  },
  {
    name: 'current_ratio',
    displayName: 'Current Ratio',
    formula: 'current_assets / current_liabilities',
    compute: (facts) => {
      const ca = getLatestValue(facts, 'current_assets', '10-K');
      const cl = getLatestValue(facts, 'current_liabilities', '10-K');
      if (ca === null || cl === null || cl === 0) return null;
      return {
        value: ca / cl,
        components: { current_assets: ca, current_liabilities: cl },
      };
    },
  },
  {
    name: 'gross_margin',
    displayName: 'Gross Margin',
    formula: 'gross_profit / revenue',
    compute: (facts) => {
      const gp = getLatestValue(facts, 'gross_profit', '10-K');
      const rev = getLatestValue(facts, 'revenue', '10-K');
      if (gp === null || rev === null || rev === 0) return null;
      return {
        value: gp / rev,
        components: { gross_profit: gp, revenue: rev },
      };
    },
  },
  {
    name: 'operating_margin',
    displayName: 'Operating Margin',
    formula: 'operating_income / revenue',
    compute: (facts) => {
      const oi = getLatestValue(facts, 'operating_income', '10-K');
      const rev = getLatestValue(facts, 'revenue', '10-K');
      if (oi === null || rev === null || rev === 0) return null;
      return {
        value: oi / rev,
        components: { operating_income: oi, revenue: rev },
      };
    },
  },
  {
    name: 'net_margin',
    displayName: 'Net Margin',
    formula: 'net_income / revenue',
    compute: (facts) => {
      const ni = getLatestValue(facts, 'net_income', '10-K');
      const rev = getLatestValue(facts, 'revenue', '10-K');
      if (ni === null || rev === null || rev === 0) return null;
      return {
        value: ni / rev,
        components: { net_income: ni, revenue: rev },
      };
    },
  },
  {
    name: 'pe',
    displayName: 'Price-to-Earnings (from EPS)',
    formula: 'Note: requires market price. Showing earnings_per_share only.',
    compute: (facts) => {
      const eps = getLatestValue(facts, 'eps_diluted', '10-K');
      if (eps === null) return null;
      // Without market price, we can only show EPS.
      // The frontend/agent can compute P/E if price is available.
      return {
        value: eps,
        components: { eps_diluted: eps },
      };
    },
  },
  {
    name: 'fcf_yield',
    displayName: 'Free Cash Flow',
    formula: 'operating_cash_flow - capex',
    compute: (facts) => {
      const ocf = getLatestValue(facts, 'operating_cash_flow', '10-K');
      const capex = getLatestValue(facts, 'capex', '10-K');
      if (ocf === null || capex === null) return null;
      // capex is typically reported as positive; FCF = OCF - capex
      return {
        value: ocf - Math.abs(capex),
        components: { operating_cash_flow: ocf, capex },
      };
    },
  },
];

/**
 * Calculate financial ratios for a company.
 * All computations are deterministic — no LLM involved.
 */
export function calculateRatios(
  facts: CompanyFacts,
  requestedRatios?: RatioName[],
): Ratio[] {
  const definitions = requestedRatios
    ? RATIO_DEFINITIONS.filter(d => requestedRatios.includes(d.name))
    : RATIO_DEFINITIONS;

  const results: Ratio[] = [];

  // Get the latest period for labeling
  const latestPeriod = facts.facts[0]?.periods
    .filter(p => p.form === '10-K')
    .sort((a, b) => b.period.localeCompare(a.period))[0]?.period || 'N/A';

  for (const def of definitions) {
    const result = def.compute(facts);
    if (result) {
      results.push({
        name: def.name,
        display_name: def.displayName,
        value: Math.round(result.value * 10000) / 10000, // 4 decimal places
        formula: def.formula,
        components: result.components,
        period: latestPeriod,
      });
    }
  }

  return results;
}
