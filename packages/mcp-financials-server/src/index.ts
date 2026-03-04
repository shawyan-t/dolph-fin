#!/usr/bin/env node

/**
 * Dolph MCP Financials Server
 *
 * Provides LLMs with computed financial metrics and ratios.
 * Tools: get_financial_statements, calculate_ratios, get_trend_analysis, compare_companies
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { GetFinancialStatementsInput, getFinancialStatements } from './tools/get-financial-statements.js';
import { CalculateRatiosInput, calculateRatiosTool } from './tools/calculate-ratios.js';
import { GetTrendAnalysisInput, getTrendAnalysis } from './tools/get-trend-analysis.js';
import { CompareCompaniesInput, compareCompanies } from './tools/compare-companies.js';

const server = new McpServer({
  name: 'dolph-financials-server',
  version: '0.1.0',
});

// ── Tool: get_financial_statements ──────────────────────────────
server.tool(
  'get_financial_statements',
  'Get normalized financial statement data (income statement, balance sheet, or cash flow) for a stock ticker across multiple periods.',
  GetFinancialStatementsInput.shape,
  async (params) => {
    try {
      const statement = await getFinancialStatements(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(statement, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      };
    }
  },
);

// ── Tool: calculate_ratios ──────────────────────────────────────
server.tool(
  'calculate_ratios',
  'Compute financial ratios (P/E, ROE, debt-to-equity, margins, etc.) for a stock ticker. Returns the formula and component values so you can verify the math.',
  CalculateRatiosInput.shape,
  async (params) => {
    try {
      const result = await calculateRatiosTool(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      };
    }
  },
);

// ── Tool: get_trend_analysis ────────────────────────────────────
server.tool(
  'get_trend_analysis',
  'Analyze trends for specified financial metrics: year-over-year growth, CAGR, and anomaly detection (>2σ deviations).',
  GetTrendAnalysisInput.shape,
  async (params) => {
    try {
      const result = await getTrendAnalysis(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      };
    }
  },
);

// ── Tool: compare_companies ─────────────────────────────────────
server.tool(
  'compare_companies',
  'Compare financial metrics across multiple stock tickers. Returns a comparison matrix with rankings per metric.',
  CompareCompaniesInput.shape,
  async (params) => {
    try {
      const result = await compareCompanies(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        }],
        isError: true,
      };
    }
  },
);

// ── Start the server ──────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start MCP Financials server:', err);
  process.exit(1);
});
