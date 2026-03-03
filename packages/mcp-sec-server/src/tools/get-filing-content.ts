/**
 * Tool: get_filing_content
 * Fetches and parses the actual filing document from EDGAR.
 */

import { z } from 'zod';
import type { FilingContent } from '@filinglens/shared';
import { CACHE_TTL_FILING_CONTENT } from '@filinglens/shared';
import { edgarFetchHtml } from '../edgar/client.js';
import { parseFilingHtml } from '../edgar/parser.js';
import { fileCache } from '../cache/file-cache.js';

export const GetFilingContentInput = z.object({
  accession_number: z.string().min(1),
  document_url: z.string().url(),
});

export type GetFilingContentParams = z.infer<typeof GetFilingContentInput>;

export async function getFilingContent(params: GetFilingContentParams): Promise<FilingContent> {
  const { accession_number, document_url } = params;
  const cacheKey = accession_number;

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
