import type {
  ReportSection,
  StructuredNarrativeParagraph,
  StructuredNarrativePayload,
  StructuredNarrativeSection,
} from '@dolph/shared';

const FILLER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhas trended upward\b/gi, 'is above the prior-period level'],
  [/\bhas trended downward\b/gi, 'is below the prior-period level'],
  [/\bshows strong top-line momentum\b/gi, 'shows strong revenue growth'],
  [/\bbroad-based operational momentum\b/gi, 'improvement across the main operating lines'],
  [/\bindicates pricing power\b/gi, 'supports a stronger gross-margin profile'],
  [/\bsolid liquidity profile\b/gi, 'a liquidity position that deserves closer review'],
  [/\bmost important multi-period pattern\b/gi, 'clearest multi-period pattern'],
  [/\bclearest balance-sheet signal\b/gi, 'clearest balance-sheet reference point'],
  [/\bwatch points\b/gi, 'areas to monitor'],
  [/\bclearest relative strength\b/gi, 'most favorable feature'],
  [/\bfinancial stress point\b/gi, 'area of financial pressure'],
  [/\blocked annual basis\b/gi, 'reporting period used in this note'],
  [/\blocked annual history\b/gi, 'annual history shown here'],
  [/\blocked annual period\b/gi, 'reporting period used in this note'],
  [/\blocked annual view\b/gi, 'reporting period used in this note'],
  [/\bcurrent lock\b/gi, 'current reporting period'],
  [/\bcurrent basis\b/gi, 'current reporting period'],
  [/\bgoverned comparison\b/gi, 'filing-based comparison'],
  [/\bquantitative stress signal\b/gi, 'financial stress point'],
  [/\bstrength signal\b/gi, 'positive financial feature'],
  [/\bwatch item\b/gi, 'point of caution'],
];

const BANNED_PATTERNS = [
  /\b(?:top-line momentum|broad-based operational momentum)\b/i,
  /\bhas trended (?:upward|downward)\b/i,
  /\bindicates pricing power\b/i,
  /\b[a-z]+(?:_[a-z0-9]+)+\b/,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function humanizeMetricToken(token: string): string {
  return token
    .split('_')
    .map(part => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stripNarrativeMarkup(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '');
}

function polishSentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ensureTerminalPunctuation(value: string): string {
  if (!value) return value;
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function dedupeSentences(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out.join(' ');
}

function polishParagraphText(value: string): string {
  let text = stripNarrativeMarkup(value);
  for (const [pattern, replacement] of FILLER_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, token => humanizeMetricToken(token));
  text = normalizeWhitespace(text);
  text = dedupeSentences(text);
  text = polishSentenceCase(text);
  text = ensureTerminalPunctuation(text);
  return text;
}

function paragraphKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function mergeShortParagraphs(paragraphs: StructuredNarrativeParagraph[]): StructuredNarrativeParagraph[] {
  const merged: StructuredNarrativeParagraph[] = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.text.trim();
    if (
      merged.length > 0
      && (trimmed.length < 80 || trimmed.split(/\s+/).length < 12)
    ) {
      const prev = merged[merged.length - 1]!;
      prev.text = ensureTerminalPunctuation(prev.text.replace(/[.!?]$/, '')) + ` ${trimmed}`;
      prev.fact_ids = Array.from(new Set([...prev.fact_ids, ...paragraph.fact_ids]));
      continue;
    }
    merged.push({
      text: trimmed,
      fact_ids: Array.from(new Set(paragraph.fact_ids.filter(Boolean))),
    });
  }
  return merged;
}

function dedupeParagraphs(paragraphs: StructuredNarrativeParagraph[]): StructuredNarrativeParagraph[] {
  const seen = new Set<string>();
  const out: StructuredNarrativeParagraph[] = [];
  for (const paragraph of paragraphs) {
    const key = paragraphKey(paragraph.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(paragraph);
  }
  return out;
}

function buildWarnings(paragraphs: StructuredNarrativeParagraph[]): string[] {
  const warnings: string[] = [];
  for (const paragraph of paragraphs) {
    if (BANNED_PATTERNS.some(pattern => pattern.test(paragraph.text))) {
      warnings.push('Contains filler phrasing that should have been removed.');
      break;
    }
  }
  return warnings;
}

function polishSection(section: StructuredNarrativeSection): StructuredNarrativeSection {
  const polishedParagraphs = dedupeParagraphs(
    mergeShortParagraphs(
      section.paragraphs
        .map(paragraph => ({
          text: polishParagraphText(paragraph.text),
          fact_ids: Array.from(new Set(paragraph.fact_ids.filter(Boolean))),
        }))
        .filter(paragraph => paragraph.text.length >= 24),
    ),
  );

  return {
    ...section,
    paragraphs: polishedParagraphs,
    rendered_content: polishedParagraphs.map(paragraph => paragraph.text).join('\n\n'),
    warnings: buildWarnings(polishedParagraphs),
  };
}

export function applyNarrativeQualityPass(
  sections: ReportSection[],
  narrative: StructuredNarrativePayload | undefined,
): { sections: ReportSection[]; narrative: StructuredNarrativePayload | undefined } {
  if (!narrative) return { sections, narrative };

  const polishedSections = narrative.sections.map(polishSection);
  const contentById = new Map(polishedSections.map(section => [section.id, section.rendered_content || '']));

  return {
    sections: sections.map(section => {
      const content = contentById.get(section.id);
      return content === undefined ? section : { ...section, content };
    }),
    narrative: {
      ...narrative,
      sections: polishedSections,
    },
  };
}
