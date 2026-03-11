import type {
  AnalysisContext,
  ExcludedIssuerSummary,
  FinancialStatement,
  IssuerSupportStatus,
} from '@shawyan/shared';
import { buildCanonicalAnnualPeriodMap, buildCanonicalAnnualSourceMap } from './report-facts.js';

const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);

function countAnnualStatementPeriods(
  statements: FinancialStatement[] | undefined,
  statementType: FinancialStatement['statement_type'],
): number {
  return (statements || [])
    .filter(statement => statement.statement_type === statementType && statement.period_type === 'annual')
    .flatMap(statement => statement.periods)
    .filter(period => !period.fiscal_period || period.fiscal_period === 'FY')
    .length;
}

function assessDebtReliability(context: AnalysisContext, ticker: string): IssuerSupportStatus['debt_reliability'] {
  const periods = buildCanonicalAnnualPeriodMap(context, ticker);
  const sources = buildCanonicalAnnualSourceMap(context, ticker);
  for (const bucket of sources.values()) {
    if (bucket['total_debt']?.kind === 'unknown' && /suppressed/i.test(bucket['total_debt']?.detail || '')) {
      return 'suppressed_conflict';
    }
  }
  for (const values of periods.values()) {
    const totalDebt = values['total_debt'];
    const longTermDebt = values['long_term_debt'];
    const shortTermDebt = values['short_term_debt'];
    if (
      totalDebt !== undefined
      && (
        (longTermDebt !== undefined && totalDebt + 1_000_000 < longTermDebt)
        || (shortTermDebt !== undefined && totalDebt + 1_000_000 < shortTermDebt)
      )
    ) {
      return 'suppressed_conflict';
    }
  }

  const hasDebtSignals = Array.from(periods.values()).some(values =>
    values['total_debt'] !== undefined
    || values['long_term_debt'] !== undefined
    || values['short_term_debt'] !== undefined,
  );
  return hasDebtSignals ? 'high_confidence' : 'insufficient_data';
}

function assessLiquidityReliability(context: AnalysisContext, ticker: string): IssuerSupportStatus['liquidity_reliability'] {
  const periods = buildCanonicalAnnualPeriodMap(context, ticker);
  const hasLiquiditySignals = Array.from(periods.values()).some(values =>
    values['cash_and_equivalents'] !== undefined
    || values['cash_and_equivalents_and_restricted_cash'] !== undefined
    || values['cash_ending'] !== undefined
    || values['current_assets'] !== undefined
    || values['current_liabilities'] !== undefined,
  );
  return hasLiquiditySignals ? 'high_confidence' : 'insufficient_data';
}

export function classifyIssuerSupport(
  context: AnalysisContext,
  ticker: string,
): IssuerSupportStatus {
  const factsCount = context.facts[ticker]?.facts?.length || 0;
  const filings = context.filings[ticker] || [];
  const annualFilingsCount = filings.filter(filing => ANNUAL_FORMS.has(filing.filing_type)).length;
  const statementPeriods = {
    income: countAnnualStatementPeriods(context.statements[ticker], 'income'),
    balance_sheet: countAnnualStatementPeriods(context.statements[ticker], 'balance_sheet'),
    cash_flow: countAnnualStatementPeriods(context.statements[ticker], 'cash_flow'),
  };

  const hasFullAnnualCoverage = factsCount > 0
    && statementPeriods.income > 0
    && statementPeriods.balance_sheet > 0
    && statementPeriods.cash_flow > 0;
  const hasAnyCoverage = annualFilingsCount > 0
    || filings.length > 0
    || factsCount > 0
    || statementPeriods.income > 0
    || statementPeriods.balance_sheet > 0
    || statementPeriods.cash_flow > 0;

  const coverage = hasFullAnnualCoverage
    ? 'full_annual'
    : hasAnyCoverage
      ? 'partial_filing'
      : 'unsupported';

  const reason = hasFullAnnualCoverage
    ? 'Usable annual facts and annual statements are available for full financial reconstruction.'
    : hasAnyCoverage
      ? `Recent filing information exists, but the current SEC/XBRL path did not produce a usable annual dataset (facts=${factsCount}, income=${statementPeriods.income}, balance sheet=${statementPeriods.balance_sheet}, cash flow=${statementPeriods.cash_flow}).`
      : 'No usable annual filing or XBRL dataset is available for this issuer through the current SEC path.';

  return {
    ticker,
    coverage,
    reason,
    facts_count: factsCount,
    annual_filings_count: annualFilingsCount,
    annual_statement_periods: statementPeriods,
    debt_reliability: assessDebtReliability(context, ticker),
    liquidity_reliability: assessLiquidityReliability(context, ticker),
    safe_for_standalone: coverage === 'full_annual',
    safe_for_comparison: coverage === 'full_annual',
  };
}

export function classifyAllIssuerSupport(context: AnalysisContext): Record<string, IssuerSupportStatus> {
  return Object.fromEntries(
    context.tickers.map(ticker => [ticker, classifyIssuerSupport(context, ticker)]),
  );
}

export function summarizeExcludedIssuers(
  issuerSupport: Record<string, IssuerSupportStatus>,
  requestedTickers: string[],
  supportedTickers: string[],
): ExcludedIssuerSummary[] {
  const supported = new Set(supportedTickers);
  return requestedTickers
    .filter(ticker => !supported.has(ticker))
    .map(ticker => ({
      ticker,
      coverage: issuerSupport[ticker]?.coverage || 'unsupported',
      reason: issuerSupport[ticker]?.reason || 'Annual financial reconstruction is not available for this issuer.',
    }));
}
