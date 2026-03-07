/**
 * DETERMINISTIC planner — no LLM call needed.
 *
 * The tools required for each analysis type are always the same.
 * This is a lookup table, not a creative decision.
 */

import type { AgentPlan, AgentStep, ReportingPolicy } from '@dolph/shared';

const DEFAULT_TREND_METRICS = [
  'revenue', 'net_income', 'operating_income', 'gross_profit',
  'total_assets', 'total_liabilities', 'stockholders_equity',
  'operating_cash_flow', 'capex',
];

/**
 * Generate a deterministic execution plan based on analysis type.
 * Zero LLM calls.
 */
export function createPlan(
  tickers: string[],
  type: 'single' | 'comparison',
  policy?: ReportingPolicy,
): AgentPlan {
  if (type === 'single') {
    return createSinglePlan(tickers[0]!, policy);
  }
  return createComparisonPlan(tickers, policy);
}

function createSinglePlan(ticker: string, policy?: ReportingPolicy): AgentPlan {
  const statementLimit = policy?.statementHistoryPeriods ?? 5;
  const trendPeriods = policy?.trendHistoryPeriods ?? 10;
  const steps: AgentStep[] = [
    {
      tool: 'get_company_filings',
      params: { ticker, limit: 15 },
      purpose: `Get recent filings for ${ticker}`,
    },
    {
      tool: 'get_company_facts',
      params: { ticker },
      purpose: `Get XBRL financial facts for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'income', period: 'annual', limit: statementLimit },
      purpose: `Get income statement for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'balance_sheet', period: 'annual', limit: statementLimit },
      purpose: `Get balance sheet for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'cash_flow', period: 'annual', limit: statementLimit },
      purpose: `Get cash flow statement for ${ticker}`,
    },
    {
      tool: 'calculate_ratios',
      params: { ticker },
      purpose: `Compute financial ratios for ${ticker}`,
    },
    {
      tool: 'get_trend_analysis',
      params: { ticker, metrics: DEFAULT_TREND_METRICS, periods: trendPeriods },
      purpose: `Analyze metric trends for ${ticker}`,
    },
  ];

  return {
    type: 'single',
    tickers: [ticker],
    steps,
  };
}

function createComparisonPlan(tickers: string[], policy?: ReportingPolicy): AgentPlan {
  const statementLimit = policy?.statementHistoryPeriods ?? 5;
  const trendPeriods = policy?.trendHistoryPeriods ?? 10;
  const steps: AgentStep[] = [];

  // Get filings, facts, statements, ratios, and trends for each ticker
  for (const ticker of tickers) {
    steps.push(
      {
        tool: 'get_company_filings',
        params: { ticker, limit: 15 },
        purpose: `Get recent filings for ${ticker}`,
      },
      {
        tool: 'get_company_facts',
        params: { ticker },
        purpose: `Get XBRL financial facts for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'income', period: 'annual', limit: statementLimit },
        purpose: `Get income statement for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'balance_sheet', period: 'annual', limit: statementLimit },
        purpose: `Get balance sheet for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'cash_flow', period: 'annual', limit: statementLimit },
        purpose: `Get cash flow statement for ${ticker}`,
      },
      {
        tool: 'calculate_ratios',
        params: { ticker },
        purpose: `Compute financial ratios for ${ticker}`,
      },
      {
        tool: 'get_trend_analysis',
        params: { ticker, metrics: DEFAULT_TREND_METRICS, periods: trendPeriods },
        purpose: `Analyze trends for ${ticker}`,
      },
    );
  }

  return {
    type: 'comparison',
    tickers,
    steps,
  };
}
