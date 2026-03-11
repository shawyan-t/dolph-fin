/**
 * Ticker → CIK resolution using SEC's company_tickers.json
 *
 * Resolution strategy (in order):
 * 1. Exact match against SEC ticker database
 * 2. Common alias map (TSMC→TSM, GOOG→GOOGL, FB→META, etc.)
 * 3. Prefix/contains search across all SEC tickers
 * 4. Company name search across SEC database
 * 5. Fail with helpful error message including suggestions
 */

import { SEC_COMPANY_TICKERS_URL, CACHE_TTL_TICKERS } from '@shawyan/shared';
import { fileCache } from '../cache/file-cache.js';
import { edgarFetchJson } from './client.js';

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

// In-memory cache of ticker → CIK mapping (with load timestamp for TTL)
let tickerMap: Map<string, string> | null = null;
let companyNameMap: Map<string, string> | null = null;
let cikToTickerMap: Map<string, string> | null = null;
let tickerMapLoadedAt = 0;
let tickerMapLoadPromise: Promise<void> | null = null;

/**
 * Common ticker aliases — maps what people commonly type to the actual SEC ticker.
 * These cover renamed companies, colloquial names, and format differences.
 */
const TICKER_ALIASES: Record<string, string> = {
  // Common colloquial names
  'TSMC': 'TSM',
  'TAIWAN SEMI': 'TSM',
  // Berkshire variants
  'BRK.B': 'BRK-B',
  'BRK.A': 'BRK-A',
  'BRKB': 'BRK-B',
  'BRKA': 'BRK-A',
  // Former names
  'FB': 'META',
  'FACEBOOK': 'META',
  // Google variants
  'GOOGLE': 'GOOGL',
  // Common share class confusion
  'BF.B': 'BF-B',
  'BF.A': 'BF-A',
  // Other common aliases
  'VISA': 'V',
  'MASTERCARD': 'MA',
  'JPMORGAN': 'JPM',
  'JP MORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'GOLDMAN SACHS': 'GS',
  'MORGAN STANLEY': 'MS',
  'BANK OF AMERICA': 'BAC',
  'WELLS FARGO': 'WFC',
  'COCA COLA': 'KO',
  'COCA-COLA': 'KO',
  'JOHNSON AND JOHNSON': 'JNJ',
  'J&J': 'JNJ',
  'P&G': 'PG',
  'PROCTER AND GAMBLE': 'PG',
  'WALMART': 'WMT',
  'WAL-MART': 'WMT',
};

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
  // Reload if memory cache is stale (older than TTL)
  if (tickerMap && (Date.now() - tickerMapLoadedAt) < CACHE_TTL_TICKERS) return;
  if (tickerMapLoadPromise) {
    await tickerMapLoadPromise;
    return;
  }

  tickerMapLoadPromise = (async () => {
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
      data = await edgarFetchJson<Record<string, CompanyTickerEntry>>(SEC_COMPANY_TICKERS_URL);
      await fileCache.set('tickers', 'company_tickers', data);
    }

    // Build new maps in locals first so we only swap atomically on success
    const nextTickerMap = new Map<string, string>();
    const nextCompanyNameMap = new Map<string, string>();
    const nextCikToTickerMap = new Map<string, string>();

    for (const entry of Object.values(data)) {
      const ticker = entry.ticker.toUpperCase();
      const cik = padCik(entry.cik_str);
      nextTickerMap.set(ticker, cik);
      nextCompanyNameMap.set(ticker, entry.title);
      // Keep the first (usually most common) ticker for each CIK
      if (!nextCikToTickerMap.has(cik)) {
        nextCikToTickerMap.set(cik, ticker);
      }
    }

    tickerMap = nextTickerMap;
    companyNameMap = nextCompanyNameMap;
    cikToTickerMap = nextCikToTickerMap;
    tickerMapLoadedAt = Date.now();
  })()
    .catch((err) => {
      // If a stale in-memory map exists, keep serving it rather than hard-failing.
      if (tickerMap && companyNameMap && cikToTickerMap) {
        tickerMapLoadedAt = Date.now();
        return;
      }
      throw err;
    })
    .finally(() => {
      tickerMapLoadPromise = null;
    });

  await tickerMapLoadPromise;
}

/**
 * Resolve a stock ticker to a zero-padded CIK number.
 * Uses multiple strategies: exact match → alias → fuzzy → name search.
 * Returns { cik, resolvedTicker } so callers can use the actual SEC ticker.
 */
export async function resolveCik(ticker: string): Promise<string> {
  await loadTickerMap();

  const upperTicker = ticker.toUpperCase().trim();

  // Strategy 1: Exact match
  const exactCik = tickerMap!.get(upperTicker);
  if (exactCik) return exactCik;

  // Strategy 2: Alias map
  const alias = TICKER_ALIASES[upperTicker];
  if (alias) {
    const aliasCik = tickerMap!.get(alias);
    if (aliasCik) return aliasCik;
  }

  // Strategy 3: Dot → Dash normalization (BRK.B → BRK-B)
  if (upperTicker.includes('.')) {
    const dashVersion = upperTicker.replace(/\./g, '-');
    const dashCik = tickerMap!.get(dashVersion);
    if (dashCik) return dashCik;
  }

  // Strategy 4: Close prefix/suffix match (conservative)
  // Only matches when the length difference is small (max 2 chars) AND
  // the real ticker is at least 2 characters long.
  // e.g., "TSMC" → finds "TSM" (diff=1, TSM.length=3 ≥ 2)
  // e.g., "VNIE" → does NOT match "V" (V.length=1 < 2)
  // e.g., "VNIE" → does NOT match "VNI" (diff=1 but VNI must exist)
  const candidates: Array<{ ticker: string; cik: string; score: number }> = [];

  for (const [t, cik] of tickerMap!) {
    const lenDiff = Math.abs(t.length - upperTicker.length);
    // Skip if length difference is too large — prevents false positives
    if (lenDiff > 2) continue;
    // Require real ticker to be at least 2 chars
    if (t.length < 2) continue;

    // Input is a prefix of a real ticker (user typed something too short)
    if (t.startsWith(upperTicker) && lenDiff <= 2) {
      candidates.push({ ticker: t, cik, score: 10 - lenDiff });
    }
    // Real ticker is a prefix of input (user typed something too long, e.g. TSMC→TSM)
    else if (upperTicker.startsWith(t) && lenDiff <= 2) {
      candidates.push({ ticker: t, cik, score: 8 - lenDiff });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;
    const second = candidates[1];
    // Only accept if the best candidate is clearly ahead (score gap >= 2)
    // OR there's only one candidate. This prevents ambiguous auto-picks.
    if (!second || (best.score - second.score) >= 2) {
      process.stderr.write(
        `\x1B[33m  ⚠ Fuzzy ticker match: "${ticker}" → ${best.ticker} (score: ${best.score})\x1B[0m\n`,
      );
      return best.cik;
    }
    // Ambiguous — fall through to name search or error with suggestions
  }

  // Strategy 5: Company name search (strict — query must be ≥4 chars)
  // Only search by company name if the ticker is long enough to be meaningful.
  // Short tickers like "V", "F", "X" would cause too many false positives.
  if (upperTicker.length >= 4) {
    for (const [t, name] of companyNameMap!) {
      if (name.toUpperCase().includes(upperTicker)) {
        return tickerMap!.get(t)!;
      }
    }
  }

  // All strategies exhausted — build helpful error message
  const suggestions = findSuggestions(upperTicker);
  const suggestStr = suggestions.length > 0
    ? ` Did you mean: ${suggestions.map(s => `${s.ticker} (${s.name})`).join(', ')}?`
    : '';

  throw new Error(
    `Could not find "${ticker}" in the SEC database.${suggestStr} ` +
    'Make sure you\'re using the official exchange ticker symbol.',
  );
}

/**
 * Find similar tickers for suggestion in error messages.
 */
function findSuggestions(query: string): Array<{ ticker: string; name: string }> {
  const results: Array<{ ticker: string; name: string; score: number }> = [];
  const q = query.toUpperCase();

  for (const [ticker, name] of companyNameMap!) {
    let score = 0;

    // Ticker similarity (edit distance approximation)
    if (ticker.startsWith(q.slice(0, 2))) score += 3;
    if (ticker.startsWith(q.slice(0, 1))) score += 1;

    // Name contains query
    if (name.toUpperCase().includes(q)) score += 5;

    // Shared characters
    const shared = [...q].filter(c => ticker.includes(c)).length;
    score += shared * 0.5;

    if (score >= 3) {
      results.push({ ticker, name, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * Get company name for a ticker (resolves aliases)
 */
export async function getCompanyName(ticker: string): Promise<string> {
  await loadTickerMap();

  const upper = ticker.toUpperCase().trim();

  // Direct match
  const directName = companyNameMap!.get(upper);
  if (directName) return directName;

  // Try alias
  const alias = TICKER_ALIASES[upper];
  if (alias) {
    return companyNameMap!.get(alias) || ticker;
  }

  return ticker;
}

/**
 * Resolve entity metadata from a CIK.
 * Returns null when the CIK is not present in the SEC ticker map.
 */
export async function getEntityByCik(
  cik: string,
): Promise<{ ticker: string; name: string } | null> {
  await loadTickerMap();
  const padded = padCik(cik.replace(/\D/g, ''));
  const ticker = cikToTickerMap!.get(padded);
  if (!ticker) return null;
  return {
    ticker,
    name: companyNameMap!.get(ticker) || ticker,
  };
}

/** Resolution result with confidence scoring */
export interface TickerResolution {
  /** Resolved ticker symbol (as it appears in SEC database) */
  ticker: string;
  /** Company name */
  name: string;
  /** Zero-padded CIK */
  cik: string;
  /** Confidence score: 1.0 = exact, 0.9 = alias, 0.7 = fuzzy, 0.5 = name */
  confidence: number;
  /** How the ticker was resolved */
  method: 'exact' | 'alias' | 'dot_normalization' | 'fuzzy' | 'name_search';
  /** Alternative matches (if any) */
  alternatives: Array<{ ticker: string; name: string; cik: string; confidence: number }>;
}

/**
 * Resolve a ticker with full confidence scoring and alternatives.
 * Unlike resolveCik(), this never throws — it returns alternatives for ambiguous inputs.
 */
export async function resolveTickerWithConfidence(ticker: string): Promise<TickerResolution | null> {
  await loadTickerMap();

  const upperTicker = ticker.toUpperCase().trim();
  const alternatives: TickerResolution['alternatives'] = [];

  // Strategy 1: Exact match (confidence = 1.0)
  const exactCik = tickerMap!.get(upperTicker);
  if (exactCik) {
    return {
      ticker: upperTicker,
      name: companyNameMap!.get(upperTicker) || upperTicker,
      cik: exactCik,
      confidence: 1.0,
      method: 'exact',
      alternatives: [],
    };
  }

  // Strategy 2: Alias map (confidence = 0.95)
  const alias = TICKER_ALIASES[upperTicker];
  if (alias) {
    const aliasCik = tickerMap!.get(alias);
    if (aliasCik) {
      return {
        ticker: alias,
        name: companyNameMap!.get(alias) || alias,
        cik: aliasCik,
        confidence: 0.95,
        method: 'alias',
        alternatives: [],
      };
    }
  }

  // Strategy 3: Dot normalization (confidence = 0.9)
  if (upperTicker.includes('.')) {
    const dashVersion = upperTicker.replace(/\./g, '-');
    const dashCik = tickerMap!.get(dashVersion);
    if (dashCik) {
      return {
        ticker: dashVersion,
        name: companyNameMap!.get(dashVersion) || dashVersion,
        cik: dashCik,
        confidence: 0.9,
        method: 'dot_normalization',
        alternatives: [],
      };
    }
  }

  // Strategy 4: Fuzzy prefix/suffix (confidence = 0.7)
  const candidates: Array<{ ticker: string; cik: string; score: number }> = [];
  for (const [t, cik] of tickerMap!) {
    const lenDiff = Math.abs(t.length - upperTicker.length);
    if (lenDiff > 2 || t.length < 2) continue;

    if (t.startsWith(upperTicker) && lenDiff <= 2) {
      candidates.push({ ticker: t, cik, score: 10 - lenDiff });
    } else if (upperTicker.startsWith(t) && lenDiff <= 2) {
      candidates.push({ ticker: t, cik, score: 8 - lenDiff });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;
    const alts = candidates.slice(1, 4).map(c => ({
      ticker: c.ticker,
      name: companyNameMap!.get(c.ticker) || c.ticker,
      cik: c.cik,
      confidence: 0.5 + (c.score / 20),
    }));

    return {
      ticker: best.ticker,
      name: companyNameMap!.get(best.ticker) || best.ticker,
      cik: best.cik,
      confidence: 0.7,
      method: 'fuzzy',
      alternatives: alts,
    };
  }

  // Strategy 5: Name search (confidence = 0.5)
  if (upperTicker.length >= 4) {
    const nameMatches: Array<{ ticker: string; name: string; cik: string }> = [];
    for (const [t, name] of companyNameMap!) {
      if (name.toUpperCase().includes(upperTicker)) {
        nameMatches.push({ ticker: t, name, cik: tickerMap!.get(t)! });
        if (nameMatches.length >= 5) break;
      }
    }

    if (nameMatches.length > 0) {
      const best = nameMatches[0]!;
      return {
        ticker: best.ticker,
        name: best.name,
        cik: best.cik,
        confidence: 0.5,
        method: 'name_search',
        alternatives: nameMatches.slice(1).map(m => ({ ...m, confidence: 0.4 })),
      };
    }
  }

  return null;
}

/**
 * Search tickers by partial match (for autocomplete)
 */
export async function searchTickers(
  query: string,
  limit: number = 10,
): Promise<Array<{ ticker: string; name: string; cik: string }>> {
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
