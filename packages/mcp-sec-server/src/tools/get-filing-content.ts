/**
 * Tool: get_filing_content
 * Fetches and parses the actual filing document from EDGAR.
 */

import { z } from 'zod';
import type { FilingContent } from '@shawyan/shared';
import { CACHE_TTL_FILING_CONTENT } from '@shawyan/shared';
import { edgarFetchHtml, edgarFetchJson } from '../edgar/client.js';
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

interface FilingIndexJson {
  directory?: {
    item?: Array<{ name?: string }>;
  };
}

function isLikelyIndexUrl(urlStr: string): boolean {
  try {
    const { pathname } = new URL(urlStr);
    return pathname.endsWith('/')
      || pathname.endsWith('-index.htm')
      || pathname.endsWith('-index.html')
      || pathname.endsWith('/index.html')
      || pathname.endsWith('/index.htm');
  } catch {
    return false;
  }
}

function resolveBaseDirectory(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    let path = parsed.pathname;
    if (path.endsWith('/')) {
      return `${parsed.origin}${path}`;
    }
    path = path.replace(/\/[^/]*$/, '/');
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

function isDocCandidate(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('-index.htm') || lower.endsWith('-index.html')) return false;
  if (lower.startsWith('xsl')) return false;
  return lower.endsWith('.htm') || lower.endsWith('.html') || lower.endsWith('.txt');
}

function scoreDocCandidate(name: string, accessionNoDashes: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.endsWith('.htm') || lower.endsWith('.html')) score += 60;
  if (lower.endsWith('.txt')) score += 40;
  if (lower.includes(accessionNoDashes.toLowerCase())) score += 20;
  if (/(10k|10q|8k|20f|6k|40f)/.test(lower)) score += 15;
  if (lower.includes('ex99') || lower.includes('ex-99') || lower.includes('exhibit')) score -= 20;
  return score;
}

async function resolvePrimaryDocumentUrl(accession: string, documentUrl: string): Promise<string | null> {
  const baseDir = resolveBaseDirectory(documentUrl);
  if (!baseDir) return null;

  const jsonUrl = `${baseDir}index.json`;
  const payload = await edgarFetchJson<FilingIndexJson>(jsonUrl);
  const items = payload.directory?.item || [];
  if (items.length === 0) return null;

  const accessionNoDashes = accession.replace(/-/g, '');
  const candidates = items
    .map(i => i.name || '')
    .filter(isDocCandidate);
  if (candidates.length === 0) return null;

  const best = candidates
    .sort((a, b) => scoreDocCandidate(b, accessionNoDashes) - scoreDocCandidate(a, accessionNoDashes))[0];
  if (!best) return null;

  const resolved = `${baseDir}${best}`;
  return isAllowedUrl(resolved) ? resolved : null;
}

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

  // Fetch document content. If search returned an index page URL, resolve
  // and prefer the primary filing document when it has richer content.
  const baseHtml = await edgarFetchHtml(document_url);
  let parsed = parseFilingHtml(baseHtml);
  if (isLikelyIndexUrl(document_url) && parsed.wordCount < 1200) {
    try {
      const primaryUrl = await resolvePrimaryDocumentUrl(accession_number, document_url);
      if (primaryUrl && primaryUrl !== document_url) {
        const primaryHtml = await edgarFetchHtml(primaryUrl);
        const primaryParsed = parseFilingHtml(primaryHtml);
        if (primaryParsed.wordCount > parsed.wordCount) {
          parsed = primaryParsed;
        }
      }
    } catch {
      // Keep base parsed output if primary document resolution fails.
    }
  }

  const { sections, rawText, wordCount } = parsed;
  const cappedRawText = rawText.slice(0, 200000); // cap raw text at 200k chars
  const cappedWordCount = cappedRawText.trim().length > 0
    ? cappedRawText.trim().split(/\s+/).length
    : 0;

  const result: FilingContent = {
    sections: sections.map(s => ({ title: s.title, content: s.content })),
    raw_text: cappedRawText,
    // Report count for the delivered text payload, not the discarded tail.
    word_count: cappedRawText.length === rawText.length ? wordCount : cappedWordCount,
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
