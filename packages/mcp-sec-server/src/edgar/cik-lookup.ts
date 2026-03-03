/**
 * Ticker → CIK resolution using SEC's company_tickers.json
 */

import { SEC_COMPANY_TICKERS_URL, CACHE_TTL_TICKERS } from '@filinglens/shared';
import { fileCache } from '../cache/file-cache.js';
import { rateLimiter } from '../utils/rate-limiter.js';

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

// In-memory cache of ticker → CIK mapping
let tickerMap: Map<string, string> | null = null;
let companyNameMap: Map<string, string> | null = null;

function getUserAgent(): string {
  return process.env['FILINGLENS_SEC_USER_AGENT'] || 'FilingLens dev@filinglens.com';
}

/**
 * Zero-pad CIK to 10 digits as required by SEC APIs
 */
export function padCik(cik: number | string): string {
  return String(cik).padStart(10, '0');
}

/**
 * Load the ticker → CIK mapping from SEC or cache
 */
async function loadTickerMap(): Promise<void> {
  if (tickerMap) return;

  // Try cache first
  const cached = await fileCache.get<Record<string, CompanyTickerEntry>>(
    'tickers',
    'company_tickers',
    CACHE_TTL_TICKERS,
  );

  let data: Record<string, CompanyTickerEntry>;

  if (cached) {
    data = cached;
  } else {
    await rateLimiter.acquire();
    const response = await fetch(SEC_COMPANY_TICKERS_URL, {
      headers: { 'User-Agent': getUserAgent() },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch company tickers: ${response.status} ${response.statusText}`);
    }

    data = await response.json() as Record<string, CompanyTickerEntry>;
    await fileCache.set('tickers', 'company_tickers', data);
  }

  // Build reverse maps
  tickerMap = new Map();
  companyNameMap = new Map();

  for (const entry of Object.values(data)) {
    const ticker = entry.ticker.toUpperCase();
    const cik = padCik(entry.cik_str);
    tickerMap.set(ticker, cik);
    companyNameMap.set(ticker, entry.title);
  }
}

/**
 * Resolve a stock ticker to a zero-padded CIK number
 */
export async function resolveCik(ticker: string): Promise<string> {
  await loadTickerMap();

  const cik = tickerMap!.get(ticker.toUpperCase());
  if (!cik) {
    throw new Error(`Unknown ticker: ${ticker}. Could not resolve to a CIK number.`);
  }

  return cik;
}

/**
 * Get company name for a ticker
 */
export async function getCompanyName(ticker: string): Promise<string> {
  await loadTickerMap();
  return companyNameMap!.get(ticker.toUpperCase()) || ticker;
}

/**
 * Search tickers by partial match (for autocomplete)
 */
export async function searchTickers(query: string, limit: number = 10): Promise<Array<{ ticker: string; name: string; cik: string }>> {
  await loadTickerMap();

  const q = query.toUpperCase();
  const results: Array<{ ticker: string; name: string; cik: string }> = [];

  for (const [ticker, cik] of tickerMap!) {
    if (results.length >= limit) break;
    const name = companyNameMap!.get(ticker) || '';
    if (ticker.startsWith(q) || name.toUpperCase().includes(q)) {
      results.push({ ticker, name, cik });
    }
  }

  return results;
}
