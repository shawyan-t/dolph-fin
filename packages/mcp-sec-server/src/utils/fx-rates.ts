/**
 * FX Rate conversion — fetches exchange rates from a free API (no key required).
 *
 * Used to convert non-USD financial data (e.g., TSMC in TWD, SAP in EUR)
 * to USD for consistent comparison.
 *
 * API: open.er-api.com (free, 166 currencies, updates daily)
 * Cache: 24 hours via file cache
 */

import { CACHE_TTL_FX_RATES } from '@dolph/shared';
import { fileCache } from '../cache/file-cache.js';

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';

interface FXRateCache {
  rates: Record<string, number>;
  fetchedAt: string;
}

/** In-memory cache for the current session (with TTL) */
let memoryCache: FXRateCache | null = null;

/**
 * Check if the memory cache is still fresh (within TTL).
 */
function isMemoryCacheFresh(): boolean {
  if (!memoryCache) return false;
  const age = Date.now() - new Date(memoryCache.fetchedAt).getTime();
  return age < CACHE_TTL_FX_RATES;
}

/**
 * Fetch USD-based exchange rates. Cached for 24 hours.
 * Returns a map of currency code → rate (how many units per 1 USD).
 */
async function getRates(): Promise<Record<string, number>> {
  if (isMemoryCacheFresh()) return memoryCache!.rates;

  // Try disk cache
  const cached = await fileCache.get<FXRateCache>('fx', 'usd_rates', CACHE_TTL_FX_RATES);
  if (cached) {
    memoryCache = cached;
    return cached.rates;
  }

  // Fetch fresh rates
  const response = await fetch(FX_API_URL);
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

  const cache: FXRateCache = {
    rates: data.rates,
    fetchedAt: new Date().toISOString(),
  };

  memoryCache = cache;
  await fileCache.set('fx', 'usd_rates', cache);

  return data.rates;
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
export async function getConversionRate(fromCurrency: string): Promise<number> {
  if (fromCurrency === 'USD') return 1.0;

  const rates = await getRates();
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
export async function convertToUSD(value: number, fromCurrency: string): Promise<number> {
  const rate = await getConversionRate(fromCurrency);
  return value * rate;
}

/**
 * Get a human-readable FX rate string for report annotation.
 * e.g., "1 USD = 31.58 TWD"
 */
export async function getFXRateLabel(currency: string): Promise<string> {
  if (currency === 'USD') return '';
  const rates = await getRates();
  const rate = rates[currency];
  if (!rate) return `(${currency} → USD conversion unavailable)`;
  return `1 USD = ${rate.toFixed(2)} ${currency}`;
}
