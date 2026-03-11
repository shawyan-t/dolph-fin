/**
 * Tool: search_filings
 * Full-text search across SEC filings via EDGAR search API.
 *
 * Graduated fallback strategy (availability with guardrails):
 * 1. Full query with all filters (ticker, date range)
 * 2. Query + ticker only (drop date range)
 * 3. Query only (optional last resort; disabled when ticker relax is off)
 *
 * Only primary (level 0) results are cached. Fallback results are NOT cached
 * under the original key to prevent cache poisoning.
 */

import { z } from 'zod';
import type { FilingSearchResult } from '@shawyan/shared';
import {
  CACHE_TTL_SEARCH,
  SEC_EDGAR_ARCHIVES_URL,
  SEC_FULL_TEXT_SEARCH_URL,
  SUPPORTED_FILING_FORMS_CSV,
} from '@shawyan/shared';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';
import { getEntityByCik, resolveCik } from '../edgar/cik-lookup.js';
import { getCompanyFilings } from './get-company-filings.js';

const STRICT_SEARCH_MODE = process.env['DOLPH_STRICT_SEARCH_MODE'] === '1';
const ALLOW_TICKER_RELAX = process.env['DOLPH_SEARCH_ALLOW_TICKER_RELAX'] === '1';
const SEARCH_CACHE_SCHEMA_VERSION = 4;

/**
 * Build a filing index URL from an EDGAR accession number.
 * Accession format: `{CIK_10digits}-{YY}-{SEQ}` e.g. `0000320193-24-000123`
 * URL format: `https://www.sec.gov/Archives/edgar/data/{cikNumeric}/{accessionClean}/`
 */
function buildFilingIndexUrl(accession: string, cikCandidate?: string): string {
  if (!accession || !accession.includes('-')) return '';
  const cikPart = cikCandidate?.replace(/\D/g, '') || accession.split('-')[0] || '';
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

function extractCikFromAccession(accession: string): string | null {
  const m = accession.match(/^(\d{10})-\d{2}-\d{6}$/);
  return m ? m[1]! : null;
}

function normalizeCikCandidate(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits.padStart(10, '0').slice(-10) : null;
}

function extractCiksFromSource(source: Record<string, unknown>): string[] {
  const result = new Set<string>();

  const pushCik = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const normalized = normalizeCikCandidate(value);
    if (normalized) result.add(normalized);
  };

  const ciks = source['ciks'];
  if (Array.isArray(ciks)) {
    for (const c of ciks) pushCik(c);
  } else {
    pushCik(ciks);
  }

  pushCik(source['cik']);
  pushCik(source['cik_str']);
  pushCik(source['entity_cik']);
  pushCik(source['issuer_cik']);

  return Array.from(result);
}

function extractCikFromSource(source: Record<string, unknown>): string | null {
  return extractCiksFromSource(source)[0] || null;
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

  const text = (highlightSnippet || sourceSnippet || 'No preview available').trim();
  return `${fallbackPrefix}${text}`.slice(0, 500);
}

function scoreSearchHit(source: Record<string, unknown>): number {
  let score = 0;

  const seqRaw = pickFirstNonEmptyString(source['sequence'], source['doc_sequence']);
  const seq = Number(seqRaw);
  if (Number.isFinite(seq)) {
    if (seq === 1) score += 50;
    else if (seq <= 3) score += 20;
  }

  const fileType = pickFirstNonEmptyString(
    source['file_type'],
    source['fileType'],
    source['document_type'],
  ).toUpperCase();
  if (fileType === 'HTML' || fileType === 'HTM') score += 20;
  if (fileType === 'XML') score -= 10;

  const description = pickFirstNonEmptyString(
    source['file_description'],
    source['fileDescription'],
    source['description'],
    source['document_description'],
  ).toUpperCase();

  if (/(^|[^A-Z])EX-?\d/.test(description) || description.includes('EXHIBIT')) score -= 20;
  if (/(10-K|10-Q|8-K|20-F|6-K|40-F|DEF 14A)/.test(description)) score += 12;

  return score;
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
  const normalizedTicker = ticker?.trim().toUpperCase() || undefined;

  const cacheKey = JSON.stringify({ v: SEARCH_CACHE_SCHEMA_VERSION, ...params });

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
  if (!data && ticker && !STRICT_SEARCH_MODE) {
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
  if (!data && !STRICT_SEARCH_MODE && (!ticker || ALLOW_TICKER_RELAX)) {
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

  let resolvedTickerCik: string | null = null;
  if (normalizedTicker) {
    try {
      resolvedTickerCik = await resolveCik(normalizedTicker);
    } catch {
      resolvedTickerCik = null;
    }
  }

  const dedupedResults = new Map<string, { result: FilingSearchResult; score: number }>();
  for (const hit of data.hits.hits.slice(0, limit)) {
    const src = hit._source || {};
    const accession = extractAccession(hit._id || '', src);
    const filingType = extractFilingType(src);
    let companyName = extractCompanyName(src, normalizedTicker);
    const sourceCiks = extractCiksFromSource(src);
    const sourceCik = sourceCiks[0] || extractCikFromAccession(accession);
    const dateFiled = extractDateFiled(src);
    const snippet = extractSnippet(hit.highlight, src, fallbackLevel);
    const directUrl = pickFirstNonEmptyString(
      src['primary_document_url'],
      src['primaryDocumentUrl'],
      src['link_to_html'],
      src['linkToHtml'],
      src['link_to_txt'],
      src['linkToTxt'],
      src['linkToFilingDetails'],
      src['filing_url'],
    );

    // If EFTS omits company name, recover it from CIK when possible.
    if (!companyName || companyName === 'Unknown') {
      if (sourceCik) {
        const entity = await getEntityByCik(sourceCik);
        if (entity?.name) {
          companyName = entity.name;
        } else if (entity?.ticker) {
          companyName = entity.ticker;
        }
      }
    }

    // When ticker is explicitly provided, keep results entity-coherent.
    if (normalizedTicker) {
      const companyUpper = companyName.toUpperCase();
      const tickerMentionMatch = companyUpper.includes(`(${normalizedTicker})`) || companyUpper === normalizedTicker;
      const cikMatch = resolvedTickerCik
        ? (sourceCik === resolvedTickerCik || sourceCiks.includes(resolvedTickerCik))
        : false;
      if (!tickerMentionMatch && !cikMatch) {
        continue;
      }
    }

    const result: FilingSearchResult = {
      filing_type: filingType,
      date_filed: dateFiled,
      accession_number: accession,
      company_name: companyName || normalizedTicker || 'Unknown',
      snippet,
      primary_document_url: directUrl || buildFilingIndexUrl(accession, sourceCik || undefined),
    };

    const dedupeKey = accession || `${filingType}:${dateFiled}:${result.company_name}`;
    const score = scoreSearchHit(src);
    const existing = dedupedResults.get(dedupeKey);
    if (!existing || score > existing.score) {
      dedupedResults.set(dedupeKey, { result, score });
    }
  }

  const results = Array.from(dedupedResults.values())
    .map(v => v.result)
    .sort((a, b) => {
      const aDate = /^\d{4}-\d{2}-\d{2}$/.test(a.date_filed) ? a.date_filed : '';
      const bDate = /^\d{4}-\d{2}-\d{2}$/.test(b.date_filed) ? b.date_filed : '';
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return a.accession_number.localeCompare(b.accession_number);
    })
    .slice(0, limit);

  // For ticker-scoped searches, prefer canonical EDGAR document URLs from
  // submissions data so preview/download opens the actual filing document.
  if (normalizedTicker && results.length > 0) {
    try {
      const filings = await getCompanyFilings({ ticker: normalizedTicker, limit: Math.max(50, limit * 3) });
      const filingUrlByAccession = new Map(
        filings.map(f => [f.accession_number, f.primary_document_url] as const),
      );
      for (const result of results) {
        const canonicalUrl = filingUrlByAccession.get(result.accession_number);
        if (canonicalUrl) {
          result.primary_document_url = canonicalUrl;
        }
      }
    } catch {
      // Keep EFTS-derived URLs if submissions enrichment fails.
    }
  }

  // Only cache primary (level 0) results — fallback results are NOT cached
  // under the original filtered key to prevent cache poisoning
  if (fallbackLevel === 0) {
    await fileCache.set('search', cacheKey, results);
  }

  return results;
}
