/**
 * Tool: get_company_filings
 * Retrieves recent SEC filings for a given ticker from EDGAR.
 */

import { z } from 'zod';
import type { Filing, FilingType } from '@dolph/shared';
import {
  SEC_SUBMISSIONS_URL,
  SEC_EDGAR_ARCHIVES_URL,
  CACHE_TTL_FILINGS_LIST,
  DEFAULT_FILINGS_LIMIT,
} from '@dolph/shared';
import { resolveCik } from '../edgar/cik-lookup.js';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';

export const GetCompanyFilingsInput = z.object({
  ticker: z.string().min(1).max(10),
  filing_type: z.enum(['10-K', '10-Q', '8-K', 'DEF 14A', '20-F', '6-K', '40-F']).optional(),
  limit: z.number().min(1).max(50).optional(),
});

export type GetCompanyFilingsParams = z.infer<typeof GetCompanyFilingsInput>;

interface EdgarSubmissions {
  cik: string;
  entityType: string;
  name: string;
  recentFilings?: {
    accessionNumber: string[];
    filingDate: string[];
    form: string[];
    primaryDocument: string[];
    primaryDocDescription: string[];
  };
  // The actual key in the API response
  filings?: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

export async function getCompanyFilings(params: GetCompanyFilingsParams): Promise<Filing[]> {
  const { ticker, filing_type, limit = DEFAULT_FILINGS_LIMIT } = params;

  const cik = await resolveCik(ticker);
  const cacheKey = `${ticker}-${filing_type || 'all'}-${limit}`;

  // Check cache
  const cached = await fileCache.get<Filing[]>('filings', cacheKey, CACHE_TTL_FILINGS_LIST);
  if (cached) return cached;

  // Fetch from EDGAR
  const url = SEC_SUBMISSIONS_URL.replace('{cik}', cik);
  const data = await edgarFetchJson<EdgarSubmissions>(url);

  // Extract the recent filings array
  const recent = data.filings?.recent || data.recentFilings;
  if (!recent || !recent.accessionNumber) {
    return [];
  }

  const filings: Filing[] = [];
  const cikNumeric = cik.replace(/^0+/, '');

  for (let i = 0; i < recent.accessionNumber.length && filings.length < limit; i++) {
    const form = recent.form[i] || '';

    // Filter by filing type if specified
    if (filing_type && form !== filing_type) continue;

    // Only include filing types we care about (domestic + foreign filer equivalents)
    if (!['10-K', '10-Q', '8-K', 'DEF 14A', '20-F', '6-K', '40-F'].includes(form)) continue;

    const accessionRaw = recent.accessionNumber[i] || '';
    const accessionClean = accessionRaw.replace(/-/g, '');
    const primaryDoc = recent.primaryDocument[i] || '';

    filings.push({
      filing_type: form as FilingType,
      date_filed: recent.filingDate[i] || '',
      accession_number: accessionRaw,
      primary_document_url: `${SEC_EDGAR_ARCHIVES_URL}/${cikNumeric}/${accessionClean}/${primaryDoc}`,
      description: recent.primaryDocDescription[i] || form,
    });
  }

  // Cache the results
  await fileCache.set('filings', cacheKey, filings);

  return filings;
}
