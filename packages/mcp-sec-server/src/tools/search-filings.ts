/**
 * Tool: search_filings
 * Full-text search across SEC filings via EDGAR search API.
 *
 * Graduated fallback strategy:
 * 1. Full query with all filters (ticker, date range)
 * 2. Query + ticker only (drop date range)
 * 3. Query only (last resort)
 *
 * Only primary (level 0) results are cached. Fallback results are NOT cached
 * under the original key to prevent cache poisoning.
 */

import { z } from 'zod';
import type { FilingSearchResult } from '@dolph/shared';
import {
  CACHE_TTL_SEARCH,
  SEC_EDGAR_ARCHIVES_URL,
  SEC_FULL_TEXT_SEARCH_URL,
  SUPPORTED_FILING_FORMS_CSV,
} from '@dolph/shared';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';

/**
 * Build a filing index URL from an EDGAR accession number.
 * Accession format: `{CIK_10digits}-{YY}-{SEQ}` e.g. `0000320193-24-000123`
 * URL format: `https://www.sec.gov/Archives/edgar/data/{cikNumeric}/{accessionClean}/`
 */
function buildFilingIndexUrl(accession: string): string {
  if (!accession || !accession.includes('-')) return '';
  const cikPart = accession.split('-')[0] || '';
  const cikNumeric = cikPart.replace(/^0+/, '') || '0';
  const accessionClean = accession.replace(/-/g, '');
  return `${SEC_EDGAR_ARCHIVES_URL}/${cikNumeric}/${accessionClean}/`;
}

export const SearchFilingsInput = z.object({
  query: z.string().min(1).max(200),
  ticker: z.string().optional(),
  date_from: z.string().optional(), // YYYY-MM-DD
  date_to: z.string().optional(),   // YYYY-MM-DD
  limit: z.number().min(1).max(50).optional(),
});

export type SearchFilingsParams = z.infer<typeof SearchFilingsInput>;

interface EFTSResponse {
  hits: {
    hits: Array<{
      _source: Record<string, unknown>;
      _id: string;
      highlight?: Record<string, string[]>;
    }>;
    total: { value: number };
  };
}

function pickFirstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
      }
    }
  }
  return '';
}

function normalizeAccession(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/\d{10}-\d{2}-\d{6}/);
  return match ? match[0]! : trimmed;
}

function extractAccession(hitId: string, source: Record<string, unknown>): string {
  const candidate = pickFirstNonEmptyString(
    source['adsh'],
    source['accession_number'],
    source['accessionNo'],
    source['accession'],
    hitId,
  );
  return normalizeAccession(candidate);
}

function extractCompanyName(source: Record<string, unknown>, ticker?: string): string {
  return pickFirstNonEmptyString(
    source['entity_name'],
    source['entityName'],
    source['company_name'],
    source['companyName'],
    source['display_names'],
    source['displayName'],
  ) || ticker?.toUpperCase() || 'Unknown';
}

function extractFilingType(source: Record<string, unknown>): string {
  return pickFirstNonEmptyString(
    source['form_type'],
    source['formType'],
    source['form'],
    source['document_type'],
  ) || 'Unknown';
}

function extractDateFiled(source: Record<string, unknown>): string {
  return pickFirstNonEmptyString(
    source['file_date'],
    source['display_date_filed'],
    source['date_filed'],
    source['filedAt'],
    source['filed'],
  );
}

function extractSnippet(
  highlight: Record<string, string[]> | undefined,
  source: Record<string, unknown>,
  fallbackLevel: number,
): string {
  const highlightSnippet = highlight
    ? Object.values(highlight).flat().join(' ... ')
    : '';
  const sourceSnippet = pickFirstNonEmptyString(
    source['file_description'],
    source['fileDescription'],
    source['description'],
    source['document_description'],
    source['documentDescription'],
  );

  const fallbackPrefix = fallbackLevel === 1
    ? '[Date filter relaxed] '
    : fallbackLevel === 2
      ? '[Ticker/date filters relaxed] '
      : '';

  return `${fallbackPrefix}${highlightSnippet || sourceSnippet}`.slice(0, 500);
}

function buildSearchUrl(
  query: string,
  limit: number,
  ticker?: string,
  dateFrom?: string,
  dateTo?: string,
): string {
  const searchParams = new URLSearchParams({
    q: ticker ? `"${ticker}" ${query}` : query,
    forms: SUPPORTED_FILING_FORMS_CSV,
    size: String(limit),
  });

  if (dateFrom || dateTo) {
    searchParams.set('dateRange', 'custom');
    if (dateFrom) searchParams.set('startdt', dateFrom);
    if (dateTo) searchParams.set('enddt', dateTo);
  }

  return `${SEC_FULL_TEXT_SEARCH_URL}?${searchParams.toString()}`;
}

export async function searchFilings(params: SearchFilingsParams): Promise<FilingSearchResult[]> {
  const { query, ticker, date_from, date_to, limit = 10 } = params;

  const cacheKey = JSON.stringify(params);

  // Check cache
  const cached = await fileCache.get<FilingSearchResult[]>('search', cacheKey, CACHE_TTL_SEARCH);
  if (cached) return cached;

  // Graduated fallback strategy
  let data: EFTSResponse | null = null;
  let fallbackLevel = 0; // 0 = primary, 1 = no dates, 2 = query only

  // Level 0: Full query with all filters
  const primaryUrl = buildSearchUrl(query, limit, ticker, date_from, date_to);
  try {
    data = await edgarFetchJson<EFTSResponse>(primaryUrl);
    if (data.hits?.hits?.length > 0) fallbackLevel = 0;
    else data = null; // Empty results — try fallback
  } catch {
    data = null;
  }

  // Level 1: Drop date filters, keep ticker
  if (!data && ticker) {
    try {
      const url = buildSearchUrl(query, limit, ticker);
      data = await edgarFetchJson<EFTSResponse>(url);
      if (data.hits?.hits?.length > 0) fallbackLevel = 1;
      else data = null;
    } catch {
      data = null;
    }
  }

  // Level 2: Query only (last resort)
  if (!data) {
    try {
      const url = buildSearchUrl(query, limit);
      data = await edgarFetchJson<EFTSResponse>(url);
      fallbackLevel = 2;
    } catch {
      return [];
    }
  }

  if (!data?.hits?.hits) {
    return [];
  }

  const results: FilingSearchResult[] = data.hits.hits
    .slice(0, limit)
    .map(hit => {
      const src = hit._source || {};
      const accession = extractAccession(hit._id || '', src);
      const filingType = extractFilingType(src);
      const companyName = extractCompanyName(src, ticker);
      const dateFiled = extractDateFiled(src);
      const snippet = extractSnippet(hit.highlight, src, fallbackLevel);
      const directUrl = pickFirstNonEmptyString(
        src['primary_document_url'],
        src['primaryDocumentUrl'],
        src['linkToFilingDetails'],
        src['filing_url'],
      );

      return {
        filing_type: filingType,
        date_filed: dateFiled,
        accession_number: accession,
        company_name: companyName,
        snippet,
        primary_document_url: directUrl || buildFilingIndexUrl(accession),
      };
    });

  // Only cache primary (level 0) results — fallback results are NOT cached
  // under the original filtered key to prevent cache poisoning
  if (fallbackLevel === 0) {
    await fileCache.set('search', cacheKey, results);
  }

  return results;
}
