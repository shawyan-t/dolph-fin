/**
 * Tool: get_filing_content
 * Fetches and parses the actual filing document from EDGAR.
 */

import { z } from 'zod';
import type { FilingContent } from '@dolph/shared';
import { CACHE_TTL_FILING_CONTENT } from '@dolph/shared';
import { edgarFetchHtml } from '../edgar/client.js';
import { parseFilingHtml } from '../edgar/parser.js';
import { fileCache } from '../cache/file-cache.js';

/** Allowed hostname suffixes for filing document URLs */
const SEC_ALLOWED_HOSTS = ['.sec.gov'];

function isAllowedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return SEC_ALLOWED_HOSTS.some(suffix => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export const GetFilingContentInput = z.object({
  accession_number: z.string().min(1),
  document_url: z.string().url(),
});

export type GetFilingContentParams = z.infer<typeof GetFilingContentInput>;

export async function getFilingContent(params: GetFilingContentParams): Promise<FilingContent> {
  const { accession_number, document_url } = params;

  if (!isAllowedUrl(document_url)) {
    throw new Error(
      `Rejected URL: only SEC EDGAR URLs (*.sec.gov) are permitted. Got: ${document_url}`,
    );
  }

  // Cache key includes URL hash to prevent collisions for same accession with different docs
  const cacheKey = `${accession_number}_${simpleHash(document_url)}`;

  // Check cache
  const cached = await fileCache.get<FilingContent>('filing_content', cacheKey, CACHE_TTL_FILING_CONTENT);
  if (cached) return cached;

  // Fetch the HTML document
  const html = await edgarFetchHtml(document_url);

  // Parse it
  const { sections, rawText, wordCount } = parseFilingHtml(html);

  const result: FilingContent = {
    sections: sections.map(s => ({ title: s.title, content: s.content })),
    raw_text: rawText.slice(0, 200000), // cap raw text at 200k chars
    word_count: wordCount,
  };

  // Cache
  await fileCache.set('filing_content', cacheKey, result);

  return result;
}

/** Simple djb2 string hash for cache key differentiation */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
