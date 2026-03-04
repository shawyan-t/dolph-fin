/**
 * DETERMINISTIC planner — no LLM call needed.
 *
 * The tools required for each analysis type are always the same.
 * This is a lookup table, not a creative decision.
 *
 * Note: We request annual filings without specifying 10-K or 20-F,
 * allowing the executor to handle both domestic and foreign filers.
 */

import type { AgentPlan, AgentStep } from '@dolph/shared';

const DEFAULT_TREND_METRICS = [
  'revenue', 'net_income', 'operating_income', 'gross_profit',
  'total_assets', 'total_liabilities', 'stockholders_equity',
  'operating_cash_flow', 'capex',
];

/**
 * Annual filing types — domestic companies file 10-K, foreign filers file 20-F or 40-F.
 * We try them in order of most common.
 */
export const ANNUAL_FILING_TYPES = ['10-K', '20-F', '40-F'] as const;

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
      // Don't specify filing_type — let the executor find annual filings (10-K or 20-F)
      params: { ticker, limit: 10 },
      purpose: `Get recent annual filings for ${ticker}`,
    },
    {
      tool: 'get_company_facts',
      params: { ticker },
      purpose: `Get XBRL financial facts for ${ticker}`,
    },
    {
      tool: 'get_filing_content',
      params: { ticker }, // accession_number and document_url filled at runtime
      purpose: `Parse most recent annual filing for ${ticker}`,
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

  // Get filings, facts, statements, ratios, and trends for each ticker
  for (const ticker of tickers) {
    steps.push(
      {
        tool: 'get_company_filings',
        params: { ticker, limit: 5 },
        purpose: `Get recent annual filings for ${ticker}`,
      },
      {
        tool: 'get_company_facts',
        params: { ticker },
        purpose: `Get XBRL financial facts for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'income', period: 'annual', limit: 3 },
        purpose: `Get income statement for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'balance_sheet', period: 'annual', limit: 3 },
        purpose: `Get balance sheet for ${ticker}`,
      },
      {
        tool: 'get_financial_statements',
        params: { ticker, statement: 'cash_flow', period: 'annual', limit: 3 },
        purpose: `Get cash flow statement for ${ticker}`,
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
