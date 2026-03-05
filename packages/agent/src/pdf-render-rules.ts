/**
 * Deterministic render rules for the premium PDF layout.
 * These functions normalize section content and enforce hard presentation constraints.
 */

export const PDF_RENDER_RULES = {
  cover: {
    maxKpis: 4,
    maxBullets: 3,
  },
  executive: {
    maxWords: 260,
    maxBulletsPerBlock: 2,
  },
  visuals: {
    maxChartsPerPage: 2,
    maxVisualPages: 2,
  },
  tables: {
    maxFrontRows: 8,
    maxAppendixRows: 14,
  },
} as const;

export interface ParsedMetricRow {
  metric: string;
  current: string;
  prior: string;
  change: string;
}

export function normalizeMissingDataMarkdown(markdown: string): string {
  return markdown
    .replace(/\|\s*—\s*\|/g, '| N/A |')
    .replace(/\|\s*-\s*\|/g, '| N/A |');
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstSentences(markdown: string, count: number): string {
  const plain = stripMarkdown(markdown);
  if (!plain) return '';
  const matches = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  return matches.slice(0, count).join(' ').trim();
}

export function extractBullets(markdown: string): string[] {
  const bullets: string[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (m?.[1]) {
      const cleaned = stripMarkdown(m[1]);
      if (cleaned) bullets.push(cleaned);
    }
  }
  return bullets;
}

export function clipBullets(bullets: string[], max: number): string[] {
  return bullets.slice(0, max);
}

export function parseMetricRows(markdown: string): ParsedMetricRow[] {
  const rows: ParsedMetricRow[] = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.length < 2) continue;
    const first = cells[0]!.toLowerCase();
    if (first === 'metric' || first.startsWith(':---') || /^-+$/.test(first)) continue;
    rows.push({
      metric: cells[0] || '',
      current: normalizeDisplayCell(cells[1] || 'N/A'),
      prior: normalizeDisplayCell(cells[2] || 'N/A'),
      change: normalizeDisplayCell(cells[3] || 'N/A'),
    });
  }
  return rows;
}

export function normalizeDisplayCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '—' || trimmed === '-') return 'N/A';
  if (!trimmed) return 'N/A';
  return trimmed;
}

export function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}
