#!/usr/bin/env node

/**
 * FilingLens MCP SEC Server
 *
 * Provides LLMs with structured access to SEC EDGAR data.
 * Tools: get_company_filings, get_filing_content, get_company_facts, search_filings
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { GetCompanyFilingsInput, getCompanyFilings } from './tools/get-company-filings.js';
import { GetFilingContentInput, getFilingContent } from './tools/get-filing-content.js';
import { GetCompanyFactsInput, getCompanyFacts } from './tools/get-company-facts.js';
import { SearchFilingsInput, searchFilings } from './tools/search-filings.js';

const server = new McpServer({
  name: 'filinglens-sec-server',
  version: '0.1.0',
});

// ── Tool: get_company_filings ──────────────────────────────────
server.tool(
  'get_company_filings',
  'Retrieve recent SEC filings (10-K, 10-Q, 8-K, DEF 14A) for a given stock ticker. Returns filing metadata with links to full documents.',
  GetCompanyFilingsInput.shape,
  async (params) => {
    try {
      const filings = await getCompanyFilings(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(filings, null, 2),
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

// ── Tool: get_filing_content ───────────────────────────────────
server.tool(
  'get_filing_content',
  'Fetch and parse the actual HTML content of an SEC filing. Extracts named sections (Business, Risk Factors, MD&A, etc.) from 10-K/10-Q filings.',
  GetFilingContentInput.shape,
  async (params) => {
    try {
      const content = await getFilingContent(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            sections: content.sections.map(s => ({
              title: s.title,
              content_preview: s.content.slice(0, 500) + '...',
              content_length: s.content.length,
            })),
            word_count: content.word_count,
          }, null, 2),
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

// ── Tool: get_company_facts ────────────────────────────────────
server.tool(
  'get_company_facts',
  'Retrieve structured XBRL financial data (revenue, net income, total assets, EPS, etc.) across multiple reporting periods for a stock ticker.',
  GetCompanyFactsInput.shape,
  async (params) => {
    try {
      const facts = await getCompanyFacts(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ticker: facts.ticker,
            cik: facts.cik,
            company_name: facts.company_name,
            metrics_available: facts.facts.length,
            facts: facts.facts.map(f => ({
              metric: f.metric,
              latest_value: f.periods[0]?.value,
              latest_period: f.periods[0]?.period,
              periods_available: f.periods.length,
            })),
          }, null, 2),
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

// ── Tool: search_filings ──────────────────────────────────────
server.tool(
  'search_filings',
  'Search SEC filings by keyword (e.g., "goodwill impairment", "AI strategy"). Optionally filter by ticker and date range.',
  SearchFilingsInput.shape,
  async (params) => {
    try {
      const results = await searchFilings(params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
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
  console.error('Failed to start MCP SEC server:', err);
  process.exit(1);
});
