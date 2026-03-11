/**
 * Financial ratio calculations — all deterministic, no LLM needed.
 *
 * Period coherence: all components of a ratio are extracted from the
 * SAME filing period. If metric A has data for 2024-12-31 but metric B
 * only has 2023-12-31, they are NOT mixed — the ratio for that period is skipped.
 */

import type { CompanyFacts, Ratio, RatioName, ProvenanceReceipt } from '@shawyan/shared';
import { crossValidatedShareCount } from '@shawyan/shared';

/** Annual filing forms in priority order */
const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);

interface RatioDefinition {
  name: RatioName;
  displayName: string;
  formula: string;
  /** Metric names required (all must exist in the same period) */
  metrics: string[];
  /** Compute the ratio value from the period-coherent metric map */
  compute: (values: Record<string, number>) => number | null;
}

const RATIO_DEFINITIONS: RatioDefinition[] = [
  {
    name: 'de',
    displayName: 'Debt-to-Equity',
    formula: 'total_debt / stockholders_equity',
    metrics: ['stockholders_equity'],
    compute: (v) => {
      if (!v['stockholders_equity'] || v['stockholders_equity'] === 0) return null;
      // Prefer total_debt when available to avoid undercounting when
      // long_term_debt omits current maturities or is stale.
      const debtBase = v['total_debt'] ?? (
        (('long_term_debt' in v) || ('short_term_debt' in v))
          ? ((v['long_term_debt'] ?? 0) + (v['short_term_debt'] ?? 0))
          : null
      );
      if (debtBase == null) return null;
      return debtBase / v['stockholders_equity']!;
    },
  },
  {
    name: 'roe',
    displayName: 'Return on Equity',
    formula: 'net_income / stockholders_equity',
    metrics: ['net_income', 'stockholders_equity'],
    compute: (v) => {
      if (!v['stockholders_equity'] || v['stockholders_equity'] === 0) return null;
      return v['net_income']! / v['stockholders_equity']!;
    },
  },
  {
    name: 'roa',
    displayName: 'Return on Assets',
    formula: 'net_income / total_assets',
    metrics: ['net_income', 'total_assets'],
    compute: (v) => {
      if (!v['total_assets'] || v['total_assets'] === 0) return null;
      return v['net_income']! / v['total_assets']!;
    },
  },
  {
    name: 'current_ratio',
    displayName: 'Current Ratio',
    formula: 'current_assets / current_liabilities',
    metrics: ['current_assets', 'current_liabilities'],
    compute: (v) => {
      if (!v['current_liabilities'] || v['current_liabilities'] === 0) return null;
      return v['current_assets']! / v['current_liabilities']!;
    },
  },
  {
    name: 'quick_ratio',
    displayName: 'Quick Ratio',
    formula: '(current_assets - inventory) / current_liabilities',
    metrics: ['current_assets', 'current_liabilities'],
    compute: (v) => {
      if (!v['current_liabilities'] || v['current_liabilities'] === 0) return null;
      const inventory = v['inventory'] ?? 0;
      return (v['current_assets']! - inventory) / v['current_liabilities']!;
    },
  },
  {
    name: 'gross_margin',
    displayName: 'Gross Margin',
    formula: 'gross_profit / revenue',
    metrics: ['gross_profit', 'revenue'],
    compute: (v) => {
      if (!v['revenue'] || v['revenue'] === 0) return null;
      return v['gross_profit']! / v['revenue']!;
    },
  },
  {
    name: 'operating_margin',
    displayName: 'Operating Margin',
    formula: 'operating_income / revenue',
    metrics: ['operating_income', 'revenue'],
    compute: (v) => {
      if (!v['revenue'] || v['revenue'] === 0) return null;
      return v['operating_income']! / v['revenue']!;
    },
  },
  {
    name: 'net_margin',
    displayName: 'Net Margin',
    formula: 'net_income / revenue',
    metrics: ['net_income', 'revenue'],
    compute: (v) => {
      if (!v['revenue'] || v['revenue'] === 0) return null;
      return v['net_income']! / v['revenue']!;
    },
  },
  {
    name: 'eps',
    displayName: 'Earnings Per Share (Diluted)',
    formula: 'eps_diluted',
    metrics: ['eps_diluted'],
    compute: (v) => v['eps_diluted'] ?? null,
  },
  {
    name: 'bvps',
    displayName: 'Book Value Per Share',
    formula: 'stockholders_equity / shares_outstanding',
    metrics: ['stockholders_equity', 'shares_outstanding'],
    compute: (v) => {
      if (!v['stockholders_equity']) return null;
      const shares = crossValidatedShareCount(v);
      if (!shares || shares === 0) return null;
      return v['stockholders_equity']! / shares;
    },
  },
  {
    name: 'fcf',
    displayName: 'Free Cash Flow',
    formula: 'operating_cash_flow - abs(capex)',
    metrics: ['operating_cash_flow', 'capex'],
    compute: (v) => {
      if (v['operating_cash_flow'] == null || v['capex'] == null) return null;
      return v['operating_cash_flow']! - Math.abs(v['capex']!);
    },
  },
];

/**
 * Build a period-coherent data map: for each annual period, collect all
 * available metric values. Only periods from annual forms are considered.
 *
 * Returns periods sorted descending (most recent first).
 */
interface PeriodBucket {
  values: Record<string, number>;
  provenance: Record<string, ProvenanceReceipt>;
}

function buildPeriodMap(
  facts: CompanyFacts,
): Array<{ period: string; values: Record<string, number>; provenance: Record<string, ProvenanceReceipt> }> {
  const periodData = new Map<string, PeriodBucket>();

  for (const fact of facts.facts) {
    for (const p of fact.periods) {
      if (!ANNUAL_FORMS.has(p.form)) continue;

      let bucket = periodData.get(p.period);
      if (!bucket) {
        bucket = { values: {}, provenance: {} };
        periodData.set(p.period, bucket);
      }
      if (!(fact.metric in bucket.values)) {
        bucket.values[fact.metric] = p.value;
        if (p.provenance) {
          bucket.provenance[fact.metric] = p.provenance;
        }
      }
    }
  }

  return Array.from(periodData.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([period, bucket]) => ({ period, values: bucket.values, provenance: bucket.provenance }));
}

/**
 * Calculate financial ratios for a company.
 * All computations are deterministic — no LLM involved.
 *
 * Period coherence: all components of each ratio come from the SAME period.
 * The period label on the output exactly matches the data used.
 */
export function calculateRatios(
  facts: CompanyFacts,
  requestedRatios?: RatioName[],
): Ratio[] {
  const definitions = requestedRatios
    ? RATIO_DEFINITIONS.filter(d => requestedRatios.includes(d.name))
    : RATIO_DEFINITIONS;

  const periodMap = buildPeriodMap(facts);
  if (periodMap.length === 0) return [];

  const results: Ratio[] = [];

  for (const def of definitions) {
    for (const { period, values, provenance: periodProvenance } of periodMap) {
      const allPresent = def.name === 'de'
        ? (
          'stockholders_equity' in values &&
          ('long_term_debt' in values || 'short_term_debt' in values || 'total_debt' in values)
        )
        : def.metrics.every(m => m in values);
      if (!allPresent) continue;

      const result = def.compute(values);
      if (result === null) continue;

      const components: Record<string, number> = {};
      const ratioProvenance: Record<string, ProvenanceReceipt> = {};
      let formula = def.formula;

      if (def.name === 'de') {
        components['stockholders_equity'] = values['stockholders_equity']!;
        if (periodProvenance['stockholders_equity']) {
          ratioProvenance['stockholders_equity'] = periodProvenance['stockholders_equity']!;
        }

        if ('total_debt' in values) {
          components['total_debt'] = values['total_debt']!;
          if (periodProvenance['total_debt']) {
            ratioProvenance['total_debt'] = periodProvenance['total_debt']!;
          }
          formula = 'total_debt / stockholders_equity';
        } else {
          components['long_term_debt'] = values['long_term_debt'] ?? 0;
          components['short_term_debt'] = values['short_term_debt'] ?? 0;
          if (periodProvenance['long_term_debt']) {
            ratioProvenance['long_term_debt'] = periodProvenance['long_term_debt']!;
          }
          if (periodProvenance['short_term_debt']) {
            ratioProvenance['short_term_debt'] = periodProvenance['short_term_debt']!;
          }
          formula = '(long_term_debt + short_term_debt) / stockholders_equity';
        }
      } else {
        for (const m of def.metrics) {
          components[m] = values[m]!;
          if (periodProvenance[m]) {
            ratioProvenance[m] = periodProvenance[m]!;
          }
        }
      }

      const notes: string[] = [];

      if (def.name === 'quick_ratio') {
        if ('inventory' in values) {
          components['inventory'] = values['inventory']!;
          if (periodProvenance['inventory']) {
            ratioProvenance['inventory'] = periodProvenance['inventory']!;
          }
        } else {
          notes.push('Inventory not reported; quick ratio equals current ratio');
        }
      }

      results.push({
        name: def.name,
        display_name: def.displayName,
        value: Math.round(result * 10000) / 10000,
        formula,
        components,
        period,
        provenance: Object.keys(ratioProvenance).length > 0 ? ratioProvenance : undefined,
        ...(notes.length > 0 ? { notes } : {}),
      });
      break;
    }
  }

  return results;
}
