/**
 * Tool: search_filings
 * Full-text search across SEC filings via EDGAR search API.
 */

import { z } from 'zod';
import type { FilingSearchResult } from '@filinglens/shared';
import { CACHE_TTL_SEARCH } from '@filinglens/shared';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';

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
      _source: {
        file_date: string;
        display_date_filed: string;
        entity_name: string;
        file_num: string;
        form_type: string;
        file_description?: string;
        period_of_report?: string;
      };
      _id: string;
      highlight?: Record<string, string[]>;
    }>;
    total: { value: number };
  };
}

export async function searchFilings(params: SearchFilingsParams): Promise<FilingSearchResult[]> {
  const { query, ticker, date_from, date_to, limit = 10 } = params;

  const cacheKey = JSON.stringify(params);

  // Check cache
  const cached = await fileCache.get<FilingSearchResult[]>('search', cacheKey, CACHE_TTL_SEARCH);
  if (cached) return cached;

  // Build EDGAR full-text search URL
  const searchParams = new URLSearchParams({
    q: ticker ? `"${ticker}" ${query}` : query,
    dateRange: 'custom',
    startdt: date_from || '2020-01-01',
    enddt: date_to || new Date().toISOString().split('T')[0]!,
    forms: '10-K,10-Q,8-K',
  });

  const url = `https://efts.sec.gov/LATEST/search-index?${searchParams.toString()}`;

  let data: EFTSResponse;
  try {
    data = await edgarFetchJson<EFTSResponse>(url);
  } catch {
    // Fall back to simple search endpoint
    const fallbackUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}`;
    data = await edgarFetchJson<EFTSResponse>(fallbackUrl);
  }

  if (!data.hits?.hits) {
    return [];
  }

  const results: FilingSearchResult[] = data.hits.hits
    .slice(0, limit)
    .map(hit => {
      const src = hit._source;
      const snippets = hit.highlight
        ? Object.values(hit.highlight).flat().join(' ... ')
        : '';

      return {
        filing_type: src.form_type || '',
        date_filed: src.file_date || src.display_date_filed || '',
        accession_number: hit._id || '',
        company_name: src.entity_name || '',
        snippet: snippets.slice(0, 500),
        primary_document_url: '', // Would need additional lookup
      };
    });

  // Cache
  await fileCache.set('search', cacheKey, results);

  return results;
}
