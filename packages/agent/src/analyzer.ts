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
} from '@shawyan/shared';
import { formatCompactCurrency, formatMetricChange, getMappingByName, crossValidatedShareCount, shareCountDiverges } from '@shawyan/shared';
import {
  hasCashPresentationAlternative,
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
  notes?: string[];
}

interface MetricSuppressionState {
  scope: 'current' | 'all';
  reason: string;
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
  compute: (values: Record<string, number>, notes?: string[]) => number | null;
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
    dependencies: ['total_debt'],
    compute: v => finiteOrNull(v['total_debt']),
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
    key: 'cash_and_equivalents_and_restricted_cash',
    displayName: 'Cash, Cash Equivalents & Restricted Cash',
    unit: 'USD',
    dependencies: ['cash_and_equivalents_and_restricted_cash'],
    compute: v => finiteOrNull(v['cash_and_equivalents_and_restricted_cash']),
  },
  {
    key: 'restricted_cash',
    displayName: 'Restricted Cash',
    unit: 'USD',
    dependencies: ['restricted_cash'],
    compute: v => finiteOrNull(v['restricted_cash']),
  },
  {
    key: 'cash_and_equivalents_and_short_term_investments',
    displayName: 'Cash, Cash Equivalents & Short-Term Investments',
    unit: 'USD',
    dependencies: ['cash_and_equivalents_and_short_term_investments'],
    compute: v => finiteOrNull(v['cash_and_equivalents_and_short_term_investments']),
  },
  {
    key: 'short_term_investments',
    displayName: 'Short-Term Investments',
    unit: 'USD',
    dependencies: ['short_term_investments'],
    compute: v => finiteOrNull(v['short_term_investments']),
  },
  {
    key: 'marketable_securities',
    displayName: 'Marketable Securities',
    unit: 'USD',
    dependencies: ['marketable_securities'],
    compute: v => finiteOrNull(v['marketable_securities']),
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
    key: 'cash_ending',
    displayName: 'Cash at End of Period (cash-flow statement)',
    unit: 'USD',
    dependencies: ['cash_ending'],
    compute: v => finiteOrNull(v['cash_ending']),
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
    dependencies: ['free_cash_flow'],
    compute: v => finiteOrNull(v['free_cash_flow']),
  },
  {
    key: 'working_capital',
    displayName: 'Working Capital',
    unit: 'USD',
    dependencies: ['working_capital'],
    compute: v => finiteOrNull(v['working_capital']),
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
    dependencies: ['current_assets', 'current_liabilities', 'inventory'],
    compute: (v, notes) => {
      const currentAssets = finiteOrNull(v['current_assets']);
      const currentLiabilities = finiteOrNull(v['current_liabilities']);
      if (currentAssets === null || currentLiabilities === null || currentLiabilities === 0) return null;
      const inventory = finiteOrNull(v['inventory']);
      if (inventory === null) return null;
      if (notes) notes.push('Quick ratio excludes reported inventory from current assets.');
      return (currentAssets - (inventory ?? 0)) / currentLiabilities;
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
    dependencies: ['total_debt', 'stockholders_equity'],
    compute: v => safeDivide(v['total_debt'], v['stockholders_equity']),
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
  const { periodMaps, periodBases } = resolvePeriodAnchors(context, policy);

  for (const ticker of context.tickers) {
    const facts = context.facts[ticker];
    const periodMap = periodMaps.get(ticker) || new Map<string, PeriodBucket>();
    const sourceMap = buildCanonicalAnnualSourceMap(context, ticker);
    const basis = periodBases[ticker] || selectPeriodBasis(periodMap, facts);
    const ledger = computeLedgerMetrics(periodMap, sourceMap, basis.current, basis.prior, policy);
    const sanityFlags = runSanityChecks(ledger, periodMap, basis.current);
    applyMetricSuppressions(ledger.metrics, sanityFlags.suppressedMetrics);
    const keyMetrics = toKeyMetricsMap(ledger.metrics, sanityFlags.excludedMetricKeys);

    const redFlags = dedupeFlags([
      ...identifyQuantRedFlags(keyMetrics),
      ...sanityFlags.flags,
    ]);
    const strengths = identifyStrengths(keyMetrics);

    results[ticker] = {
      snapshotPeriod: basis.current,
      priorPeriod: basis.prior,
      periodBasis: basis,
      topTrends: identifyTopTrends(periodMap),
      redFlags,
      strengths,
      keyMetrics,
      canonicalFacts: Object.fromEntries(ledger.metrics.map(m => [m.key, m])),
    };
  }

  return results;
}

export function resolvePeriodAnchors(
  context: AnalysisContext,
  policy: ReportingPolicy = context.policy || DEFAULT_ANALYZER_POLICY,
): {
  periodMaps: Map<string, Map<string, PeriodBucket>>;
  comparisonBasis: ComparisonBasisResolution | null;
  periodBases: Record<string, PeriodBasis>;
} {
  const periodMaps = new Map<string, Map<string, PeriodBucket>>();
  for (const ticker of context.tickers) {
    periodMaps.set(ticker, buildAnnualPeriodMap(context, ticker));
  }

  const comparisonBasis = context.type === 'comparison'
    ? selectComparisonBasis(context, periodMaps, policy)
    : null;
  context.comparison_basis = comparisonBasis;

  const periodBases: Record<string, PeriodBasis> = {};
  for (const ticker of context.tickers) {
    const periodMap = periodMaps.get(ticker) || new Map<string, PeriodBucket>();
    const facts = context.facts[ticker];
    periodBases[ticker] = comparisonBasis
      ? selectComparisonPeriodBasis(ticker, periodMap, facts, comparisonBasis, policy)
      : selectPeriodBasis(periodMap, facts);
  }

  return {
    periodMaps,
    comparisonBasis,
    periodBases,
  };
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
    note: `Peer metrics use ${current} as the shared current period${prior ? ` and ${prior} as the shared prior period` : ''}.`,
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
    note: `Peer metrics use the shared fiscal-year cohorts ${currentKey}${priorKey ? ` and ${priorKey}` : ''}; fiscal year-ends differ by up to ${currentSpread} days in the current period shown.`,
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
    const computeNotes: string[] = [];
    const currentComputed = computeMetricFromValues(def, snapshotValues, computeNotes);
    const priorComputed = computeMetricFromValues(def, priorValues);

    const current = currentComputed;
    const prior = priorComputed;

    const basis = metricBasisUsage(def.key, snapshotValues, priorValues, policy);
    const basisNote = metricNote(def.key, basis);
    const allNotes = [basisNote, ...computeNotes].filter(Boolean).join('; ');
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
      note: allNotes || undefined,
    });
  }

  // Average-based efficiency metrics anchored to the same locked periods.
  const currentRevenue = finiteOrNull(snapshotValues['revenue']);
  const priorRevenue = finiteOrNull(priorValues['revenue']);
  const currentAssets = finiteOrNull(snapshotValues['total_assets']);
  const priorAssets = finiteOrNull(priorValues['total_assets']);
  const earlierPeriod = priorPeriod
    ? Array.from(periodMap.keys())
      .filter(period => period.localeCompare(priorPeriod) < 0)
      .sort((a, b) => b.localeCompare(a))[0] ?? null
    : null;
  const earlierValues = earlierPeriod ? periodMap.get(earlierPeriod)?.values || {} : {};
  const earlierAssets = finiteOrNull(earlierValues['total_assets']);
  const currentEquity = finiteOrNull(snapshotValues['stockholders_equity']);
  const priorEquity = finiteOrNull(priorValues['stockholders_equity']);
  const earlierEquity = finiteOrNull(earlierValues['stockholders_equity']);
  const currentNetIncome = finiteOrNull(snapshotValues['net_income']);
  const priorNetIncome = finiteOrNull(priorValues['net_income']);

  const avgAssetsCurrent = average(currentAssets, priorAssets);
  const avgEquityCurrent = average(currentEquity, priorEquity);
  const avgAssetsPrior = average(priorAssets, earlierAssets);
  const avgEquityPrior = average(priorEquity, earlierEquity);
  const roaCurrent = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(currentNetIncome ?? undefined, avgAssetsCurrent ?? undefined)
    : safeDivide(currentNetIncome ?? undefined, currentAssets ?? undefined);
  const roaPrior = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(priorNetIncome ?? undefined, avgAssetsPrior ?? undefined)
    : safeDivide(priorNetIncome ?? undefined, priorAssets ?? undefined);
  const roeCurrent = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(currentNetIncome ?? undefined, avgEquityCurrent ?? undefined)
    : safeDivide(currentNetIncome ?? undefined, currentEquity ?? undefined);
  const roePrior = policy.returnMetricBasisMode === 'average_balance'
    ? safeDivide(priorNetIncome ?? undefined, avgEquityPrior ?? undefined)
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
        ? 'ROE uses average equity for each annual period only when the adjacent annual balance is available.'
        : 'ROE uses ending equity for each locked annual period.',
    },
    note: policy.returnMetricBasisMode === 'average_balance'
      ? 'Average-balance return policy applied without substituting ending-balance fallbacks.'
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
        ? 'ROA uses average assets for each annual period only when the adjacent annual balance is available.'
        : 'ROA uses ending assets for each locked annual period.',
    },
    note: policy.returnMetricBasisMode === 'average_balance'
      ? 'Average-balance return policy applied without substituting ending-balance fallbacks.'
      : 'Ending-balance return policy applied.',
  });

  const assetTurnoverCurrent = currentRevenue !== null
    ? (
      policy.returnMetricBasisMode === 'average_balance'
        ? safeDivide(currentRevenue, avgAssetsCurrent ?? undefined)
        : safeDivide(currentRevenue, currentAssets ?? undefined)
    )
    : null;
  const assetTurnoverPrior = priorRevenue !== null
    ? (
      policy.returnMetricBasisMode === 'average_balance'
        ? safeDivide(priorRevenue, avgAssetsPrior ?? undefined)
        : safeDivide(priorRevenue, priorAssets ?? undefined)
    )
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
      basis: policy.returnMetricBasisMode,
      note: policy.returnMetricBasisMode === 'average_balance'
        ? 'Asset turnover uses average assets for each annual period only when the adjacent annual balance is available.'
        : 'Asset turnover uses ending assets for each locked annual period.',
    },
    note: policy.returnMetricBasisMode === 'average_balance'
      ? 'Average-balance efficiency policy applied without ending-balance fallback.'
      : 'Ending-balance efficiency policy applied.',
  });

  return { metrics };
}

function computeMetricFromValues(
  def: MetricDefinition,
  values: Record<string, number>,
  notes?: string[],
): number | null {
  if (Object.keys(values).length === 0) return null;
  const output = def.compute(values, notes);
  return finiteOrNull(output);
}

function runSanityChecks(
  ledger: { metrics: LedgerMetric[] },
  periodMap: Map<string, PeriodBucket>,
  snapshotPeriod: string | null,
): {
  flags: AnalysisInsights['redFlags'];
  excludedMetricKeys: Set<string>;
  suppressedMetrics: Map<string, MetricSuppressionState>;
} {
  const flags: AnalysisInsights['redFlags'] = [];
  const excludedMetricKeys = new Set<string>();
  const suppressedMetrics = new Map<string, MetricSuppressionState>();
  const byKey = new Map(ledger.metrics.map(m => [m.key, m]));
  const currentValues = snapshotPeriod ? periodMap.get(snapshotPeriod)?.values || {} : {};

  const grossProfit = finiteOrNull(currentValues['gross_profit']);
  const operatingIncome = finiteOrNull(currentValues['operating_income']);
  if (grossProfit !== null && operatingIncome !== null && grossProfit < operatingIncome) {
      flags.push({
        flag: 'Gross profit mapping check failed',
        severity: 'high',
        detail: `Gross profit (${roundSigCurrency(grossProfit)}) is below operating income (${roundSigCurrency(operatingIncome)}). Gross-margin metrics were excluded.`,
      });
    suppressedMetrics.set('gross_profit', {
      scope: 'current',
      reason: 'Suppressed because the current gross profit concept failed the operating-income sanity check.',
    });
    suppressedMetrics.set('gross_margin', {
      scope: 'current',
      reason: 'Suppressed because gross margin depends on a current gross profit concept that failed the operating-income sanity check.',
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
        flag: 'Balance sheet presentation nuance',
        severity: 'medium',
        detail: `The balance sheet does not tie perfectly on the reported lines, with an unexplained gap of ${roundSigCurrency(diff)} between assets and liabilities plus equity.`,
      });
    }
  }

  const pretaxIncome = finiteOrNull(currentValues['pretax_income']);
  const netIncomeForIdentity = finiteOrNull(currentValues['net_income']);
  const taxExpense = finiteOrNull(currentValues['income_tax_expense']);
  if (pretaxIncome !== null && netIncomeForIdentity !== null && taxExpense !== null) {
    const expectedPretax = netIncomeForIdentity + taxExpense;
    const identityGap = Math.abs(pretaxIncome - expectedPretax);
    const identityTolerance = Math.max(Math.abs(expectedPretax) * 0.05, 1_000_000);
    if (identityGap > identityTolerance) {
      flags.push({
        flag: 'Income statement presentation nuance',
        severity: 'medium',
        detail: `Reported pretax income of ${roundSigCurrency(pretaxIncome)} does not line up cleanly with net income and tax expense, so the tax bridge should be interpreted with caution.`,
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
    .filter(m => !(m.key === 'cash_and_equivalents' && hasCashPresentationAlternative(currentValues, 'cash_and_equivalents')))
    .filter(m => !(m.key === 'restricted_cash' && hasCashPresentationAlternative(currentValues, 'restricted_cash')))
    .filter(m => !(m.key === 'short_term_investments' && hasCashPresentationAlternative(currentValues, 'short_term_investments')))
    .map(m => m.displayName);
  if (periodLockFailures.length > 0) {
    const missingList = periodLockFailures.slice(0, 4);
    const missingText = missingList.join(', ');
    const plural = missingList.length > 1;
    flags.push({
      flag: 'Current-period completeness gap',
      severity: 'low',
      detail: plural
        ? `The current period does not separately disclose ${missingText}, even though those items appear in the prior period.`
        : `The current period does not separately disclose ${missingText}, even though that item appears in the prior period.`,
    });
  }

  return {
    flags,
    excludedMetricKeys,
    suppressedMetrics,
  };
}

function applyMetricSuppressions(
  metrics: LedgerMetric[],
  suppressedMetrics: Map<string, MetricSuppressionState>,
): void {
  for (const metric of metrics) {
    const suppression = suppressedMetrics.get(metric.key);
    if (!suppression) continue;
    metric.current = null;
    metric.change = null;
    metric.availability.current = 'intentionally_suppressed';
    if (suppression.scope === 'all') {
      metric.prior = null;
      metric.availability.prior = 'intentionally_suppressed';
    }
    metric.note = [metric.note, suppression.reason].filter(Boolean).join('; ') || suppression.reason;
  }
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
  const sourceMetric = sources[def.key];
  if (finalValue !== null) {
    if (computedValue !== null) {
      if (sourceMetric?.kind === 'derived') return 'derived';
      if (sourceMetric?.kind === 'adjusted') return 'derived';
      if (sourceMetric?.kind === 'xbrl' || sourceMetric?.kind === 'statement') return 'reported';
      if (def.dependencies.length > 1) return 'derived';
      if (values[def.dependencies[0]!] !== undefined) return 'reported';
      return 'derived';
    }
    return 'reported';
  }
  if (sourceMetric?.kind === 'unknown') {
    if (/suppressed/i.test(sourceMetric.detail || '')) {
      return 'intentionally_suppressed';
    }
    return 'basis_conflict';
  }
  if (def.dependencies.some(dep => sources[dep]?.kind === 'unknown' && /suppressed/i.test(sources[dep]?.detail || ''))) {
    return 'intentionally_suppressed';
  }
  if (def.dependencies.some(dep => sources[dep]?.kind === 'unknown')) {
    return 'basis_conflict';
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

function identifyTopTrends(periodMap: Map<string, PeriodBucket>): AnalysisInsights['topTrends'] {
  const candidateMetrics = [
    'revenue',
    'gross_profit',
    'operating_income',
    'net_income',
    'operating_cash_flow',
    'free_cash_flow',
  ];

  return candidateMetrics
    .map(metric => {
      const values = Array.from(periodMap.entries())
        .map(([period, bucket]) => ({ period, value: finiteOrNull(bucket.values[metric]) }))
        .filter((entry): entry is { period: string; value: number } => entry.value !== null)
        .sort((a, b) => a.period.localeCompare(b.period));
      if (values.length < 2) return null;

      const first = values[0]!;
      const last = values[values.length - 1]!;
      const years = Math.max(values.length - 1, 1);
      const cagr = first.value > 0 && last.value > 0
        ? Math.pow(last.value / first.value, 1 / years) - 1
        : null;
      const trendSignal = cagr ?? ((last.value - first.value) / Math.max(Math.abs(first.value), 1));
      const mapping = getMappingByName(metric);

      let direction: 'up' | 'down' | 'flat' = 'flat';
      if (trendSignal > 0.02) direction = 'up';
      else if (trendSignal < -0.02) direction = 'down';

      const absSignal = Math.abs(trendSignal);
      let description: string;
      if (direction === 'flat') {
        description = 'The multi-year trajectory has been broadly stable without a strong directional shift.';
      } else if (direction === 'up') {
        if (absSignal > 0.20) description = 'The scale-up across the observed annual periods is pronounced and financially material.';
        else if (absSignal > 0.08) description = 'The multi-year progression is steady enough to suggest an improving operating profile.';
        else description = 'The multi-year trend is positive, but the pace is moderate rather than transformative.';
      } else {
        if (absSignal > 0.20) description = 'The decline is steep enough to suggest a material deterioration in the operating base.';
        else if (absSignal > 0.08) description = 'The contraction is sustained and likely to pressure margins or capital allocation choices.';
        else description = 'The decline is gradual, but the direction remains negative across the observed periods.';
      }

      return {
        metric,
        displayName: mapping?.displayName || metric,
        direction,
        cagr,
        latestValue: last.value,
        description,
      };
    })
    .filter((trend): trend is NonNullable<typeof trend> => !!trend)
    .sort((a, b) => Math.abs(b.cagr ?? 0) - Math.abs(a.cagr ?? 0))
    .slice(0, 5);
}

function identifyQuantRedFlags(
  metrics: Record<string, KeyMetricValue>,
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

  return flags;
}

function identifyStrengths(metrics: Record<string, KeyMetricValue>): AnalysisInsights['strengths'] {
  const strengths: AnalysisInsights['strengths'] = [];

  const grossMargin = metrics['Gross Margin'];
  if (grossMargin && isFinite(grossMargin.current) && grossMargin.current > 0.5) {
    const pct = (grossMargin.current * 100).toFixed(1);
    const detail = grossMargin.current > 0.7
      ? `Gross margin of ${pct}% leaves a large share of revenue available to absorb operating costs and support profitability.`
      : `Gross margin of ${pct}% leaves the company with a reasonable buffer to absorb operating expenses.`;
    strengths.push({ metric: 'gross_margin', detail });
  }

  const roe = metrics['Return on Equity'];
  const equity = metrics["Stockholders' Equity"];
  if (roe && isFinite(roe.current) && roe.current > 0.15 && (!equity || equity.current > 0)) {
    const pct = (roe.current * 100).toFixed(1);
    const detail = roe.current > 0.30
      ? `ROE of ${pct}% points to very strong earnings generation relative to book equity.`
      : `ROE of ${pct}% points to solid earnings generation relative to book equity.`;
    strengths.push({ metric: 'roe', detail });
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
    const detail = revenue.change > 0.25
      ? `Revenue rose ${revenueChangeDisplay} year over year, marking a meaningful step-up in scale.`
      : `Revenue grew ${revenueChangeDisplay} year over year, providing a clear top-line tailwind.`;
    strengths.push({ metric: 'revenue_growth', detail });
  }

  const currentRatio = metrics['Current Ratio'];
  const ocf = metrics['Operating Cash Flow'];
  const fcf = metrics['Free Cash Flow'];
  const hasCashStress = !!(
    (ocf && isFinite(ocf.current) && ocf.current < 0)
    || (fcf && isFinite(fcf.current) && fcf.current < 0)
  );
  if (currentRatio && isFinite(currentRatio.current) && currentRatio.current > 1.5 && !hasCashStress) {
    const detail = currentRatio.current > 2.5
      ? `Current ratio of ${currentRatio.current.toFixed(2)}x provides a wide cushion against near-term obligations.`
      : `Current ratio of ${currentRatio.current.toFixed(2)}x points to adequate near-term coverage.`;
    strengths.push({ metric: 'current_ratio', detail });
  }

  return strengths;
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
 * Delegates core divergence logic to the shared crossValidatedShareCount(),
 * then wraps the result with MetricBasisUsage metadata.
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
        disclosureText: 'Period-end shares were unavailable for the period shown in this note.',
        alternativesConsidered: ['weighted_average_diluted'],
      },
    };
  }

  const validated = crossValidatedShareCount(v);
  const divergent = shareCountDiverges(v);

  if (divergent && validated !== null && validated !== shares) {
    return {
      value: validated,
      basis: {
        metric: 'bvps',
        displayName: 'Book Value Per Share',
        basis: 'cross_validated_fallback',
        fallbackUsed: true,
        note: 'Period-end shares diverged materially from EPS-implied diluted shares; BVPS uses diluted weighted-average shares as the fallback basis.',
        disclosureText: 'Book Value Per Share uses diluted weighted-average shares because reported period-end shares diverged materially from EPS-implied diluted shares.',
        alternativesConsidered: ['period_end_shares', 'weighted_average_diluted'],
      },
    };
  }

  return {
    value: validated,
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
          ? 'Return on Equity uses average equity across the current and prior annual periods shown in this note.'
          : 'Return on Equity uses ending equity in the period shown in this note.',
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
          ? 'Return on Assets uses average assets across the current and prior annual periods shown in this note.'
          : 'Return on Assets uses ending assets in the period shown in this note.',
        alternativesConsidered: ['average_balance', 'ending_balance'],
      };
    case 'asset_turnover':
      return {
        metric: key,
        displayName: 'Asset Turnover',
        basis: 'average_balance',
        note: 'Asset turnover uses average assets.',
        disclosureText: 'Asset Turnover uses average assets across the annual periods shown in this note.',
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

function roundSigCurrency(value: number): string {
  return formatCompactCurrency(value, { smallDecimals: 1, smartDecimals: true });
}
