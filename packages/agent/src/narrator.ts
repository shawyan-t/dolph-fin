/**
 * Narrator — generates narrative report sections via structured LLM calls.
 *
 * Architecture:
 * - Section order, IDs, and titles are defined in code (prompts/narrative.ts)
 * - Each NARRATIVE section gets its own LLM call with a focused prompt
 * - DETERMINISTIC sections (key_metrics, financial_statements, data_sources) skip the LLM
 * - The LLM returns ONLY prose content — never headings, never structure
 * - Section chaining: previously generated sections are passed as context to
 *   subsequent calls for narrative coherence across the full document
 */

import type {
  AnalysisContext,
  LLMProvider,
  ReportSection,
  ReportingPolicy,
  StructuredNarrativePayload,
  StructuredNarrativeSection,
} from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import {
  SINGLE_REPORT_SECTIONS,
  COMPARISON_REPORT_SECTIONS,
  buildDataBlock,
  type SectionData,
} from './prompts/narrative.js';

// ── Tone Profiles ─────────────────────────────────────────────

const TONE_PROFILES: Record<string, string> = {
  professional: `You are a senior financial analyst at a top-tier investment bank producing an institutional-grade research report. Write in a neutral, authoritative third-person voice. Use precise quantitative language. Never use superlatives, hedging words, or promotional tone. Every assertion must cite a specific figure from the data.

Your writing should read like a well-crafted research note: each paragraph flows logically into the next, financial data points are woven into analysis rather than listed, and the overall document tells a coherent story about the company's financial position. Connect the numbers to what they mean for the business — do not merely restate them.

When risk factors or filing excerpts are provided, reference real-world context such as market conditions, competitive dynamics, or regulatory environment to ground the analysis. Avoid generic platitudes. The tone should be that of an experienced financial insider who synthesizes complex information into clear, actionable narrative.

Do NOT output any section titles, headings, or markdown structure unless specifically requested in the section instructions. Output ONLY the prose content requested.`,
};

const DEFAULT_TONE = 'professional';

/** Per-section max token overrides (executive summary gets more room) */
const SECTION_MAX_TOKENS: Record<string, number> = {
  executive_summary: 8192,
  analyst_notes: 6144,
};
const DEFAULT_MAX_TOKENS = 4096;

// ── Public API ────────────────────────────────────────────────

/**
 * Generate all narrative report sections.
 *
 * Returns an array of ReportSection with exact IDs matching REQUIRED_REPORT_SECTIONS.
 * Deterministic sections have placeholder content — the pipeline fills those in.
 *
 * Section chaining: each LLM call receives the content of all previously
 * generated narrative sections, ensuring the final document reads as a
 * coherent whole with no contradictions.
 */
export async function generateNarrative(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  llm: LLMProvider,
  tone?: string,
  options?: { temperature?: number; signal?: AbortSignal },
): Promise<{ sections: ReportSection[]; llmCallCount: number }> {
  const sectionDefs = context.type === 'comparison'
    ? COMPARISON_REPORT_SECTIONS
    : SINGLE_REPORT_SECTIONS;

  const systemPrompt = TONE_PROFILES[tone || DEFAULT_TONE] || TONE_PROFILES[DEFAULT_TONE]!;
  const dataBlock = buildDataBlock(context, insights);
  const ticker = context.tickers[0]!;
  const companyName = context.facts[ticker]?.company_name || ticker;
  const fxNote = context.facts[ticker]?.fx_note || '';

  const sectionData: SectionData = {
    ticker,
    companyName,
    fxNote,
    dataBlock,
    context,
    insights,
  };

  const sections: ReportSection[] = [];
  let llmCallCount = 0;

  // Accumulate prior sections for coherence chaining
  const priorSections: Array<{ id: string; title: string; content: string }> = [];

  for (const def of sectionDefs) {
    if (def.deterministic) {
      // Placeholder — pipeline will replace with deterministic content
      sections.push({
        id: def.id,
        title: def.title,
        content: '',
      });
      continue;
    }

    // Inject prior sections into section data for coherence
    const enrichedData: SectionData = { ...sectionData, priorSections: [...priorSections] };

    // Build section-specific prompt and call LLM
    const prompt = def.buildPrompt!(enrichedData);
    const sectionMaxTokens = SECTION_MAX_TOKENS[def.id] ?? DEFAULT_MAX_TOKENS;
    const response = await llm.generate(prompt, systemPrompt, {
      ...options,
      maxTokens: sectionMaxTokens,
    });
    llmCallCount++;

    // Strip any leading heading the LLM may have added despite instructions
    const content = stripLeadingHeading(response.content.trim());

    sections.push({
      id: def.id,
      title: def.title,
      content,
    });

    // Accumulate for next section's context
    priorSections.push({ id: def.id, title: def.title, content });
  }

  return { sections, llmCallCount };
}

export async function generateExecutiveSummaryOnly(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  llm: LLMProvider,
  tone?: string,
  options?: { temperature?: number; signal?: AbortSignal },
  policy?: ReportingPolicy,
): Promise<{ section: ReportSection; llmCallCount: number; narrative: StructuredNarrativePayload }> {
  const sectionDefs = context.type === 'comparison'
    ? COMPARISON_REPORT_SECTIONS
    : SINGLE_REPORT_SECTIONS;
  const def = sectionDefs.find(section => section.id === 'executive_summary');
  if (!def?.buildPrompt) {
    throw new Error('Executive summary prompt is not configured.');
  }

  const systemPrompt = TONE_PROFILES[tone || DEFAULT_TONE] || TONE_PROFILES[DEFAULT_TONE]!;
  const ticker = context.tickers[0]!;
  const companyName = context.facts[ticker]?.company_name || ticker;
  const fxNote = context.facts[ticker]?.fx_note || '';
  const sectionData: SectionData = {
    ticker,
    companyName,
    fxNote,
    dataBlock: buildDataBlock(context, insights),
    context,
    insights,
  };

  const response = await llm.generate(def.buildPrompt(sectionData), systemPrompt, {
    ...options,
    maxTokens: SECTION_MAX_TOKENS[def.id] ?? DEFAULT_MAX_TOKENS,
    jsonMode: true,
  });

  const structured = parseStructuredExecutiveSummary(
    response.content,
    def.id,
    def.title,
    allowedFactIds(insights),
  );

  return {
    section: {
      id: def.id,
      title: def.title,
      content: structured.sections[0]?.paragraphs.map(p => p.text).join('\n\n') || stripLeadingHeading(response.content.trim()),
    },
    llmCallCount: 1,
    narrative: structured,
  };
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Strip any leading markdown heading the LLM may add despite instructions.
 * Handles #, ##, ###, #### prefixes.
 */
function stripLeadingHeading(content: string): string {
  const lines = content.split('\n');
  // Strip leading blank lines
  while (lines.length > 0 && lines[0]!.trim() === '') {
    lines.shift();
  }
  // If first line is a heading, remove it
  if (lines.length > 0 && /^#{1,4}\s+/.test(lines[0]!)) {
    lines.shift();
    // Also strip blank line after removed heading
    while (lines.length > 0 && lines[0]!.trim() === '') {
      lines.shift();
    }
  }
  return lines.join('\n').trim();
}

function parseStructuredExecutiveSummary(
  raw: string,
  id: string,
  title: string,
  validFactIds: Set<string>,
): StructuredNarrativePayload {
  const parsed = extractJsonObject(raw);
  if (!parsed || !Array.isArray(parsed['paragraphs'])) {
    throw new Error('Structured executive summary did not return the required JSON payload.');
  }

  const paragraphs = parsed['paragraphs']
    .filter((item: unknown): item is { text?: unknown; fact_ids?: unknown } => typeof item === 'object' && item !== null)
    .map(item => ({
      text: typeof item.text === 'string' ? item.text.trim() : '',
      fact_ids: Array.isArray(item.fact_ids)
        ? item.fact_ids.filter((factId): factId is string => typeof factId === 'string' && validFactIds.has(factId))
        : [],
    }))
    .filter(item => item.text.length > 0);

  if (paragraphs.length === 0 || paragraphs.some(item => item.fact_ids.length === 0)) {
    throw new Error('Structured executive summary contained empty paragraphs or unsupported fact references.');
  }

  const section: StructuredNarrativeSection = {
    id,
    title,
    rendered_content: paragraphs.map(paragraph => paragraph.text).join('\n\n'),
    paragraphs,
  };

  return {
    mode: 'structured_llm',
    sections: [section],
  };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const direct = tryParseJson(raw.trim());
  if (direct) return direct;

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return tryParseJson(fenced.trim());

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParseJson(raw.slice(start, end + 1));
  }

  return null;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function allowedFactIds(insights: Record<string, AnalysisInsights>): Set<string> {
  const ids = new Set<string>();
  for (const insight of Object.values(insights)) {
    for (const key of Object.keys(insight.canonicalFacts || {})) {
      ids.add(key);
    }
  }
  return ids;
}
