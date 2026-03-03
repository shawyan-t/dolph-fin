/**
 * SEC EDGAR HTTP client with rate limiting and User-Agent header
 */

import { rateLimiter } from '../utils/rate-limiter.js';

function getUserAgent(): string {
  return process.env['FILINGLENS_SEC_USER_AGENT'] || 'FilingLens dev@filinglens.com';
}

export interface EdgarRequestOptions {
  maxRetries?: number;
}

/**
 * Make a rate-limited request to SEC EDGAR
 */
export async function edgarFetch(
  url: string,
  options: EdgarRequestOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimiter.acquire();

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getUserAgent(),
          'Accept': 'application/json, text/html, */*',
        },
      });

      if (response.status === 429) {
        // Rate limited — wait and retry
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
