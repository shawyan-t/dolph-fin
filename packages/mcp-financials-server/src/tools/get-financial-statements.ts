/**
 * Tool: get_financial_statements
 * Returns normalized financial statement data from XBRL.
 */

import { z } from 'zod';
import type { FinancialStatement } from '@dolph/shared';
import { getCompanyFacts } from '@dolph/mcp-sec-server/tools/get-company-facts.js';
import { normalizeToStatements } from '../xbrl/normalizer.js';

export const GetFinancialStatementsInput = z.object({
  ticker: z.string().min(1).max(10),
  statement: z.enum(['income', 'balance_sheet', 'cash_flow']),
  period: z.enum(['annual', 'quarterly']).optional().default('annual'),
  limit: z.number().min(1).max(20).optional().default(5),
});

export type GetFinancialStatementsParams = z.infer<typeof GetFinancialStatementsInput>;

export async function getFinancialStatements(
  params: GetFinancialStatementsParams,
): Promise<FinancialStatement> {
  const { ticker, statement, period, limit } = params;

  // Get raw XBRL facts
  const facts = await getCompanyFacts({ ticker });

  // Normalize to structured statement
  return normalizeToStatements(facts, statement, period, limit);
}
