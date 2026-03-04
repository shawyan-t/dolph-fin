/**
 * Executor — calls MCP tool implementations directly and aggregates results.
 * No LLM calls.
 */

import type {
  AgentPlan,
  StepResult,
  AnalysisContext,
  Filing,
  CompanyFacts,
  FilingContent,
  FinancialStatement,
  Ratio,
  TrendData,
  CompanyComparison,
} from '@dolph/shared';

// Direct imports of tool implementations (no MCP protocol overhead)
import { getCompanyFilings } from '@dolph/mcp-sec-server/tools/get-company-filings.js';
import { getCompanyFacts } from '@dolph/mcp-sec-server/tools/get-company-facts.js';
import { getFilingContent } from '@dolph/mcp-sec-server/tools/get-filing-content.js';
import { searchFilings } from '@dolph/mcp-sec-server/tools/search-filings.js';
import { getFinancialStatements } from '@dolph/mcp-financials-server/tools/get-financial-statements.js';
import { calculateRatiosTool } from '@dolph/mcp-financials-server/tools/calculate-ratios.js';
import { getTrendAnalysis } from '@dolph/mcp-financials-server/tools/get-trend-analysis.js';
import { compareCompanies } from '@dolph/mcp-financials-server/tools/compare-companies.js';

import type { PipelineCallbacks } from './types.js';

/** Hard timeout per tool call (45 seconds) */
const TOOL_TIMEOUT_MS = 45_000;

function withToolTimeout<T>(promise: Promise<T>, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`)),
      TOOL_TIMEOUT_MS,
    );
    promise
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

const TOOL_MAP: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  get_company_filings: (p) => getCompanyFilings(p as Parameters<typeof getCompanyFilings>[0]),
  get_company_facts: (p) => getCompanyFacts(p as Parameters<typeof getCompanyFacts>[0]),
  get_filing_content: (p) => getFilingContent(p as Parameters<typeof getFilingContent>[0]),
  search_filings: (p) => searchFilings(p as Parameters<typeof searchFilings>[0]),
  get_financial_statements: (p) => getFinancialStatements(p as Parameters<typeof getFinancialStatements>[0]),
  calculate_ratios: (p) => calculateRatiosTool(p as Parameters<typeof calculateRatiosTool>[0]),
  get_trend_analysis: (p) => getTrendAnalysis(p as Parameters<typeof getTrendAnalysis>[0]),
  compare_companies: (p) => compareCompanies(p as Parameters<typeof compareCompanies>[0]),
};

/**
 * Execute the plan by calling each tool and aggregating results.
 */
export async function executePlan(
  plan: AgentPlan,
  maxRetries: number,
  callbacks?: PipelineCallbacks,
): Promise<AnalysisContext> {
  const context: AnalysisContext = {
    tickers: plan.tickers,
    type: plan.type,
    plan,
    results: [],
    filings: {},
    filing_content: {},
    facts: {},
    statements: {},
    ratios: {},
    trends: {},
  };

  for (const step of plan.steps) {
    callbacks?.onStep?.(step.purpose, 'running');
    const startTime = Date.now();

    let result: StepResult;

    try {
      // Special case: get_filing_content needs dynamic params from filings results
      let params = { ...step.params };
      if (step.tool === 'get_filing_content') {
        const ticker = params['ticker'] as string;
        const filings = context.filings[ticker];
        if (filings && filings.length > 0) {
          const latestFiling = filings[0]!;
          params = {
            accession_number: latestFiling.accession_number,
            document_url: latestFiling.primary_document_url,
          };
        } else {
          // Skip if no filings available
          result = {
            tool: step.tool,
            success: false,
            data: null,
            error: `No filings available for ${ticker}`,
            duration_ms: Date.now() - startTime,
          };
          context.results.push(result);
          callbacks?.onStep?.(step.purpose, 'error', result.error);
          continue;
        }
      }

      const toolFn = TOOL_MAP[step.tool];
      if (!toolFn) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }

      // Retry logic
      let data: unknown = null;
      let lastError: string | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          data = await withToolTimeout(toolFn(params), step.tool);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }

      if (lastError) {
        result = {
          tool: step.tool,
          success: false,
          data: null,
          error: lastError,
          duration_ms: Date.now() - startTime,
        };
      } else {
        result = {
          tool: step.tool,
          success: true,
          data,
          duration_ms: Date.now() - startTime,
        };

        // Store in context by type
        aggregateResult(context, step, data);
      }
    } catch (err) {
      result = {
        tool: step.tool,
        success: false,
        data: null,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      };
    }

    context.results.push(result);
    callbacks?.onStep?.(step.purpose, result.success ? 'complete' : 'error', result.error);
  }

  return context;
}

/**
 * Route tool results to the appropriate context fields.
 */
function aggregateResult(
  context: AnalysisContext,
  step: { tool: string; params: Record<string, unknown> },
  data: unknown,
): void {
  const ticker = (step.params['ticker'] as string || '').toUpperCase();

  switch (step.tool) {
    case 'get_company_filings': {
      const allFilings = data as Filing[];
      // Prioritize annual filings (10-K for domestic, 20-F/40-F for foreign filers)
      const annualTypes = new Set(['10-K', '20-F', '40-F']);
      const annualFilings = allFilings.filter(f => annualTypes.has(f.filing_type));
      // Use annual filings if available, otherwise keep all
      context.filings[ticker] = annualFilings.length > 0 ? annualFilings : allFilings;
      break;
    }

    case 'get_company_facts':
      context.facts[ticker] = data as CompanyFacts;
      break;

    case 'get_filing_content':
      context.filing_content[ticker] = data as FilingContent;
      break;

    case 'get_financial_statements': {
      if (!context.statements[ticker]) context.statements[ticker] = [];
      context.statements[ticker].push(data as FinancialStatement);
      break;
    }

    case 'calculate_ratios': {
      const ratioResult = data as { ticker: string; ratios: Ratio[] };
      context.ratios[ratioResult.ticker] = ratioResult.ratios;
      break;
    }

    case 'get_trend_analysis': {
      const trendResult = data as { ticker: string; trends: TrendData[] };
      context.trends[trendResult.ticker] = trendResult.trends;
      break;
    }

    case 'compare_companies':
      context.comparison = data as CompanyComparison;
      break;
  }
}
