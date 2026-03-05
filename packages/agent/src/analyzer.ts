/**
 * Deterministic analyzer — canonical period lock + metric ledger.
 * No LLM calls. All cross-section numeric values should flow from here.
 */

import type { AnalysisContext, CompanyFacts, Ratio, TrendData } from '@dolph/shared';
import { getMappingByName } from '@dolph/shared';

type FlagSeverity = 'high' | 'medium' | 'low';

type MetricUnit = 'USD' | '%' | 'x' | 'USD/shares' | 'shares';

interface KeyMetricValue {
  current: number;
  prior: number | null;
  change: number | null;
  unit: MetricUnit;
}

interface PeriodBasis {
  source: 'statements' | 'facts';
  current: string | null;
  prior: string | null;
  note?: string;
}

interface LedgerMetric {
  key: string;
  displayName: string;
  unit: MetricUnit;
  current: number | null;
  prior: number | null;
  change: number | null;
}

interface PeriodBucket {
  values: Record<string, number>;
}

interface MetricDefinition {
  key: string;
  displayName: string;
  unit: MetricUnit;
  dependencies: string[];
  compute: (values: Record<string, number>) => number | null;
  ratioFallback?: string;
}

const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);
const PERIOD_LOCK_METRICS = [
  'revenue',
  'net_income',
  'operating_income',
  'operating_cash_flow',
  'total_assets',
  'stockholders_equity',
];

const LEDGER_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'revenue',
    displayName: 'Revenue',
    unit: 'USD',
    dependencies: ['revenue'],
    compute: v => finiteOrNull(v['revenue']),
  },
  {
    key: 'net_income',
    displayName: 'Net Income',
    unit: 'USD',
    dependencies: ['net_income'],
    compute: v => finiteOrNull(v['net_income']),
  },
  {
    key: 'operating_income',
    displayName: 'Operating Income',
    unit: 'USD',
    dependencies: ['operating_income'],
    compute: v => finiteOrNull(v['operating_income']),
  },
  {
    key: 'total_assets',
    displayName: 'Total Assets',
    unit: 'USD',
    dependencies: ['total_assets'],
    compute: v => finiteOrNull(v['total_assets']),
  },
  {
    key: 'total_liabilities',
    displayName: 'Total Liabilities',
    unit: 'USD',
    dependencies: ['total_liabilities'],
    compute: v => finiteOrNull(v['total_liabilities']),
  },
  {
    key: 'stockholders_equity',
    displayName: "Stockholders' Equity",
    unit: 'USD',
    dependencies: ['stockholders_equity'],
    compute: v => finiteOrNull(v['stockholders_equity']),
  },
  {
    key: 'operating_cash_flow',
    displayName: 'Operating Cash Flow',
    unit: 'USD',
    dependencies: ['operating_cash_flow'],
    compute: v => finiteOrNull(v['operating_cash_flow']),
  },
  {
    key: 'capex',
    displayName: 'Capital Expenditures',
    unit: 'USD',
    dependencies: ['capex'],
    compute: v => finiteOrNull(v['capex']),
  },
  {
    key: 'eps',
    displayName: 'Earnings Per Share (Diluted)',
    unit: 'USD/shares',
    dependencies: ['eps_diluted'],
    compute: v => finiteOrNull(v['eps_diluted']),
    ratioFallback: 'eps',
  },
  {
    key: 'bvps',
    displayName: 'Book Value Per Share',
    unit: 'USD/shares',
    dependencies: ['stockholders_equity', 'shares_outstanding'],
    compute: v => {
      const shares = finiteOrNull(v['shares_outstanding']);
      const equity = finiteOrNull(v['stockholders_equity']);
      if (shares === null || equity === null || shares === 0) return null;
      return equity / shares;
    },
    ratioFallback: 'bvps',
  },
  {
    key: 'fcf',
    displayName: 'Free Cash Flow',
    unit: 'USD',
    dependencies: ['operating_cash_flow', 'capex'],
    compute: v => {
      const ocf = finiteOrNull(v['operating_cash_flow']);
      const capex = finiteOrNull(v['capex']);
      if (ocf === null || capex === null) return null;
      return ocf - Math.abs(capex);
    },
    ratioFallback: 'fcf',
  },
  {
    key: 'gross_margin',
    displayName: 'Gross Margin',
    unit: '%',
    dependencies: ['gross_profit', 'revenue'],
    compute: v => safeDivide(v['gross_profit'], v['revenue']),
    ratioFallback: 'gross_margin',
  },
  {
    key: 'operating_margin',
    displayName: 'Operating Margin',
    unit: '%',
    dependencies: ['operating_income', 'revenue'],
    compute: v => safeDivide(v['operating_income'], v['revenue']),
    ratioFallback: 'operating_margin',
  },
  {
    key: 'net_margin',
    displayName: 'Net Margin',
    unit: '%',
    dependencies: ['net_income', 'revenue'],
    compute: v => safeDivide(v['net_income'], v['revenue']),
    ratioFallback: 'net_margin',
  },
  {
    key: 'roe',
    displayName: 'Return on Equity',
    unit: '%',
    dependencies: ['net_income', 'stockholders_equity'],
    compute: v => safeDivide(v['net_income'], v['stockholders_equity']),
    ratioFallback: 'roe',
  },
  {
    key: 'roa',
    displayName: 'Return on Assets',
    unit: '%',
    dependencies: ['net_income', 'total_assets'],
    compute: v => safeDivide(v['net_income'], v['total_assets']),
    ratioFallback: 'roa',
  },
  {
    key: 'current_ratio',
    displayName: 'Current Ratio',
    unit: 'x',
    dependencies: ['current_assets', 'current_liabilities'],
    compute: v => safeDivide(v['current_assets'], v['current_liabilities']),
    ratioFallback: 'current_ratio',
  },
  {
    key: 'quick_ratio',
    displayName: 'Quick Ratio',
    unit: 'x',
    dependencies: ['current_assets', 'current_liabilities'],
    compute: v => {
      const currentAssets = finiteOrNull(v['current_assets']);
      const currentLiabilities = finiteOrNull(v['current_liabilities']);
      if (currentAssets === null || currentLiabilities === null || currentLiabilities === 0) return null;
      const inventory = finiteOrNull(v['inventory']) ?? 0;
      return (currentAssets - inventory) / currentLiabilities;
    },
    ratioFallback: 'quick_ratio',
  },
  {
    key: 'de',
    displayName: 'Debt-to-Equity',
    unit: 'x',
    dependencies: ['stockholders_equity'],
    compute: v => {
      const equity = finiteOrNull(v['stockholders_equity']);
      if (equity === null || equity === 0) return null;
      const debt = resolveDebt(v);
      if (debt === null) return null;
      return debt / equity;
    },
    ratioFallback: 'de',
  },
];

export interface AnalysisInsights {
  snapshotPeriod: string | null;
  priorPeriod: string | null;
  periodBasis?: PeriodBasis;
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
    severity: FlagSeverity;
    detail: string;
  }>;
  strengths: Array<{
    metric: string;
    detail: string;
  }>;
  keyMetrics: Record<string, KeyMetricValue>;
  canonicalFacts?: Record<string, LedgerMetric>;
}

export function analyzeData(context: AnalysisContext): Record<string, AnalysisInsights> {
  const results: Record<string, AnalysisInsights> = {};

  for (const ticker of context.tickers) {
    const trends = context.trends[ticker] || [];
    const ratios = context.ratios[ticker] || [];
    const facts = context.facts[ticker];

    const periodMap = buildAnnualPeriodMap(context, ticker);
    const basis = selectPeriodBasis(periodMap, facts);
    const ledger = computeLedgerMetrics(periodMap, ratios, basis.current, basis.prior);
    const sanityFlags = runSanityChecks(ledger, periodMap, ratios, basis.current);
    const keyMetrics = toKeyMetricsMap(ledger.metrics, sanityFlags.excludedMetricKeys);

    const redFlags = dedupeFlags([
      ...identifyQuantRedFlags(keyMetrics, trends),
      ...sanityFlags.flags,
    ]);
    const strengths = identifyStrengths(keyMetrics);

    results[ticker] = {
      snapshotPeriod: basis.current,
      priorPeriod: basis.prior,
      periodBasis: basis,
      topTrends: identifyTopTrends(trends),
      redFlags,
      strengths,
      keyMetrics,
      canonicalFacts: Object.fromEntries(ledger.metrics.map(m => [m.key, m])),
    };
  }

  return results;
}

function buildAnnualPeriodMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, PeriodBucket> {
  const periodMap = new Map<string, PeriodBucket>();

  const ensureBucket = (period: string): PeriodBucket => {
    let bucket = periodMap.get(period);
    if (!bucket) {
      bucket = { values: {} };
      periodMap.set(period, bucket);
    }
    return bucket;
  };

  // 1) Structured statements (highest confidence for section coherence)
  for (const statement of context.statements[ticker] || []) {
    if (statement.period_type !== 'annual') continue;
    for (const p of statement.periods) {
      const bucket = ensureBucket(p.period);
      for (const [metric, value] of Object.entries(p.data)) {
        if (!isFinite(value)) continue;
        if (bucket.values[metric] === undefined) {
          bucket.values[metric] = value;
        }
      }
    }
  }

  // 2) Raw annual company facts as deterministic fallback
  const facts = context.facts[ticker];
  if (facts) {
    for (const fact of facts.facts) {
      for (const p of fact.periods) {
        if (!ANNUAL_FORMS.has(p.form)) continue;
        if (!isFinite(p.value)) continue;
        const bucket = ensureBucket(p.period);
        if (bucket.values[fact.metric] === undefined) {
          bucket.values[fact.metric] = p.value;
        }
      }
    }
  }

  return periodMap;
}

function selectPeriodBasis(
  periodMap: Map<string, PeriodBucket>,
  facts?: CompanyFacts,
): PeriodBasis {
  const periods = Array.from(periodMap.keys()).sort((a, b) => b.localeCompare(a));
  if (periods.length === 0) {
    const fallbackCurrent = detectLatestAnnualPeriod(facts);
    return { source: 'facts', current: fallbackCurrent, prior: null };
  }

  const scored = periods.map(period => ({
    period,
    score: scorePeriodCoverage(periodMap.get(period)?.values || {}),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.period.localeCompare(a.period);
  });

  const current = scored[0]?.period ?? periods[0] ?? null;
  const latestRaw = periods[0] ?? null;
  const older = periods.filter(p => current !== null && p.localeCompare(current) < 0);
  const prior = older.length > 0 ? older[0]! : null;

  let note: string | undefined;
  if (latestRaw && current && latestRaw !== current) {
    note = `Latest filing period ${latestRaw} lacked core metric coverage; locked to ${current}.`;
  }

  return {
    source: 'statements',
    current,
    prior,
    note,
  };
}

function scorePeriodCoverage(values: Record<string, number>): number {
  let score = 0;
  for (const metric of PERIOD_LOCK_METRICS) {
    if (isFinite(values[metric])) score += 1;
  }
  return score;
}

function computeLedgerMetrics(
  periodMap: Map<string, PeriodBucket>,
  ratios: Ratio[],
  snapshotPeriod: string | null,
  priorPeriod: string | null,
): { metrics: LedgerMetric[] } {
  const snapshotValues = snapshotPeriod ? periodMap.get(snapshotPeriod)?.values || {} : {};
  const priorValues = priorPeriod ? periodMap.get(priorPeriod)?.values || {} : {};

  const ratioByPeriod = new Map<string, Map<string, number>>();
  for (const ratio of ratios) {
    if (!ratioByPeriod.has(ratio.period)) {
      ratioByPeriod.set(ratio.period, new Map());
    }
    ratioByPeriod.get(ratio.period)!.set(ratio.name, ratio.value);
  }

  const metrics: LedgerMetric[] = [];
  for (const def of LEDGER_DEFINITIONS) {
    const currentComputed = computeMetricFromValues(def, snapshotValues);
    const priorComputed = computeMetricFromValues(def, priorValues);

    let current = currentComputed;
    let prior = priorComputed;

    // Ratio fallback is period-locked. Never use a ratio from another period.
    if (current === null && def.ratioFallback && snapshotPeriod) {
      current = ratioByPeriod.get(snapshotPeriod)?.get(def.ratioFallback) ?? null;
    }
    if (prior === null && def.ratioFallback && priorPeriod) {
      prior = ratioByPeriod.get(priorPeriod)?.get(def.ratioFallback) ?? null;
    }

    metrics.push({
      key: def.key,
      displayName: def.displayName,
      unit: def.unit,
      current,
      prior,
      change: computeChange(current, prior),
    });
  }

  return { metrics };
}

function computeMetricFromValues(
  def: MetricDefinition,
  values: Record<string, number>,
): number | null {
  if (Object.keys(values).length === 0) return null;
  const output = def.compute(values);
  return finiteOrNull(output);
}

function runSanityChecks(
  ledger: { metrics: LedgerMetric[] },
  periodMap: Map<string, PeriodBucket>,
  ratios: Ratio[],
  snapshotPeriod: string | null,
): {
  flags: AnalysisInsights['redFlags'];
  excludedMetricKeys: Set<string>;
} {
  const flags: AnalysisInsights['redFlags'] = [];
  const excludedMetricKeys = new Set<string>();
  const byKey = new Map(ledger.metrics.map(m => [m.key, m]));
  const currentValues = snapshotPeriod ? periodMap.get(snapshotPeriod)?.values || {} : {};

  const grossProfit = finiteOrNull(currentValues['gross_profit']);
  const operatingIncome = finiteOrNull(currentValues['operating_income']);
  if (grossProfit !== null && operatingIncome !== null && grossProfit < operatingIncome) {
    flags.push({
      flag: 'Gross profit mapping check failed',
      severity: 'high',
      detail: `Gross profit (${roundSig(grossProfit)}) is below operating income (${roundSig(operatingIncome)}). Gross-margin metrics were excluded.`,
    });
    excludedMetricKeys.add('gross_margin');
  }

  const assets = finiteOrNull(currentValues['total_assets']);
  const liabilities = finiteOrNull(currentValues['total_liabilities']);
  const equity = finiteOrNull(currentValues['stockholders_equity']);
  if (assets !== null && liabilities !== null && equity !== null && assets !== 0) {
    const diff = Math.abs(assets - (liabilities + equity));
    const tolerance = Math.max(Math.abs(assets) * 0.05, 1e6);
    if (diff > tolerance) {
      flags.push({
        flag: 'Balance sheet reconciliation gap',
        severity: 'medium',
        detail: `Assets do not reconcile with liabilities + equity within tolerance (gap ${roundSig(diff)}).`,
      });
    }
  }

  const revenue = finiteOrNull(currentValues['revenue']);
  const rd = finiteOrNull(currentValues['research_and_development']);
  if (revenue !== null && rd !== null && revenue > 1e10 && rd >= 0 && rd < revenue * 0.001) {
    flags.push({
      flag: 'R&D plausibility check',
      severity: 'medium',
      detail: `R&D is unusually small versus revenue (${((rd / revenue) * 100).toFixed(3)}% of sales). Verify mapping.`,
    });
  }

  const ledgerFcf = byKey.get('fcf')?.current ?? null;
  if (snapshotPeriod) {
    const ratioFcf = ratios.find(r => r.name === 'fcf' && r.period === snapshotPeriod)?.value ?? null;
    if (
      ratioFcf !== null &&
      ledgerFcf !== null &&
      isFinite(ratioFcf) &&
      isFinite(ledgerFcf) &&
      Math.abs(ratioFcf - ledgerFcf) > Math.max(Math.abs(ledgerFcf) * 0.02, 5e6)
    ) {
      flags.push({
        flag: 'FCF reconciliation mismatch',
        severity: 'medium',
        detail: `Computed FCF differs from ratio engine output for ${snapshotPeriod}; using deterministic CFO-CapEx computation.`,
      });
    }
  }

  const periodLockFailures = ledger.metrics
    .filter(m => m.current === null && m.prior !== null)
    .map(m => m.displayName);
  if (periodLockFailures.length > 0) {
    flags.push({
      flag: 'Current-period completeness gap',
      severity: 'low',
      detail: `Current period is missing ${periodLockFailures.slice(0, 4).join(', ')} while prior exists.`,
    });
  }

  return {
    flags,
    excludedMetricKeys,
  };
}

function toKeyMetricsMap(
  ledgerMetrics: LedgerMetric[],
  excludedMetricKeys: Set<string>,
): Record<string, KeyMetricValue> {
  const out: Record<string, KeyMetricValue> = {};
  for (const metric of ledgerMetrics) {
    if (excludedMetricKeys.has(metric.key)) continue;
    if (metric.current === null) continue;
    out[metric.displayName] = {
      current: metric.current,
      prior: metric.prior,
      change: metric.change,
      unit: metric.unit,
    };
  }
  return out;
}

function identifyTopTrends(trends: TrendData[]): AnalysisInsights['topTrends'] {
  return trends
    .filter(t => t.cagr !== null && isFinite(t.cagr))
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
        ? `${mapping?.displayName || t.metric} has been roughly flat.`
        : `${mapping?.displayName || t.metric} has ${direction === 'up' ? 'grown' : 'declined'} at a ${pct}% CAGR.`;

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

function identifyQuantRedFlags(
  metrics: Record<string, KeyMetricValue>,
  trends: TrendData[],
): AnalysisInsights['redFlags'] {
  const flags: AnalysisInsights['redFlags'] = [];

  const de = metrics['Debt-to-Equity'];
  if (de && isFinite(de.current) && de.current > 2) {
    flags.push({
      flag: 'High leverage',
      severity: de.current > 5 ? 'high' : 'medium',
      detail: `Debt-to-equity at ${de.current.toFixed(2)}x indicates elevated leverage.`,
    });
  }

  const netMargin = metrics['Net Margin'];
  if (netMargin && isFinite(netMargin.current) && netMargin.current < 0) {
    flags.push({
      flag: 'Negative profitability',
      severity: 'high',
      detail: `Net margin is ${(netMargin.current * 100).toFixed(1)}%, indicating a loss-making profile.`,
    });
  }

  const revenue = metrics['Revenue'];
  if (revenue && revenue.change !== null && isFinite(revenue.change) && revenue.change < -0.05) {
    flags.push({
      flag: 'Declining revenue',
      severity: 'high',
      detail: `Revenue declined ${(Math.abs(revenue.change) * 100).toFixed(1)}% versus prior year.`,
    });
  }

  const ocf = metrics['Operating Cash Flow'];
  if (ocf && isFinite(ocf.current) && ocf.current < 0) {
    flags.push({
      flag: 'Negative operating cash flow',
      severity: 'high',
      detail: 'Operating cash flow is negative in the current annual period.',
    });
  }

  const currentRatio = metrics['Current Ratio'];
  if (currentRatio && isFinite(currentRatio.current) && currentRatio.current < 1) {
    flags.push({
      flag: 'Low liquidity',
      severity: 'medium',
      detail: `Current ratio is ${currentRatio.current.toFixed(2)}x, below 1.0x.`,
    });
  }

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

function identifyStrengths(metrics: Record<string, KeyMetricValue>): AnalysisInsights['strengths'] {
  const strengths: AnalysisInsights['strengths'] = [];

  const grossMargin = metrics['Gross Margin'];
  if (grossMargin && isFinite(grossMargin.current) && grossMargin.current > 0.5) {
    strengths.push({
      metric: 'gross_margin',
      detail: `Gross margin of ${(grossMargin.current * 100).toFixed(1)}% indicates strong pricing power.`,
    });
  }

  const roe = metrics['Return on Equity'];
  if (roe && isFinite(roe.current) && roe.current > 0.15) {
    strengths.push({
      metric: 'roe',
      detail: `ROE of ${(roe.current * 100).toFixed(1)}% indicates efficient use of shareholder capital.`,
    });
  }

  const revenue = metrics['Revenue'];
  if (revenue && revenue.change !== null && isFinite(revenue.change) && revenue.change > 0.1) {
    strengths.push({
      metric: 'revenue_growth',
      detail: `Revenue is up ${(revenue.change * 100).toFixed(1)}% year over year, showing strong top-line momentum.`,
    });
  }

  const currentRatio = metrics['Current Ratio'];
  if (currentRatio && isFinite(currentRatio.current) && currentRatio.current > 1.5) {
    strengths.push({
      metric: 'current_ratio',
      detail: `Current ratio of ${currentRatio.current.toFixed(2)}x indicates solid liquidity.`,
    });
  }

  return strengths;
}

function resolveDebt(values: Record<string, number>): number | null {
  const totalDebt = finiteOrNull(values['total_debt']);
  if (totalDebt !== null) return totalDebt;

  const longTerm = finiteOrNull(values['long_term_debt']);
  const shortTerm = finiteOrNull(values['short_term_debt']);
  if (longTerm === null && shortTerm === null) return null;
  return (longTerm ?? 0) + (shortTerm ?? 0);
}

function safeDivide(a: number | undefined, b: number | undefined): number | null {
  const num = finiteOrNull(a);
  const den = finiteOrNull(b);
  if (num === null || den === null || den === 0) return null;
  return num / den;
}

function finiteOrNull(value: number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  return isFinite(value) ? value : null;
}

function computeChange(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || !isFinite(current) || !isFinite(prior) || prior === 0) {
    return null;
  }
  return current / prior - 1;
}

function dedupeFlags(flags: AnalysisInsights['redFlags']): AnalysisInsights['redFlags'] {
  const out: AnalysisInsights['redFlags'] = [];
  const seen = new Set<string>();
  for (const flag of flags) {
    const key = `${flag.flag}|${flag.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(flag);
  }
  return out;
}

function detectLatestAnnualPeriod(facts?: CompanyFacts): string | null {
  if (!facts) return null;
  let latest: string | null = null;
  for (const fact of facts.facts) {
    for (const p of fact.periods) {
      if (!ANNUAL_FORMS.has(p.form)) continue;
      if (!latest || p.period.localeCompare(latest) > 0) {
        latest = p.period;
      }
    }
  }
  return latest;
}

function roundSig(value: number): string {
  if (!isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}
