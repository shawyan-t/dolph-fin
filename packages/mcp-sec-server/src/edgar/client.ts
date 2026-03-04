/**
 * SEC EDGAR HTTP client with rate limiting, timeout, and User-Agent header.
 *
 * All requests have a hard timeout (default 30s) via AbortController
 * to prevent infinite hangs under provider outage.
 */

import { rateLimiter } from '../utils/rate-limiter.js';

function getUserAgent(): string {
  return process.env['DOLPH_SEC_USER_AGENT'] || 'Dolph dev@dolph.finance';
}

/** Per-request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

export interface EdgarRequestOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Make a rate-limited request to SEC EDGAR with timeout.
 */
export async function edgarFetch(
  url: string,
  options: EdgarRequestOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getUserAgent(),
          'Accept': 'application/json, text/html, */*',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!response.ok && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);

      // Convert AbortError to a more descriptive timeout error
      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`EDGAR request timed out after ${timeoutMs}ms: ${url}`);
      }

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

/**
 * Fetch JSON from EDGAR
 */
export async function edgarFetchJson<T>(url: string): Promise<T> {
  const response = await edgarFetch(url);
  if (!response.ok) {
    throw new Error(`EDGAR API error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Fetch HTML content from EDGAR
 */
export async function edgarFetchHtml(url: string): Promise<string> {
  const response = await edgarFetch(url);
  if (!response.ok) {
    throw new Error(`EDGAR fetch error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}
