/**
 * DETERMINISTIC planner — no LLM call needed.
 *
 * The tools required for each analysis type are always the same.
 * This is a lookup table, not a creative decision.
 */

import type { AgentPlan, AgentStep } from '@filinglens/shared';

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
): AgentPlan {
  if (type === 'single') {
    return createSinglePlan(tickers[0]!);
  }
  return createComparisonPlan(tickers);
}

function createSinglePlan(ticker: string): AgentPlan {
  const steps: AgentStep[] = [
    {
      tool: 'get_company_filings',
      params: { ticker, filing_type: '10-K', limit: 5 },
      purpose: `Get recent 10-K filings for ${ticker}`,
    },
    {
      tool: 'get_company_facts',
      params: { ticker },
      purpose: `Get XBRL financial facts for ${ticker}`,
    },
    {
      tool: 'get_filing_content',
      params: { ticker }, // accession_number and document_url filled at runtime
      purpose: `Parse most recent 10-K for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'income', period: 'annual', limit: 5 },
      purpose: `Get income statement for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'balance_sheet', period: 'annual', limit: 5 },
      purpose: `Get balance sheet for ${ticker}`,
    },
    {
      tool: 'get_financial_statements',
      params: { ticker, statement: 'cash_flow', period: 'annual', limit: 5 },
      purpose: `Get cash flow statement for ${ticker}`,
    },
    {
      tool: 'calculate_ratios',
      params: { ticker },
      purpose: `Compute financial ratios for ${ticker}`,
    },
    {
      tool: 'get_trend_analysis',
      params: { ticker, metrics: DEFAULT_TREND_METRICS, periods: 10 },
      purpose: `Analyze metric trends for ${ticker}`,
    },
  ];

  return {
    type: 'single',
    tickers: [ticker],
    steps,
  };
}

function createComparisonPlan(tickers: string[]): AgentPlan {
  const steps: AgentStep[] = [];

  // Get facts and ratios for each ticker
  for (const ticker of tickers) {
    steps.push(
      {
        tool: 'get_company_facts',
        params: { ticker },
        purpose: `Get XBRL financial facts for ${ticker}`,
      },
      {
        tool: 'calculate_ratios',
        params: { ticker },
        purpose: `Compute financial ratios for ${ticker}`,
      },
      {
        tool: 'get_trend_analysis',
        params: { ticker, metrics: DEFAULT_TREND_METRICS, periods: 5 },
        purpose: `Analyze trends for ${ticker}`,
      },
    );
  }

  // Compare across all tickers
  steps.push({
    tool: 'compare_companies',
    params: {
      tickers,
      metrics: [
        'revenue', 'net_income', 'total_assets', 'stockholders_equity',
        'operating_cash_flow', 'gross_profit', 'operating_income',
      ],
    },
    purpose: `Compare ${tickers.join(', ')} across key metrics`,
  });

  return {
    type: 'comparison',
    tickers,
    steps,
  };
}
