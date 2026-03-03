/**
 * HTML filing parser — extracts structured sections from SEC filing HTML
 */

import * as cheerio from 'cheerio';
import { FILING_10K_SECTIONS } from '@filinglens/shared';

export interface ParsedSection {
  title: string;
  content: string;
}

/**
 * Parse an SEC filing HTML document and extract meaningful sections.
 * SEC filings are notoriously messy HTML — this handles common patterns.
 */
export function parseFilingHtml(html: string): {
  sections: ParsedSection[];
  rawText: string;
  wordCount: number;
} {
  const $ = cheerio.load(html);

  // Remove scripts, styles, XBRL tags, and navigation
  $('script, style, head, ix\\:header, ix\\:hidden, ix\\:nonfraction, ix\\:nonnumeric').remove();
  $('[style*="display:none"], [style*="display: none"]').remove();

  // Get all text content
  const rawText = $('body').text()
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const wordCount = rawText.split(/\s+/).filter(w => w.length > 0).length;

  // Try to extract named sections from 10-K/10-Q
  const sections = extractSections($, rawText);

  return { sections, rawText, wordCount };
}

/**
 * Extract named sections by searching for Item headings
 */
function extractSections($: cheerio.CheerioAPI, rawText: string): ParsedSection[] {
  const sections: ParsedSection[] = [];

  // Strategy 1: Look for Item headings in the text
  const itemPattern = /\b(Item\s+\d+[A-Z]?)\b[.\s:—–-]*/gi;
  const matches: Array<{ item: string; index: number }> = [];

  let match;
  while ((match = itemPattern.exec(rawText)) !== null) {
    matches.push({ item: match[1]!, index: match.index });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]!;
      const next = matches[i + 1];

      const itemKey = current.item.replace(/\s+/g, ' ').trim();
      const sectionTitle = FILING_10K_SECTIONS[itemKey] || itemKey;

      // Extract content between this heading and the next
      const startIdx = current.index + current.item.length;
      const endIdx = next ? next.index : Math.min(startIdx + 50000, rawText.length);
      const content = rawText.slice(startIdx, endIdx).trim();

      // Skip very short sections (likely table of contents entries)
      if (content.length > 100) {
        sections.push({
          title: `${itemKey}: ${sectionTitle}`,
          content: content.slice(0, 30000), // cap at 30k chars per section
        });
      }
    }
  }

  // If no sections found, create a single section with the full text
  if (sections.length === 0 && rawText.length > 0) {
    sections.push({
      title: 'Full Document',
      content: rawText.slice(0, 100000),
    });
  }

  return sections;
}
