import type { AnalysisContext, FinancialStatement, ProvenanceReceipt } from '@dolph/shared';

const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);

const CASH_OUTFLOW_METRICS = new Set([
  'capex',
  'capital_expenditures',
  'dividends_paid',
  'share_repurchases',
  'debt_repayment',
]);

export const SHARE_CHANGE_ALERT_THRESHOLD = 1.5;

export type CanonicalSourceKind = 'xbrl' | 'statement' | 'derived' | 'adjusted' | 'unknown';

export interface CanonicalFactSource {
  kind: CanonicalSourceKind;
  ticker: string;
  metric: string;
  period: string;
  form?: string;
  filed?: string;
  statementType?: FinancialStatement['statement_type'];
  provenance?: ProvenanceReceipt;
  detail?: string;
  reportedValue?: number;
}

export interface CanonicalAnnualSeries {
  values: Map<string, Record<string, number>>;
  sources: Map<string, Record<string, CanonicalFactSource>>;
}

export interface CanonicalAnnualPeriodMetadata {
  period: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  forms: string[];
  sources: Array<'facts' | 'statements'>;
}

function finite(value: number | undefined): number | null {
  if (value === undefined) return null;
  return isFinite(value) ? value : null;
}

function materiallyDiffers(a: number, b: number, relativeTolerance = 0.1, absoluteTolerance = 50_000): boolean {
  const gap = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return gap > Math.max(scale * relativeTolerance, absoluteTolerance);
}

export function normalizeMetricValue(metric: string, value: number): number {
  if (!isFinite(value)) return value;
  if (CASH_OUTFLOW_METRICS.has(metric)) {
    return value > 0 ? -Math.abs(value) : value;
  }
  return value;
}

export function applyDerivedPeriodValues(
  values: Record<string, number>,
  sources?: Record<string, CanonicalFactSource>,
  ticker = 'UNKNOWN',
  period = '',
): void {
  const longTermDebt = finite(values['long_term_debt']);
  const shortTermDebt = finite(values['short_term_debt']);
  const totalDebt = finite(values['total_debt']);

  if (totalDebt === null && (longTermDebt !== null || shortTermDebt !== null)) {
    values['total_debt'] = (longTermDebt ?? 0) + (shortTermDebt ?? 0);
    if (sources) {
      sources['total_debt'] = {
        kind: 'derived',
        ticker,
        metric: 'total_debt',
        period,
        detail: 'Derived as long_term_debt + short_term_debt.',
      };
    }
  }

  const operatingCashFlow = finite(values['operating_cash_flow']);
  const capex = finite(values['capex']);
  if (operatingCashFlow !== null && capex !== null && values['free_cash_flow'] === undefined) {
    values['free_cash_flow'] = operatingCashFlow - Math.abs(capex);
    if (sources) {
      sources['free_cash_flow'] = {
        kind: 'derived',
        ticker,
        metric: 'free_cash_flow',
        period,
        detail: 'Derived as operating_cash_flow - abs(capex).',
      };
    }
  }
}

function ensureValueBucket(
  map: Map<string, Record<string, number>>,
  period: string,
): Record<string, number> {
  let bucket = map.get(period);
  if (!bucket) {
    bucket = {};
    map.set(period, bucket);
  }
  return bucket;
}

function ensureSourceBucket(
  map: Map<string, Record<string, CanonicalFactSource>>,
  period: string,
): Record<string, CanonicalFactSource> {
  let bucket = map.get(period);
  if (!bucket) {
    bucket = {};
    map.set(period, bucket);
  }
  return bucket;
}

function compareFiledDates(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function shouldReplaceExistingSource(
  existing: CanonicalFactSource | undefined,
  candidateForm: string | undefined,
  candidateFiled: string | undefined,
): boolean {
  if (!existing) return true;
  const existingIsAnnual = existing.form ? ANNUAL_FORMS.has(existing.form) : false;
  const candidateIsAnnual = candidateForm ? ANNUAL_FORMS.has(candidateForm) : false;
  if (candidateIsAnnual !== existingIsAnnual) return candidateIsAnnual;
  return compareFiledDates(candidateFiled, existing.filed) > 0;
}

const SHARE_SENSITIVE_METRICS = new Set([
  'shares_outstanding',
  'weighted_avg_shares_diluted',
  'weighted_avg_shares_basic',
  'eps_diluted',
  'eps_basic',
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function wordToNumber(value: string): number | null {
  const clean = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(clean)) return Number.parseInt(clean, 10);
  return NUMBER_WORDS[clean] ?? null;
}

function detectSplitFactor(rawText: string): number | null {
  if (!rawText) return null;
  const text = rawText.toLowerCase().replace(/\s+/g, ' ');
  const patterns = [
    /(\d+)\s*-\s*for\s*-\s*(\d+)\s+(?:forward\s+)?stock split/g,
    /(\d+)\s*for\s*(\d+)\s+(?:forward\s+)?stock split/g,
    /([a-z]+)\s*-\s*for\s*-\s*([a-z]+)\s+(?:forward\s+)?stock split/g,
    /([a-z]+)\s*for\s*([a-z]+)\s+(?:forward\s+)?stock split/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const numerator = wordToNumber(match[1] || '');
    const denominator = wordToNumber(match[2] || '');
    if (numerator && denominator && denominator > 0) {
      const factor = numerator / denominator;
      if (factor > 1) return factor;
    }
  }
  return null;
}

function determineSplitAdjustmentPeriods(
  values: Map<string, Record<string, number>>,
  splitFactor: number,
): Set<string> {
  const periods = Array.from(values.keys()).sort((a, b) => b.localeCompare(a));
  const weightedSeries = periods
    .map(period => ({ period, value: finite(values.get(period)?.['weighted_avg_shares_diluted']) }))
    .filter((entry): entry is { period: string; value: number } => entry.value !== null);
  const splitPeriods = new Set<string>();
  for (let i = 1; i < weightedSeries.length; i++) {
    const newer = weightedSeries[i - 1]!;
    const older = weightedSeries[i]!;
    const adjustedOlder = older.value * splitFactor;
    const relativeGap = Math.abs(adjustedOlder - newer.value) / Math.max(Math.abs(newer.value), Math.abs(adjustedOlder), 1);
    if (relativeGap <= 0.25) {
      for (let j = i; j < weightedSeries.length; j++) {
        splitPeriods.add(weightedSeries[j]!.period);
      }
      break;
    }
  }
  return splitPeriods;
}

function applySplitAdjustedHistoricalValues(
  context: AnalysisContext,
  ticker: string,
  values: Map<string, Record<string, number>>,
  sources: Map<string, Record<string, CanonicalFactSource>>,
): void {
  const rawText = context.filing_content[ticker]?.raw_text || '';
  const splitFactor = detectSplitFactor(rawText);
  if (!splitFactor || splitFactor <= 1) return;

  const targetPeriods = determineSplitAdjustmentPeriods(values, splitFactor);
  if (targetPeriods.size === 0) return;

  for (const period of targetPeriods) {
    const bucket = values.get(period);
    const sourceBucket = sources.get(period);
    if (!bucket || !sourceBucket) continue;

    for (const metric of SHARE_SENSITIVE_METRICS) {
      const current = finite(bucket[metric]);
      const source = sourceBucket[metric];
      if (current === null || !source || source.kind === 'adjusted') continue;

      const adjustedValue = metric.startsWith('eps_')
        ? current / splitFactor
        : current * splitFactor;

      bucket[metric] = adjustedValue;
      sourceBucket[metric] = {
        ...source,
        kind: 'adjusted',
        reportedValue: current,
        detail: `Adjusted by ${splitFactor}:1 stock split factor disclosed in the aligned annual filing.`,
      };
    }
  }
}

/**
 * Build canonical annual values + source references for one ticker.
 *
 * Priority:
 * 1) XBRL company facts (has provenance receipts)
 * 2) Statement extraction fallback for uncovered metrics
 * 3) Deterministic derived metrics (total_debt, free_cash_flow)
 */
export function buildCanonicalAnnualSeries(
  context: AnalysisContext,
  ticker: string,
): CanonicalAnnualSeries {
  const values = new Map<string, Record<string, number>>();
  const sources = new Map<string, Record<string, CanonicalFactSource>>();

  // 1) Facts first: richer provenance and safer tag-level traceability
  for (const fact of context.facts[ticker]?.facts || []) {
    for (const period of fact.periods) {
      if (!ANNUAL_FORMS.has(period.form)) continue;
      if (period.fiscal_period && period.fiscal_period !== 'FY') continue;
      if (!isFinite(period.value)) continue;
      const bucket = ensureValueBucket(values, period.period);
      const sourceBucket = ensureSourceBucket(sources, period.period);
      const candidateSource: CanonicalFactSource = {
        kind: 'xbrl',
        ticker,
        metric: fact.metric,
        period: period.period,
        form: period.form,
        filed: period.filed,
        provenance: period.provenance,
      };
      if (!shouldReplaceExistingSource(sourceBucket[fact.metric], period.form, period.filed)) continue;
      bucket[fact.metric] = normalizeMetricValue(fact.metric, period.value);
      sourceBucket[fact.metric] = candidateSource;
    }
  }

  // 2) Statement fallback fills gaps not present in facts
  for (const statement of context.statements[ticker] || []) {
    if (statement.period_type !== 'annual') continue;
    for (const period of statement.periods) {
      if (period.fiscal_period && period.fiscal_period !== 'FY') continue;
      const bucket = ensureValueBucket(values, period.period);
      const sourceBucket = ensureSourceBucket(sources, period.period);
      for (const [metric, rawValue] of Object.entries(period.data)) {
        if (!isFinite(rawValue)) continue;
        if (!shouldReplaceExistingSource(sourceBucket[metric], period.form, period.filed)) continue;
        bucket[metric] = normalizeMetricValue(metric, rawValue);
        sourceBucket[metric] = {
          kind: 'statement',
          ticker,
          metric,
          period: period.period,
          filed: period.filed,
          statementType: statement.statement_type,
          detail: 'Filled from deterministic statement extraction.',
        };
      }
    }
  }

  applySplitAdjustedHistoricalValues(context, ticker, values, sources);

  // 3) Add deterministic derived values + explicit derived source markers
  for (const [period, bucket] of values.entries()) {
    const sourceBucket = ensureSourceBucket(sources, period);
    applyDerivedPeriodValues(bucket, sourceBucket, ticker, period);
  }

  return { values, sources };
}

/**
 * Build a canonical annual period map for a ticker.
 * Priority:
 * 1) Company facts (with provenance)
 * 2) Structured statements fallback
 */
export function buildCanonicalAnnualPeriodMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, Record<string, number>> {
  return buildCanonicalAnnualSeries(context, ticker).values;
}

export function buildCanonicalAnnualSourceMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, Record<string, CanonicalFactSource>> {
  return buildCanonicalAnnualSeries(context, ticker).sources;
}

export function buildCanonicalAnnualPeriodMetadataMap(
  context: AnalysisContext,
  ticker: string,
): Map<string, CanonicalAnnualPeriodMetadata> {
  const metadata = new Map<string, CanonicalAnnualPeriodMetadata>();

  const ensure = (period: string): CanonicalAnnualPeriodMetadata => {
    let existing = metadata.get(period);
    if (!existing) {
      existing = {
        period,
        fiscalYear: yearFromPeriod(period),
        fiscalPeriod: 'FY',
        forms: [],
        sources: [],
      };
      metadata.set(period, existing);
    }
    return existing;
  };

  for (const fact of context.facts[ticker]?.facts || []) {
    for (const period of fact.periods) {
      if (!ANNUAL_FORMS.has(period.form)) continue;
      if (period.fiscal_period && period.fiscal_period !== 'FY') continue;
      const meta = ensure(period.period);
      if (period.fiscal_year !== undefined && period.fiscal_year !== null) {
        meta.fiscalYear = period.fiscal_year;
      }
      if (period.fiscal_period) {
        meta.fiscalPeriod = period.fiscal_period;
      }
      if (!meta.forms.includes(period.form)) meta.forms.push(period.form);
      if (!meta.sources.includes('facts')) meta.sources.push('facts');
    }
  }

  for (const statement of context.statements[ticker] || []) {
    if (statement.period_type !== 'annual') continue;
    for (const period of statement.periods) {
      const meta = ensure(period.period);
      if (!meta.sources.includes('statements')) meta.sources.push('statements');
    }
  }

  return metadata;
}

function yearFromPeriod(period: string): number | null {
  const match = period.match(/^(\d{4})-/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function corporateActionEvidence(rawText: string): boolean {
  if (!rawText) return false;
  const text = rawText.toLowerCase();
  return /reverse stock split|stock split|share split|split-adjusted|share issuance|issuance of common stock|equity offering|public offering|follow-on offering|at-the-market|atm program|convertible|conversion|merger|acquisition|warrant|exercise of warrants|exercise of options|preferred stock|exchange offer|recapitalization|share repurchase|repurchased|retired shares|retirement of shares/.test(text);
}

export function shareBasisDivergence(
  netIncome: number | null,
  epsDiluted: number | null,
  sharesOutstanding: number | null,
): number | null {
  if (netIncome === null || epsDiluted === null || sharesOutstanding === null) return null;
  if (!isFinite(netIncome) || !isFinite(epsDiluted) || !isFinite(sharesOutstanding) || epsDiluted === 0) {
    return null;
  }
  const impliedDilutedShares = netIncome / epsDiluted;
  if (!isFinite(impliedDilutedShares) || impliedDilutedShares <= 0 || sharesOutstanding <= 0) return null;
  return Math.abs(impliedDilutedShares - sharesOutstanding) / Math.max(impliedDilutedShares, sharesOutstanding);
}
