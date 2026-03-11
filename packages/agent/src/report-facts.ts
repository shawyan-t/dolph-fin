import { getMappingByName, type AnalysisContext, type FinancialStatement, type ProvenanceReceipt } from '@shawyan/shared';

const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);

const CASH_OUTFLOW_METRICS = new Set([
  'capex',
  'capital_expenditures',
  'dividends_paid',
  'share_repurchases',
  'debt_repayment',
]);

export const SHARE_CHANGE_ALERT_THRESHOLD = 1.5;

export const BALANCE_SHEET_CASH_FAMILY_METRICS = [
  'cash_and_equivalents',
  'cash_and_equivalents_and_restricted_cash',
  'restricted_cash',
  'cash_and_equivalents_and_short_term_investments',
  'short_term_investments',
  'marketable_securities',
] as const;

export type BalanceSheetCashFamilyMetric = typeof BALANCE_SHEET_CASH_FAMILY_METRICS[number];

const CASH_FAMILY_BROADER_ALTERNATIVES: Record<BalanceSheetCashFamilyMetric, BalanceSheetCashFamilyMetric[]> = {
  cash_and_equivalents: [
    'cash_and_equivalents_and_restricted_cash',
    'cash_and_equivalents_and_short_term_investments',
  ],
  cash_and_equivalents_and_restricted_cash: [],
  restricted_cash: [
    'cash_and_equivalents_and_restricted_cash',
  ],
  cash_and_equivalents_and_short_term_investments: [],
  short_term_investments: [
    'cash_and_equivalents_and_short_term_investments',
  ],
  marketable_securities: [],
};

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
  reportedLabel?: string;
  reportedUnit?: string;
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

export function hasCashFamilyValue(
  values: Record<string, number> | undefined,
  metric: BalanceSheetCashFamilyMetric,
): boolean {
  const raw = values?.[metric];
  return raw !== undefined && isFinite(raw);
}

export function hasBroaderCashFamilyAlternative(
  values: Record<string, number> | undefined,
  metric: string,
): boolean {
  if (!BALANCE_SHEET_CASH_FAMILY_METRICS.includes(metric as BalanceSheetCashFamilyMetric)) return false;
  const alternatives = CASH_FAMILY_BROADER_ALTERNATIVES[metric as BalanceSheetCashFamilyMetric] || [];
  return alternatives.some(candidate => hasCashFamilyValue(values, candidate));
}

export function hasCashPresentationAlternative(
  values: Record<string, number> | undefined,
  metric: string,
): boolean {
  if (hasBroaderCashFamilyAlternative(values, metric)) return true;
  if (metric !== 'cash_and_equivalents') return false;
  const endingCash = values?.['cash_ending'];
  if (endingCash === undefined || !isFinite(endingCash)) return false;
  return presentCashFamilyMetrics(values).length === 0;
}

export function presentCashFamilyMetrics(
  values: Record<string, number> | undefined,
): BalanceSheetCashFamilyMetric[] {
  return BALANCE_SHEET_CASH_FAMILY_METRICS.filter(metric => hasCashFamilyValue(values, metric));
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
  const conflictingComponent = totalDebt !== null
    && (
      (longTermDebt !== null && materiallyDiffers(totalDebt, Math.max(totalDebt, longTermDebt), 0.02, 1_000_000) && totalDebt < longTermDebt)
      || (shortTermDebt !== null && materiallyDiffers(totalDebt, Math.max(totalDebt, shortTermDebt), 0.02, 1_000_000) && totalDebt < shortTermDebt)
    );

  if (longTermDebt !== null && shortTermDebt !== null) {
    const standardizedTotalDebt = longTermDebt + shortTermDebt;
    if (totalDebt === null || materiallyDiffers(totalDebt, standardizedTotalDebt, 0.02, 1_000_000)) {
      values['total_debt'] = standardizedTotalDebt;
      if (sources) {
        sources['total_debt'] = {
          kind: 'derived',
          ticker,
          metric: 'total_debt',
          period,
          reportedLabel: 'Total Debt',
          reportedUnit: 'USD',
          reportedValue: totalDebt ?? undefined,
          detail: totalDebt === null
            ? 'Derived as long_term_debt + short_term_debt because both debt components were reported.'
            : 'Standardized as long_term_debt + short_term_debt because the reported total debt concept did not reconcile to the reported debt components.',
        };
      }
    }
  } else if (conflictingComponent) {
    delete values['total_debt'];
    if (sources) {
      sources['total_debt'] = {
        kind: 'unknown',
        ticker,
        metric: 'total_debt',
        period,
        reportedLabel: 'Total Debt',
        reportedUnit: 'USD',
        reportedValue: totalDebt ?? undefined,
        detail: 'Suppressed because the reported total debt concept was lower than a reported debt component and could not be reconciled from the available component set.',
      };
    }
  } else if (totalDebt === null && (longTermDebt !== null || shortTermDebt !== null)) {
    // Derive total_debt from whichever component(s) are available.
    const derivedDebt = (longTermDebt ?? 0) + (shortTermDebt ?? 0);
    values['total_debt'] = derivedDebt;
    if (sources) {
      const parts: string[] = [];
      if (longTermDebt !== null) parts.push('long_term_debt');
      if (shortTermDebt !== null) parts.push('short_term_debt');
      sources['total_debt'] = {
        kind: 'derived',
        ticker,
        metric: 'total_debt',
        period,
        reportedLabel: 'Total Debt',
        reportedUnit: 'USD',
        detail: `Derived from ${parts.join(' + ')} only; the other debt component was not reported.`,
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
        reportedLabel: 'Free Cash Flow',
        reportedUnit: 'USD',
        detail: 'Derived as operating_cash_flow - abs(capex).',
      };
    }
  }

  // Derive gross_profit when not directly reported
  const revenue = finite(values['revenue']);
  const costOfRevenue = finite(values['cost_of_revenue']);
  const existingGrossProfit = finite(values['gross_profit']);
  const operatingIncome = finite(values['operating_income']);
  if (
    revenue !== null
    && costOfRevenue !== null
    && existingGrossProfit !== null
    && operatingIncome !== null
    && existingGrossProfit < operatingIncome
  ) {
    const recomputedGrossProfit = revenue - costOfRevenue;
    if (
      isFinite(recomputedGrossProfit)
      && recomputedGrossProfit >= operatingIncome
      && recomputedGrossProfit <= Math.max(revenue, operatingIncome)
    ) {
      values['gross_profit'] = recomputedGrossProfit;
      if (sources) {
        sources['gross_profit'] = {
          kind: 'adjusted',
          ticker,
          metric: 'gross_profit',
          period,
          reportedLabel: 'Gross Profit',
          reportedUnit: 'USD',
          reportedValue: existingGrossProfit,
          detail: 'Recomputed as revenue - cost_of_revenue because the reported gross_profit concept failed the operating-income sanity check.',
        };
      }
    }
  }

  if (revenue !== null && costOfRevenue !== null && values['gross_profit'] === undefined) {
    values['gross_profit'] = revenue - costOfRevenue;
    if (sources) {
      sources['gross_profit'] = {
        kind: 'derived',
        ticker,
        metric: 'gross_profit',
        period,
        reportedLabel: 'Gross Profit',
        reportedUnit: 'USD',
        detail: 'Derived as revenue - cost_of_revenue.',
      };
    }
  }

  // Derive working_capital when not directly reported
  const currentAssets = finite(values['current_assets']);
  const currentLiabilities = finite(values['current_liabilities']);
  if (currentAssets !== null && currentLiabilities !== null && values['working_capital'] === undefined) {
    values['working_capital'] = currentAssets - currentLiabilities;
    if (sources) {
      sources['working_capital'] = {
        kind: 'derived',
        ticker,
        metric: 'working_capital',
        period,
        reportedLabel: 'Working Capital',
        reportedUnit: 'USD',
        detail: 'Derived as current_assets - current_liabilities.',
      };
    }
  }

  // Pretax income sign correction: fix sign inversion from loss-variant XBRL tags
  const netIncome = finite(values['net_income']);
  const incomeTaxExpense = finite(values['income_tax_expense']);
  const reportedPretax = finite(values['pretax_income']);
  if (netIncome !== null && incomeTaxExpense !== null && reportedPretax !== null) {
    const expectedPretax = netIncome + incomeTaxExpense;
    if (
      Math.sign(reportedPretax) !== Math.sign(expectedPretax)
      && expectedPretax !== 0
      && Math.abs(Math.abs(reportedPretax) - Math.abs(expectedPretax)) <= Math.max(Math.abs(expectedPretax) * 0.05, 1_000_000)
    ) {
      values['pretax_income'] = expectedPretax;
      if (sources) {
        sources['pretax_income'] = {
          kind: 'derived',
          ticker,
          metric: 'pretax_income',
          period,
          reportedLabel: 'Pretax Income',
          reportedUnit: 'USD',
          reportedValue: reportedPretax,
          detail: `Sign-corrected pretax_income from ${reportedPretax} to ${expectedPretax} (net_income + income_tax_expense).`,
        };
      }
    }
  }

  // Derive eps_diluted when not directly reported
  if (netIncome !== null && values['eps_diluted'] === undefined) {
    const shareBasis = finite(values['weighted_avg_shares_diluted']) ?? finite(values['shares_outstanding']);
    const usedWeighted = finite(values['weighted_avg_shares_diluted']) !== null;
    if (shareBasis !== null && shareBasis !== 0) {
      values['eps_diluted'] = netIncome / shareBasis;
      if (sources) {
        sources['eps_diluted'] = {
          kind: 'derived',
          ticker,
          metric: 'eps_diluted',
          period,
          reportedLabel: 'EPS (Diluted)',
          reportedUnit: 'USD/shares',
          detail: usedWeighted
            ? 'Derived as net_income / weighted_avg_shares_diluted.'
            : 'Derived as net_income / shares_outstanding (weighted average shares not reported).',
        };
      }
    }
  }

  // Derive eps_basic when not directly reported
  if (netIncome !== null && values['eps_basic'] === undefined) {
    const basicShares = finite(values['weighted_avg_shares_basic']) ?? finite(values['shares_outstanding']);
    if (basicShares !== null && basicShares !== 0) {
      values['eps_basic'] = netIncome / basicShares;
      if (sources) {
        sources['eps_basic'] = {
          kind: 'derived',
          ticker,
          metric: 'eps_basic',
          period,
          reportedLabel: 'EPS (Basic)',
          reportedUnit: 'USD/shares',
          detail: finite(values['weighted_avg_shares_basic']) !== null
            ? 'Derived as net_income / weighted_avg_shares_basic.'
            : 'Derived as net_income / shares_outstanding (weighted average basic shares not reported).',
        };
      }
    }
  }

  // Derive pretax_income when not directly reported but net_income + tax exist
  if (netIncome !== null && incomeTaxExpense !== null && values['pretax_income'] === undefined) {
    values['pretax_income'] = netIncome + incomeTaxExpense;
    if (sources) {
      sources['pretax_income'] = {
        kind: 'derived',
        ticker,
        metric: 'pretax_income',
        period,
        reportedLabel: 'Pretax Income',
        reportedUnit: 'USD',
        detail: 'Derived as net_income + income_tax_expense.',
      };
    }
  }

  // Derive cash_and_equivalents_and_restricted_cash from components
  const cashEquiv = finite(values['cash_and_equivalents']);
  const restrictedCash = finite(values['restricted_cash']);
  if (
    cashEquiv !== null
    && restrictedCash !== null
    && values['cash_and_equivalents_and_restricted_cash'] === undefined
  ) {
    values['cash_and_equivalents_and_restricted_cash'] = cashEquiv + restrictedCash;
    if (sources) {
      sources['cash_and_equivalents_and_restricted_cash'] = {
        kind: 'derived',
        ticker,
        metric: 'cash_and_equivalents_and_restricted_cash',
        period,
        reportedLabel: 'Cash, Cash Equivalents & Restricted Cash',
        reportedUnit: 'USD',
        detail: 'Derived as cash_and_equivalents + restricted_cash.',
      };
    }
  }

  const shortTermInvestments = finite(values['short_term_investments']);
  if (
    cashEquiv !== null
    && shortTermInvestments !== null
    && values['cash_and_equivalents_and_short_term_investments'] === undefined
  ) {
    values['cash_and_equivalents_and_short_term_investments'] = cashEquiv + shortTermInvestments;
    if (sources) {
      sources['cash_and_equivalents_and_short_term_investments'] = {
        kind: 'derived',
        ticker,
        metric: 'cash_and_equivalents_and_short_term_investments',
        period,
        reportedLabel: 'Cash, Cash Equivalents & Short-Term Investments',
        reportedUnit: 'USD',
        detail: 'Derived as cash_and_equivalents + short_term_investments.',
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
        reportedValue: period.value,
        reportedLabel: fact.label,
        reportedUnit: period.unit,
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
          reportedValue: rawValue,
          reportedLabel: getMappingByName(metric)?.displayName || metric,
          reportedUnit: getMappingByName(metric)?.unit || 'USD',
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
