/**
 * Narrator — generates narrative report sections via structured LLM calls.
 *
 * Architecture:
 * - Section order, IDs, and titles are defined in code (prompts/narrative.ts)
 * - Each NARRATIVE section gets its own LLM call with a focused prompt
 * - DETERMINISTIC sections (key_metrics, financial_statements, data_sources) skip the LLM
 * - The LLM returns ONLY prose content — never headings, never structure
 * - This eliminates all parsing fragility from the old freeform approach
 */

import type { AnalysisContext, ReportSection, LLMProvider } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import {
  SINGLE_REPORT_SECTIONS,
  COMPARISON_REPORT_SECTIONS,
  buildDataBlock,
  type SectionDef,
  type SectionData,
} from './prompts/narrative.js';

// ── Tone Profiles ─────────────────────────────────────────────

const TONE_PROFILES: Record<string, string> = {
  professional: `You are a senior financial analyst at a top-tier investment bank producing an institutional-grade research report. Write in a neutral, authoritative third-person voice. Use precise quantitative language. Never use superlatives, hedging words, or promotional tone. Every assertion must cite a specific figure from the data. Do NOT output any section titles, headings, or markdown structure — output ONLY the prose content requested.`,
};

const DEFAULT_TONE = 'professional';

// ── Public API ────────────────────────────────────────────────

/**
 * Generate all narrative report sections.
 *
 * Returns an array of ReportSection with exact IDs matching REQUIRED_REPORT_SECTIONS.
 * Deterministic sections have placeholder content — the pipeline fills those in.
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

    // Build section-specific prompt and call LLM
    const prompt = def.buildPrompt!(sectionData);
    const response = await llm.generate(prompt, systemPrompt, options);
    llmCallCount++;

    // Strip any leading heading the LLM may have added despite instructions
    const content = stripLeadingHeading(response.content.trim());

    sections.push({
      id: def.id,
      title: def.title,
      content,
    });
  }

  return { sections, llmCallCount };
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
