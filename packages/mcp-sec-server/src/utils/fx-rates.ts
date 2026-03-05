/**
 * FX Rate conversion — fetches exchange rates from free APIs (no key required).
 *
 * Used to convert non-USD financial data (e.g., TSMC in TWD, SAP in EUR)
 * to USD for consistent comparison.
 *
 * APIs:
 * - Latest rates: open.er-api.com (free, 166 currencies, updates daily)
 * - Historical date rates: frankfurter.app (free ECB-backed historical rates)
 *
 * Conversion policy:
 * - Prefer period-end historical FX when an as-of date is provided
 * - Fall back to latest daily FX only if historical lookup fails
 *
 * Cache: 24 hours via file cache
 */

import { CACHE_TTL_FX_RATES } from '@dolph/shared';
import { fileCache } from '../cache/file-cache.js';

const FX_LATEST_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_HISTORICAL_API_BASE = 'https://api.frankfurter.app';
const STRICT_FX_MODE = process.env['DOLPH_STRICT_FX_MODE'] === '1';

interface FXRateCache {
  rates: Record<string, number>;
  fetchedAt: string;
  effectiveDate: string;
  source: 'latest' | 'historical' | 'latest_fallback';
}

/** In-memory cache for the current session (with TTL), keyed by date key */
const memoryCache = new Map<string, FXRateCache>();

type RateSource = FXRateCache['source'];

/**
 * Check if the memory cache is still fresh (within TTL).
 */
function isMemoryCacheFresh(cache: FXRateCache | null): boolean {
  if (!cache) return false;
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_FX_RATES;
}

function normalizeDate(asOfDate?: string): string | undefined {
  if (!asOfDate) return undefined;
  const m = asOfDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return undefined;
  return m[1];
}

function getCacheKey(asOfDate?: string): string {
  return asOfDate ? `usd_rates_${asOfDate}` : 'usd_rates_latest';
}

interface RateLookup {
  rates: Record<string, number>;
  effectiveDate: string;
  source: RateSource;
}

/**
 * Fetch latest USD-based exchange rates. Cached for 24 hours.
 * Returns a map of currency code → rate (how many units per 1 USD).
 */
async function fetchLatestRates(): Promise<RateLookup> {
  const response = await fetch(FX_LATEST_API_URL);
  if (!response.ok) {
    throw new Error(`FX rate fetch failed: ${response.status}`);
  }

  const data = await response.json() as {
    result: string;
    rates: Record<string, number>;
  };

  if (data.result !== 'success' || !data.rates) {
    throw new Error('FX rate API returned unexpected format');
  }

  return {
    rates: data.rates,
    effectiveDate: new Date().toISOString().slice(0, 10),
    source: 'latest',
  };
}

/**
 * Fetch historical USD-based exchange rates for a specific date.
 * Frankfurter returns rates for that date (or nearest previous business day).
 */
async function fetchHistoricalRates(asOfDate: string): Promise<RateLookup> {
  const url = `${FX_HISTORICAL_API_BASE}/${asOfDate}?from=USD`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Historical FX fetch failed for ${asOfDate}: ${response.status}`);
  }

  const data = await response.json() as {
    amount: number;
    base: string;
    date: string;
    rates: Record<string, number>;
  };

  if (data.base !== 'USD' || !data.rates || !data.date) {
    throw new Error(`Historical FX API returned unexpected format for ${asOfDate}`);
  }

  return {
    rates: data.rates,
    effectiveDate: data.date,
    source: 'historical',
  };
}

/**
 * Fetch USD-based rates, preferring historical date when provided.
 * If historical lookup fails, falls back to latest.
 */
async function getRates(asOfDate?: string): Promise<RateLookup> {
  const normalizedDate = normalizeDate(asOfDate);
  const cacheKey = getCacheKey(normalizedDate);

  const mem = memoryCache.get(cacheKey) || null;
  if (isMemoryCacheFresh(mem)) {
    return {
      rates: mem!.rates,
      effectiveDate: mem!.effectiveDate,
      source: mem!.source,
    };
  }

  // Try disk cache first
  const cached = await fileCache.get<FXRateCache>('fx', cacheKey, CACHE_TTL_FX_RATES);
  if (cached) {
    memoryCache.set(cacheKey, cached);
    return {
      rates: cached.rates,
      effectiveDate: cached.effectiveDate,
      source: cached.source,
    };
  }

  let lookup: RateLookup;
  if (normalizedDate) {
    try {
      lookup = await fetchHistoricalRates(normalizedDate);
    } catch {
      if (STRICT_FX_MODE) {
        throw new Error(
          `Historical FX rate unavailable for ${normalizedDate} and strict FX mode is enabled.`,
        );
      }
      const latest = await fetchLatestRates();
      lookup = {
        rates: latest.rates,
        effectiveDate: latest.effectiveDate,
        source: 'latest_fallback',
      };
    }
  } else {
    lookup = await fetchLatestRates();
  }

  const cache: FXRateCache = {
    rates: lookup.rates,
    fetchedAt: new Date().toISOString(),
    effectiveDate: lookup.effectiveDate,
    source: lookup.source,
  };
  memoryCache.set(cacheKey, cache);
  await fileCache.set('fx', cacheKey, cache);

  return lookup;
}

/**
 * Parse the currency code from an XBRL unit string.
 * Examples: "TWD" → "TWD", "TWD/shares" → "TWD", "USD" → "USD", "pure" → null, "shares" → null
 */
export function parseCurrency(unit: string): string | null {
  if (unit === 'pure' || unit === 'shares') return null;

  // Handle compound units like "TWD/shares"
  const base = unit.split('/')[0]!;
  if (base === 'pure' || base === 'shares') return null;

  // Must be 3 uppercase letters (ISO 4217)
  if (/^[A-Z]{3}$/.test(base)) return base;

  return null;
}

/**
 * Get the conversion rate from a foreign currency to USD.
 * Returns the multiplier: value_in_foreign * rate = value_in_USD.
 *
 * For USD, returns 1.0. For TWD with rate 31.58, returns ~0.0317.
 */
export async function getConversionRate(fromCurrency: string, asOfDate?: string): Promise<number> {
  if (fromCurrency === 'USD') return 1.0;

  const { rates } = await getRates(asOfDate);
  const rate = rates[fromCurrency];

  if (!rate) {
    throw new Error(`Unknown currency: ${fromCurrency}. Cannot convert to USD.`);
  }

  // rates are USD-based (1 USD = X foreign), so to convert foreign→USD we divide
  return 1 / rate;
}

/**
 * Convert a value from a foreign currency to USD.
 */
export async function convertToUSD(value: number, fromCurrency: string, asOfDate?: string): Promise<number> {
  const rate = await getConversionRate(fromCurrency, asOfDate);
  return value * rate;
}

/**
 * Get a human-readable FX rate string for report annotation.
 * e.g., "1 USD = 31.58 TWD (2024-12-31, historical)"
 */
export async function getFXRateLabel(currency: string, asOfDate?: string): Promise<string> {
  if (currency === 'USD') return '';
  const { rates, effectiveDate, source } = await getRates(asOfDate);
  const rate = rates[currency];
  if (!rate) return `(${currency} → USD conversion unavailable)`;
  const sourceLabel = source === 'historical'
    ? 'historical'
    : source === 'latest_fallback'
      ? 'latest fallback'
      : 'latest';
  return `1 USD = ${rate.toFixed(4)} ${currency} (${effectiveDate}, ${sourceLabel})`;
}
