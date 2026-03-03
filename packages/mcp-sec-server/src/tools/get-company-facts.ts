/**
 * Tool: get_company_facts
 * Retrieves structured financial data via XBRL Company Facts API.
 */

import { z } from 'zod';
import type { CompanyFacts, FinancialFact } from '@filinglens/shared';
import {
  SEC_XBRL_COMPANY_FACTS_URL,
  CACHE_TTL_COMPANY_FACTS,
  XBRL_MAPPINGS,
} from '@filinglens/shared';
import { resolveCik, getCompanyName } from '../edgar/cik-lookup.js';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';

export const GetCompanyFactsInput = z.object({
  ticker: z.string().min(1).max(10),
});

export type GetCompanyFactsParams = z.infer<typeof GetCompanyFactsInput>;

interface XBRLFactEntry {
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
}

interface XBRLFactUnit {
  [unit: string]: XBRLFactEntry[];
}

interface XBRLFact {
  label: string;
  description: string;
  units: XBRLFactUnit;
}

interface XBRLCompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    'us-gaap'?: Record<string, XBRLFact>;
    dei?: Record<string, XBRLFact>;
  };
}

export async function getCompanyFacts(params: GetCompanyFactsParams): Promise<CompanyFacts> {
  const { ticker } = params;
  const cik = await resolveCik(ticker);
  const cacheKey = ticker.toUpperCase();

  // Check cache
  const cached = await fileCache.get<CompanyFacts>('company_facts', cacheKey, CACHE_TTL_COMPANY_FACTS);
  if (cached) return cached;

  // Fetch XBRL data
  const url = SEC_XBRL_COMPANY_FACTS_URL.replace('{cik}', cik);
  const data = await edgarFetchJson<XBRLCompanyFacts>(url);

  const usGaap = data.facts['us-gaap'] || {};
  const companyName = data.entityName || await getCompanyName(ticker);

  // Extract facts using our XBRL mappings
  const facts: FinancialFact[] = [];

  for (const mapping of XBRL_MAPPINGS) {
    // Try each possible XBRL tag name until we find one
    for (const tagName of mapping.xbrlTags) {
      const fact = usGaap[tagName];
      if (!fact || !fact.units) continue;

      // Get the appropriate unit (USD, USD/shares, shares, or pure)
      const unitKey = Object.keys(fact.units)[0];
      if (!unitKey) continue;

      const entries = fact.units[unitKey] || [];

      // Filter to only 10-K and 10-Q filings, deduplicate by period
      const seen = new Set<string>();
      const periods: FinancialFact['periods'] = [];

      for (const entry of entries) {
        if (!['10-K', '10-Q'].includes(entry.form)) continue;

        const periodKey = `${entry.end}-${entry.form}`;
        if (seen.has(periodKey)) continue;
        seen.add(periodKey);

        periods.push({
          period: entry.end,
          value: entry.val,
          unit: unitKey,
          form: entry.form,
          filed: entry.filed,
        });
      }

      if (periods.length > 0) {
        // Sort by period descending
        periods.sort((a, b) => b.period.localeCompare(a.period));

        facts.push({
          metric: mapping.standardName,
          periods,
        });
        break; // Found this metric, move to next mapping
      }
    }
  }

  const result: CompanyFacts = {
    ticker: ticker.toUpperCase(),
    cik,
    company_name: companyName,
    facts,
  };

  // Cache
  await fileCache.set('company_facts', cacheKey, result);

  return result;
}
