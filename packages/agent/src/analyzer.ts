/**
 * Deterministic analyzer — canonical period lock + metric ledger.
 * No LLM calls. All cross-section numeric values should flow from here.
 */

import type {
  AnalysisContext,
  ComparisonBasisResolution,
  CompanyFacts,
  MetricAvailabilityReasonCode,
  MetricBasisUsage,
  ReportingPolicy,
  TrendData,
} from '@dolph/shared';
import { formatMetricChange, getMappingByName } from '@dolph/shared';
import {
  buildCanonicalAnnualPeriodMap,
  buildCanonicalAnnualPeriodMetadataMap,
  buildCanonicalAnnualSourceMap,
  type CanonicalFactSource,
} from './report-facts.js';
import { INSTITUTIONAL_DEFAULTS } from './report-policy.js';

type FlagSeverity = 'high' | 'medium' | 'low';

type MetricUnit = 'USD' | '%' | 'x' | 'USD/shares' | 'shares';

interface KeyMetricValue {
  current: number;
  prior: number | null;
  change: number | null;
  unit: MetricUnit;
}

export interface PeriodBasis {
  source: 'statements' | 'facts';
  current: string | null;
  prior: string | null;
  note?: string;
}

export interface LedgerMetric {
  key: string;
  displayName: string;
  unit: MetricUnit;
  current: number | null;
  prior: number | null;
  change: number | null;
  availability: {
    current: MetricAvailabilityReasonCode;
    prior: MetricAvailabilityReasonCode;
  };
  basis?: MetricBasisUsage;
  note?: string;
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
    key: 'gross_profit',
    displayName: 'Gross Profit',
    unit: 'USD',
    dependencies: ['gross_profit'],
    compute: v => finiteOrNull(v['gross_profit']),
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
    key: 'total_debt',
    displayName: 'Total Debt',
    unit: 'USD',
    dependencies: ['total_debt', 'long_term_debt', 'short_term_debt'],
    compute: v => resolveDebt(v),
  },
  {
    key: 'stockholders_equity',
    displayName: "Stockholders' Equity",
    unit: 'USD',
    dependencies: ['stockholders_equity'],
    compute: v => finiteOrNull(v['stockholders_equity']),
  },
  {
    key: 'current_assets',
    displayName: 'Current Assets',
    unit: 'USD',
    dependencies: ['current_assets'],
    compute: v => finiteOrNull(v['current_assets']),
  },
  {
    key: 'current_liabilities',
    displayName: 'Current Liabilities',
    unit: 'USD',
    dependencies: ['current_liabilities'],
    compute: v => finiteOrNull(v['current_liabilities']),
  },
  {
    key: 'cash_and_equivalents',
    displayName: 'Cash & Equivalents',
    unit: 'USD',
    dependencies: ['cash_and_equivalents'],
    compute: v => finiteOrNull(v['cash_and_equivalents']),
  },
  {
    key: 'long_term_debt',
    displayName: 'Long-Term Debt',
    unit: 'USD',
    dependencies: ['long_term_debt'],
    compute: v => finiteOrNull(v['long_term_debt']),
  },
  {
    key: 'short_term_debt',
    displayName: 'Short-Term Debt',
    unit: 'USD',
    dependencies: ['short_term_debt'],
    compute: v => finiteOrNull(v['short_term_debt']),
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
  },
  {
    key: 'shares_outstanding',
    displayName: 'Shares Outstanding',
    unit: 'shares',
    dependencies: ['shares_outstanding'],
    compute: v => finiteOrNull(v['shares_outstanding']),
  },
  {
    key: 'bvps',
    displayName: 'Book Value Per Share',
    unit: 'USD/shares',
    dependencies: ['stockholders_equity', 'shares_outstanding'],
    compute: v => {
      const equity = finiteOrNull(v['stockholders_equity']);
      if (equity === null) return null;
      const shares = crossValidatedShares(v).value;
      if (shares === null || shares === 0) return null;
      return equity / shares;
    },
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
  },
  {
    key: 'working_capital',
    displayName: 'Working Capital',
    unit: 'USD',
    dependencies: ['current_assets', 'current_liabilities'],
    compute: v => {
      const currentAssets = finiteOrNull(v['current_assets']);
      const currentLiabilities = finiteOrNull(v['current_liabilities']);
      if (currentAssets === null || currentLiabilities === null) return null;
      return currentAssets - currentLiabilities;
    },
  },
  {
    key: 'gross_margin',
    displayName: 'Gross Margin',
    unit: '%',
    dependencies: ['gross_profit', 'revenue'],
    compute: v => safeDivide(v['gross_profit'], v['revenue']),
  },
  {
    key: 'operating_margin',
    displayName: 'Operating Margin',
    unit: '%',
    dependencies: ['operating_income', 'revenue'],
    compute: v => safeDivide(v['operating_income'], v['revenue']),
  },
  {
    key: 'net_margin',
    displayName: 'Net Margin',
    unit: '%',
    dependencies: ['net_income', 'revenue'],
    compute: v => safeDivide(v['net_income'], v['revenue']),
  },
  {
    key: 'roe',
    displayName: 'Return on Equity',
    unit: '%',
    dependencies: ['net_income', 'stockholders_equity'],
    compute: v => safeDivide(v['net_income'], v['stockholders_equity']),
  },
  {
    key: 'roa',
    displayName: 'Return on Assets',
    unit: '%',
    dependencies: ['net_income', 'total_assets'],
    compute: v => safeDivide(v['net_income'], v['total_assets']),
  },
  {
    key: 'current_ratio',
    displayName: 'Current Ratio',
    unit: 'x',
    dependencies: ['current_assets', 'current_liabilities'],
    compute: v => safeDivide(v['current_assets'], v['current_liabilities']),
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
  },
  {
    key: 'asset_turnover',
    displayName: 'Asset Turnover',
    unit: 'x',
    dependencies: ['revenue', 'total_assets'],
    compute: _v => null,
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

const DEFAULT_ANALYZER_POLICY: ReportingPolicy = { ...INSTITUTIONAL_DEFAULTS };

export function analyzeData(
  context: AnalysisContext,
  policy: ReportingPolicy = context.policy || DEFAULT_ANALYZER_POLICY,
): Record<string, AnalysisInsights> {
  const results: Record<string, AnalysisInsights> = {};
  const periodMaps = new Map<string, Map<string, PeriodBucket>>();

  for (const ticker of context.tickers) {
    periodMaps.set(ticker, buildAnnualPeriodMap(context, ticker));
  }

  const comparisonBasis = context.type === 'comparison'
    ? selectComparisonBasis(context, periodMaps, policy)
    : null;
  context.comparison_basis = comparisonBasis;

  for (const ticker of context.tickers) {
    const trends = context.trends[ticker] || [];
    const facts = context.facts[ticker];
    const periodMap = periodMaps.get(ticker) || new Map<string, PeriodBucket>();
    const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
    const basis = comparisonBasis
      ? selectComparisonPeriodBasis(ticker, periodMap, facts, comparisonBasis, policy)
      : selectPeriodBasis(periodMap, facts);
    const ledger = computeLedgerMetrics(periodMap, sourceMap, basis.current, basis.prior, policy);
    const sanityFlags = runSanityChecks(ledger, periodMap, basis.current);
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

function selectComparisonBasis(
  context: AnalysisContext,
  periodMaps: Map<string, Map<string, PeriodBucket>>,
  policy: ReportingPolicy,
): ComparisonBasisResolution | null {
  const requestedMode = policy.requestedComparisonBasisMode || policy.comparisonBasisMode;
  const descriptorsByTicker = new Map(
    context.tickers.map(ticker => [ticker, buildAnnualPeriodDescriptors(context, ticker, periodMaps.get(ticker) || new Map())] as const),
  );

  if (policy.comparisonBasisMode !== 'overlap_normalized') {
    return buildLatestPerPeerResolution(
      context,
      descriptorsByTicker,
      requestedMode,
      policy.comparisonBasisMode,
      'resolved',
      policy.comparisonBasisMode === 'latest_per_peer_screening'
        ? 'Peer figures are screening-only and use each company’s latest annual filing.'
        : 'Peer figures use each company’s latest annual filing with prominent disclosure that fiscal periods can differ across peers.',
      null,
    );
  }

  const exact = resolveExactDateOverlap(context.tickers, descriptorsByTicker, requestedMode);
  if (exact) {
    return exact;
  }

  const cohort = resolveFiscalCohortOverlap(context.tickers, descriptorsByTicker, requestedMode, policy.comparisonMaxPeriodSpreadDays);
  if (cohort) {
    return cohort;
  }

  if (policy.comparisonFallbackMode) {
    return buildLatestPerPeerResolution(
      context,
      descriptorsByTicker,
      requestedMode,
      policy.comparisonFallbackMode,
      'downgraded',
      policy.comparisonFallbackMode === 'latest_per_peer_screening'
        ? 'No governed shared annual basis existed across all peers, so the comparison downgraded to screening-only latest annual periods.'
        : 'No governed shared annual basis existed across all peers, so the comparison downgraded to latest annual periods with prominent fiscal-period disclosure.',
      'No exact or tolerance-based shared annual period set was available across all peers.',
    );
  }

  return {
    requested_mode: requestedMode,
    effective_mode: 'overlap_normalized',
    status: 'unavailable',
    resolution_kind: 'none',
    comparable_current_key: null,
    comparable_prior_key: null,
    max_current_spread_days: null,
    max_prior_spread_days: null,
    note: 'No shared annual periods were available for overlap-normalized comparison.',
    fallback_reason: 'No exact or tolerance-based shared annual period set was available across all peers.',
    peer_periods: Object.fromEntries(
      context.tickers.map(ticker => [ticker, { current_period: null, prior_period: null }]),
    ),
  };
}

function selectComparisonPeriodBasis(
  ticker: string,
  periodMap: Map<string, PeriodBucket>,
  facts: CompanyFacts | undefined,
  comparisonBasis: ComparisonBasisResolution,
  policy: ReportingPolicy,
): PeriodBasis {
  const peerBinding = comparisonBasis.peer_periods[ticker];
  if (
    comparisonBasis.effective_mode === 'overlap_normalized'
    && peerBinding?.current_period
    && periodMap.has(peerBinding.current_period)
    && (!peerBinding.prior_period || periodMap.has(peerBinding.prior_period))
  ) {
    return {
      source: 'statements',
      current: peerBinding.current_period,
      prior: peerBinding.prior_period,
      note: comparisonBasis.note,
    };
  }

  if (comparisonBasis.effective_mode !== 'overlap_normalized') {
    const basis = selectPeriodBasis(periodMap, facts);
    return {
      ...basis,
      current: peerBinding?.current_period || basis.current,
      prior: peerBinding?.prior_period || basis.prior,
      note: comparisonBasis.note,
    };
  }

  return {
    source: 'statements',
    current: null,
    prior: null,
    note: policy.comparisonRequireOverlap
      ? 'Overlap-normalized comparison failed because one or more peers lack the required shared annual periods.'
      : comparisonBasis.note,
  };
}

interface AnnualPeriodDescriptor {
  period: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
}

function buildAnnualPeriodDescriptors(
  context: AnalysisContext,
  ticker: string,
  periodMap: Map<string, PeriodBucket>,
): AnnualPeriodDescriptor[] {
  const metadata = buildCanonicalAnnualPeriodMetadataMap(context, ticker);
  return Array.from(periodMap.keys())
    .map(period => {
      const meta = metadata.get(period);
      return {
        period,
        fiscalYear: meta?.fiscalYear ?? extractPeriodYear(period),
        fiscalPeriod: meta?.fiscalPeriod ?? 'FY',
      };
    })
    .sort((a, b) => comparePeriodDescriptors(a, b));
}

function comparePeriodDescriptors(a: AnnualPeriodDescriptor, b: AnnualPeriodDescriptor): number {
  const ay = a.fiscalYear ?? extractPeriodYear(a.period) ?? 0;
  const by = b.fiscalYear ?? extractPeriodYear(b.period) ?? 0;
  if (by !== ay) return by - ay;
  return b.period.localeCompare(a.period);
}

function resolveExactDateOverlap(
  tickers: string[],
  descriptorsByTicker: Map<string, AnnualPeriodDescriptor[]>,
  requestedMode: ReportingPolicy['comparisonBasisMode'],
): ComparisonBasisResolution | null {
  const tickerPeriods = tickers.map(ticker => (descriptorsByTicker.get(ticker) || []).map(entry => entry.period));
  if (tickerPeriods.some(periods => periods.length === 0)) return null;

  const overlap = tickerPeriods.reduce<string[]>(
    (acc, periods) => acc.filter(period => periods.includes(period)),
    [...(tickerPeriods[0] || [])],
  ).sort((a, b) => b.localeCompare(a));

  const current = overlap[0] ?? null;
  if (!current) return null;
  const prior = overlap.find(period => period.localeCompare(current) < 0) ?? null;

  return {
    requested_mode: requestedMode,
    effective_mode: 'overlap_normalized',
    status: 'resolved',
    resolution_kind: 'exact_date_overlap',
    comparable_current_key: current,
    comparable_prior_key: prior,
    max_current_spread_days: 0,
    max_prior_spread_days: prior ? 0 : null,
    note: `Peer metrics are overlap-normalized to ${current}${prior ? ` with ${prior} as the shared prior period` : ''}.`,
    fallback_reason: null,
    peer_periods: Object.fromEntries(
      tickers.map(ticker => [ticker, { current_period: current, prior_period: prior }]),
    ),
  };
}

function resolveFiscalCohortOverlap(
  tickers: string[],
  descriptorsByTicker: Map<string, AnnualPeriodDescriptor[]>,
  requestedMode: ReportingPolicy['comparisonBasisMode'],
  maxSpreadDays: number,
): ComparisonBasisResolution | null {
  const keysByTicker = new Map<string, Map<string, AnnualPeriodDescriptor>>();
  for (const ticker of tickers) {
    const byKey = new Map<string, AnnualPeriodDescriptor>();
    for (const descriptor of descriptorsByTicker.get(ticker) || []) {
      const key = descriptorComparableKey(descriptor);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, descriptor);
    }
    if (byKey.size === 0) return null;
    keysByTicker.set(ticker, byKey);
  }

  const sharedKeys = tickers.reduce<string[]>((acc, ticker, index) => {
    const keys = Array.from(keysByTicker.get(ticker)?.keys() || []);
    if (index === 0) return keys;
    return acc.filter(key => keys.includes(key));
  }, []);
  if (sharedKeys.length === 0) return null;

  const sortedKeys = sharedKeys.sort(compareComparableKeysDesc);
  const currentKey = sortedKeys[0] ?? null;
  if (!currentKey) return null;
  const priorKey = sortedKeys.find(key => key !== currentKey) ?? null;

  const currentPeriods = tickers.map(ticker => keysByTicker.get(ticker)?.get(currentKey)?.period || null);
  if (currentPeriods.some(period => !period)) return null;
  const currentSpread = computePeriodSpreadDays(currentPeriods as string[]);
  if (currentSpread === null || currentSpread > maxSpreadDays) return null;

  const priorPeriods = priorKey
    ? tickers.map(ticker => keysByTicker.get(ticker)?.get(priorKey)?.period || null)
    : [];
  const priorSpread = priorKey ? computePeriodSpreadDays(priorPeriods.filter((period): period is string => !!period)) : null;
  if (priorKey && (priorPeriods.some(period => !period) || priorSpread === null || priorSpread > maxSpreadDays)) {
    return null;
  }

  return {
    requested_mode: requestedMode,
    effective_mode: 'overlap_normalized',
    status: 'resolved',
    resolution_kind: 'fiscal_cohort_tolerance',
    comparable_current_key: currentKey,
    comparable_prior_key: priorKey,
    max_current_spread_days: currentSpread,
    max_prior_spread_days: priorSpread,
    note: `Peer metrics are normalized to shared fiscal cohorts ${currentKey}${priorKey ? ` and ${priorKey}` : ''}; fiscal year-ends differ by up to ${currentSpread} days in the current cohort.`,
    fallback_reason: null,
    peer_periods: Object.fromEntries(
      tickers.map(ticker => [
        ticker,
        {
          current_period: keysByTicker.get(ticker)?.get(currentKey)?.period || null,
          prior_period: priorKey ? (keysByTicker.get(ticker)?.get(priorKey)?.period || null) : null,
        },
      ]),
    ),
  };
}

function buildLatestPerPeerResolution(
  context: AnalysisContext,
  descriptorsByTicker: Map<string, AnnualPeriodDescriptor[]>,
  requestedMode: ReportingPolicy['comparisonBasisMode'],
  effectiveMode: ReportingPolicy['comparisonBasisMode'],
  status: ComparisonBasisResolution['status'],
  note: string,
  fallbackReason: string | null,
): ComparisonBasisResolution {
  const peerPeriods = Object.fromEntries(
    context.tickers.map(ticker => {
      const descriptors = descriptorsByTicker.get(ticker) || [];
      return [ticker, {
        current_period: descriptors[0]?.period ?? null,
        prior_period: descriptors[1]?.period ?? null,
      }];
    }),
  );

  const currentSpread = computePeriodSpreadDays(
    Object.values(peerPeriods)
      .map(binding => binding.current_period)
      .filter((period): period is string => !!period),
  );
  const priorSpread = computePeriodSpreadDays(
    Object.values(peerPeriods)
      .map(binding => binding.prior_period)
      .filter((period): period is string => !!period),
  );

  return {
    requested_mode: requestedMode,
    effective_mode: effectiveMode,
    status,
    resolution_kind: 'latest_per_peer',
    comparable_current_key: null,
    comparable_prior_key: null,
    max_current_spread_days: currentSpread,
    max_prior_spread_days: priorSpread,
    note,
    fallback_reason: fallbackReason,
    peer_periods: peerPeriods,
  };
}

function descriptorComparableKey(descriptor: AnnualPeriodDescriptor): string | null {
  const year = descriptor.fiscalYear ?? extractPeriodYear(descriptor.period);
  if (year === null) return null;
  return `FY${year}`;
}

function compareComparableKeysDesc(a: string, b: string): number {
  const ay = parseComparableKeyYear(a);
  const by = parseComparableKeyYear(b);
  if (ay !== null && by !== null && ay !== by) return by - ay;
  return b.localeCompare(a);
}

function parseComparableKeyYear(key: string): number | null {
  const match = key.match(/^FY(\d{4})$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function extractPeriodYear(period: string): number | null {
  const match = period.match(/^(\d{4})-/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function computePeriodSpreadDays(periods: string[]): number | null {
  if (periods.length === 0) return null;
  const timestamps = periods
    .map(period => Date.parse(period))
    .filter(timestamp => Number.isFinite(timestamp));
  if (timestamps.length !== periods.length) return null;
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return Math.round((max - min) / 86_400_000);
}

function buildAnnualPeriodMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, PeriodBucket> {
  const periodMap = new Map<string, PeriodBucket>();
  const canonical = buildCanonicalAnnualPeriodMap(context, ticker);
  for (const [period, values] of canonical) {
    periodMap.set(period, { values: { ...values } });
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
  sourceMap: Map<string, Record<string, CanonicalFactSource>>,
  snapshotPeriod: string | null,
  priorPeriod: string | null,
  policy: ReportingPolicy,
): { metrics: LedgerMetric[] } {
  const snapshotValues = snapshotPeriod ? periodMap.get(snapshotPeriod)?.values || {} : {};
  const priorValues = priorPeriod ? periodMap.get(priorPeriod)?.values || {} : {};
  const snapshotSources = snapshotPeriod ? sourceMap.get(snapshotPeriod) || {} : {};
  const priorSources = priorPeriod ? sourceMap.get(priorPeriod) || {} : {};

  const metrics: LedgerMetric[] = [];
  for (const def of LEDGER_DEFINITIONS) {
    const currentComputed = computeMetricFromValues(def, snapshotValues);
    const priorComputed = computeMetricFromValues(def, priorValues);

    const current = currentComputed;
    const prior = priorComputed;

    const basis = metricBasisUsage(def.key, snapshotValues, priorValues, policy);
    metrics.push({
      key: def.key,
      displayName: def.displayName,
      unit: def.unit,
      current,
      prior,
      change: computeChange(current, prior),
      availability: {
        current: resolveAvailabilityReason(def, current, currentComputed, snapshotValues, snapshotSources, snapshotPeriod !== null),
        prior: resolveAvailabilityReason(def, prior, priorComputed, priorValues, priorSources, priorPeriod !== null),
      },
      basis: basis ?? undefined,
      note: metricNote(def.key, basis),
    });
  }

  // Average-based efficiency metrics anchored to the same locked periods.
  const currentRevenue = finiteOrNull(snapshotValues['revenue']);
  const priorRevenue = finiteOrNull(priorValues['revenue']);
  const currentAssets = finiteOrNull(snapshotValues['total_assets']);
  const priorAssets = finiteOrNull(priorValues['total_assets']);
  const currentEquity = finiteOrNull(snapshotValues['stockholders_equity']);
  const priorEquity = finiteOrNull(priorValues['stockholders_equity']);
  const currentNetIncome = finiteOrNull(snapshotValues['net_income']);
  const priorNetIncome = finiteOrNull(priorValues['net_income']);

  const avgAssetsCurrent = average(currentAssets, priorAssets);
  const avgEquityCurrent = average(currentEquity, priorEquity);
  const roaCurrent = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(currentNetIncome ?? undefined, avgAssetsCurrent ?? currentAssets ?? undefined)
    : safeDivide(currentNetIncome ?? undefined, currentAssets ?? undefined);
  const roaPrior = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(priorNetIncome ?? undefined, priorAssets ?? undefined)
    : safeDivide(priorNetIncome ?? undefined, priorAssets ?? undefined);
  const roeCurrent = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(currentNetIncome ?? undefined, avgEquityCurrent ?? currentEquity ?? undefined)
    : safeDivide(currentNetIncome ?? undefined, currentEquity ?? undefined);
  const roePrior = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(priorNetIncome ?? undefined, priorEquity ?? undefined)
    : safeDivide(priorNetIncome ?? undefined, priorEquity ?? undefined);

  upsertMetric(metrics, {
    key: 'roe',
    displayName: 'Return on Equity',
    unit: '%',
    current: roeCurrent,
    prior: roePrior,
    change: computeChange(roeCurrent, roePrior),
    availability: {
      current: resolveComputedAvailability(roeCurrent, ['net_income', 'stockholders_equity'], snapshotValues),
      prior: resolveComputedAvailability(roePrior, ['net_income', 'stockholders_equity'], priorValues),
    },
    basis: {
      metric: 'roe',
      displayName: 'Return on Equity',
      basis: policy.returnMetricBasisMode,
      note: policy.returnMetricBasisMode === 'average_balance'
        ? 'ROE uses average equity over the locked current/prior annual periods.'
        : 'ROE uses ending equity for each locked annual period.',
    },
    note: policy.returnMetricBasisMode === 'average_balance'
      ? 'Average-balance return policy applied.'
      : 'Ending-balance return policy applied.',
  });

  upsertMetric(metrics, {
    key: 'roa',
    displayName: 'Return on Assets',
    unit: '%',
    current: roaCurrent,
    prior: roaPrior,
    change: computeChange(roaCurrent, roaPrior),
    availability: {
      current: resolveComputedAvailability(roaCurrent, ['net_income', 'total_assets'], snapshotValues),
      prior: resolveComputedAvailability(roaPrior, ['net_income', 'total_assets'], priorValues),
    },
    basis: {
      metric: 'roa',
      displayName: 'Return on Assets',
      basis: policy.returnMetricBasisMode,
      note: policy.returnMetricBasisMode === 'average_balance'
        ? 'ROA uses average assets over the locked current/prior annual periods.'
        : 'ROA uses ending assets for each locked annual period.',
    },
    note: policy.returnMetricBasisMode === 'average_balance'
      ? 'Average-balance return policy applied.'
      : 'Ending-balance return policy applied.',
  });

  const assetTurnoverCurrent = currentRevenue !== null
    ? safeDivide(currentRevenue, avgAssetsCurrent ?? currentAssets ?? undefined)
    : null;
  const assetTurnoverPrior = priorRevenue !== null
    ? safeDivide(priorRevenue, priorAssets ?? undefined)
    : null;
  upsertMetric(metrics, {
    key: 'asset_turnover',
    displayName: 'Asset Turnover',
    unit: 'x',
    current: assetTurnoverCurrent,
    prior: assetTurnoverPrior,
    change: computeChange(assetTurnoverCurrent, assetTurnoverPrior),
    availability: {
      current: resolveComputedAvailability(assetTurnoverCurrent, ['revenue', 'total_assets'], snapshotValues),
      prior: resolveComputedAvailability(assetTurnoverPrior, ['revenue', 'total_assets'], priorValues),
    },
    basis: {
      metric: 'asset_turnover',
      displayName: 'Asset Turnover',
      basis: 'average_balance',
      note: 'Asset turnover uses average assets for the current period and prior ending assets for the prior comparison.',
    },
    note: 'Average-balance efficiency policy applied.',
  });

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

function resolveAvailabilityReason(
  def: MetricDefinition,
  finalValue: number | null,
  computedValue: number | null,
  values: Record<string, number>,
  sources: Record<string, CanonicalFactSource>,
  hasLockedPeriod: boolean,
): MetricAvailabilityReasonCode {
  if (!hasLockedPeriod) return 'comparability_policy';
  if (finalValue !== null) {
    if (computedValue !== null) {
      const sourceMetric = sources[def.key];
      if (sourceMetric?.kind === 'derived') return 'derived';
      if (sourceMetric?.kind === 'adjusted') return 'derived';
      if (sourceMetric?.kind === 'xbrl' || sourceMetric?.kind === 'statement') return 'reported';
      if (def.dependencies.length > 1) return 'derived';
      if (values[def.dependencies[0]!] !== undefined) return 'reported';
      return 'derived';
    }
    return 'reported';
  }
  if (def.dependencies.some(dep => values[dep] === undefined || !isFinite(values[dep]!))) {
    return 'missing_inputs';
  }
  return 'source_unavailable';
}

function resolveComputedAvailability(
  value: number | null,
  dependencies: string[],
  values: Record<string, number>,
): MetricAvailabilityReasonCode {
  if (value !== null) return 'derived';
  if (dependencies.some(dep => values[dep] === undefined || !isFinite(values[dep]!))) return 'missing_inputs';
  return 'source_unavailable';
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
  const revenueChangeDisplay = revenue
    ? formatMetricChange(revenue.change, revenue.current, revenue.prior)
    : 'N/A';
  if (
    revenue
    && revenue.change !== null
    && isFinite(revenue.change)
    && revenue.change > 0.1
    && revenueChangeDisplay !== 'N/A'
    && revenueChangeDisplay !== 'NM'
  ) {
    strengths.push({
      metric: 'revenue_growth',
      detail: `Revenue is up ${revenueChangeDisplay} year over year, showing strong top-line momentum.`,
    });
  }

  const currentRatio = metrics['Current Ratio'];
  const ocf = metrics['Operating Cash Flow'];
  const fcf = metrics['Free Cash Flow'];
  const hasCashStress = !!(
    (ocf && isFinite(ocf.current) && ocf.current < 0)
    || (fcf && isFinite(fcf.current) && fcf.current < 0)
  );
  if (currentRatio && isFinite(currentRatio.current) && currentRatio.current > 1.5 && !hasCashStress) {
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

/**
 * Cross-validate shares_outstanding against EPS-implied share count.
 * If divergence > 50%, the reported shares_outstanding is likely on a different
 * scale (e.g., 22K vs 17M for small biotechs). In that case, fall back to
 * weighted_avg_shares_diluted for per-share calculations.
 */
function crossValidatedShares(v: Record<string, number>): { value: number | null; basis: MetricBasisUsage } {
  const shares = finiteOrNull(v['shares_outstanding']);
  if (shares === null) {
    return {
      value: null,
      basis: {
        metric: 'shares_outstanding',
        displayName: 'Shares Outstanding',
        basis: 'period_end_shares',
        note: 'Period-end shares were unavailable.',
        disclosureText: 'Period-end shares were unavailable in the locked annual basis.',
        alternativesConsidered: ['weighted_average_diluted'],
      },
    };
  }

  const netIncome = finiteOrNull(v['net_income']);
  const epsDiluted = finiteOrNull(v['eps_diluted']);

  if (netIncome !== null && epsDiluted !== null && epsDiluted !== 0) {
    const impliedShares = netIncome / epsDiluted;
    if (isFinite(impliedShares) && impliedShares > 0 && shares > 0) {
      const divergence = Math.abs(impliedShares - shares) / Math.max(impliedShares, shares);
      if (divergence > 0.50) {
        const dilutedShares = finiteOrNull(v['weighted_avg_shares_diluted']);
        if (dilutedShares !== null && dilutedShares > 0) {
          return {
            value: dilutedShares,
            basis: {
              metric: 'bvps',
              displayName: 'Book Value Per Share',
              basis: 'cross_validated_fallback',
              fallbackUsed: true,
              note: 'Period-end shares diverged materially from EPS-implied diluted shares; BVPS uses diluted weighted-average shares as a governed fallback.',
              disclosureText: 'Book Value Per Share uses diluted weighted-average shares because reported period-end shares diverged materially from EPS-implied diluted shares.',
              alternativesConsidered: ['period_end_shares', 'weighted_average_diluted'],
            },
          };
        }
      }
    }
  }

  return {
    value: shares,
    basis: {
      metric: 'bvps',
      displayName: 'Book Value Per Share',
      basis: 'period_end_shares',
      note: 'BVPS uses period-end shares outstanding.',
      disclosureText: 'Book Value Per Share uses period-end shares outstanding.',
      alternativesConsidered: ['weighted_average_diluted'],
    },
  };
}

function computeChange(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || !isFinite(current) || !isFinite(prior) || prior === 0) {
    return null;
  }
  return current / prior - 1;
}

function average(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a !== null && b !== null) return (a + b) / 2;
  return a ?? b;
}

function metricBasisUsage(
  key: string,
  snapshotValues: Record<string, number>,
  _priorValues: Record<string, number>,
  policy: ReportingPolicy,
): MetricBasisUsage | null {
  switch (key) {
    case 'eps':
      return {
        metric: key,
        displayName: 'Earnings Per Share (Diluted)',
        basis: 'weighted_average_diluted',
        note: 'EPS uses diluted weighted-average shares from the income statement.',
        disclosureText: 'Earnings Per Share (Diluted) uses diluted weighted-average shares from the income statement.',
        alternativesConsidered: ['weighted_average_basic', 'period_end_shares'],
      };
    case 'bvps':
      return crossValidatedShares(snapshotValues).basis;
    case 'roe':
      return {
        metric: key,
        displayName: 'Return on Equity',
        basis: policy.returnMetricBasisMode,
        note: policy.returnMetricBasisMode === 'average_balance'
          ? 'ROE uses average equity.'
          : 'ROE uses ending equity.',
        disclosureText: policy.returnMetricBasisMode === 'average_balance'
          ? 'Return on Equity uses average equity in the locked current and prior annual periods.'
          : 'Return on Equity uses ending equity in the locked annual period.',
        alternativesConsidered: ['average_balance', 'ending_balance'],
      };
    case 'roa':
      return {
        metric: key,
        displayName: 'Return on Assets',
        basis: policy.returnMetricBasisMode,
        note: policy.returnMetricBasisMode === 'average_balance'
          ? 'ROA uses average assets.'
          : 'ROA uses ending assets.',
        disclosureText: policy.returnMetricBasisMode === 'average_balance'
          ? 'Return on Assets uses average assets in the locked current and prior annual periods.'
          : 'Return on Assets uses ending assets in the locked annual period.',
        alternativesConsidered: ['average_balance', 'ending_balance'],
      };
    case 'asset_turnover':
      return {
        metric: key,
        displayName: 'Asset Turnover',
        basis: 'average_balance',
        note: 'Asset turnover uses average assets.',
        disclosureText: 'Asset Turnover uses average assets across the locked annual comparison window.',
        alternativesConsidered: ['average_balance'],
      };
    default:
      return null;
  }
}

function metricNote(key: string, basis?: MetricBasisUsage | null): string | undefined {
  if (key === 'total_debt') {
    return 'Total Debt uses reported total debt when available, otherwise long-term debt plus short-term debt.';
  }
  return basis?.note;
}

function upsertMetric(metrics: LedgerMetric[], next: LedgerMetric): void {
  const index = metrics.findIndex(metric => metric.key === next.key);
  if (index >= 0) {
    metrics[index] = next;
    return;
  }
  metrics.push(next);
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
      if (p.fiscal_period && p.fiscal_period !== 'FY') continue;
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
