/**
 * Narrator — THE ONLY LLM CALL in the pipeline.
 * Takes structured analysis data and generates narrative Markdown sections.
 */

import type { AnalysisContext, ReportSection, LLMProvider } from '@filinglens/shared';
import type { AnalysisInsights } from './analyzer.js';
import { buildNarrativePrompt, buildComparisonNarrativePrompt } from './prompts/narrative.js';

const TONE_PROFILES: Record<string, string> = {
  professional: `You are a senior financial analyst at a top-tier investment bank producing an institutional-grade research report. Write in a neutral, authoritative third-person voice. Use precise quantitative language. Never use superlatives, hedging words, or promotional tone. Every assertion must cite a specific figure from the data. Structure your analysis as you would a sell-side equity research note.`,
};

const DEFAULT_TONE = 'professional';

/**
 * Generate narrative report sections using a single LLM call.
 * This is the ONE step that genuinely needs an LLM.
 */
export async function generateNarrative(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  llm: LLMProvider,
  tone?: string,
): Promise<{ sections: ReportSection[]; llmCallCount: number }> {
  const prompt = context.type === 'comparison'
    ? buildComparisonNarrativePrompt(context, insights)
    : buildNarrativePrompt(context, insights);

  const systemPrompt = TONE_PROFILES[tone || DEFAULT_TONE] || TONE_PROFILES[DEFAULT_TONE]!;
  const response = await llm.generate(prompt, systemPrompt);

  // Parse the Markdown response into sections
  const sections = parseMarkdownSections(response.content);

  // Add data sources section (deterministic, no LLM)
  sections.push(buildDataSourcesSection(context));

  return { sections, llmCallCount: 1 };
}

/**
 * Parse LLM-generated Markdown into ReportSection objects.
 */
function parseMarkdownSections(markdown: string): ReportSection[] {
  const sections: ReportSection[] = [];
  const lines = markdown.split('\n');

  let currentTitle = '';
  let currentId = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      // Save previous section
      if (currentTitle && currentContent.length > 0) {
        sections.push({
          id: currentId,
          title: currentTitle,
          content: currentContent.join('\n').trim(),
        });
      }

      currentTitle = headingMatch[1]!;
      currentId = titleToId(currentTitle);
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentTitle && currentContent.length > 0) {
    sections.push({
      id: currentId,
      title: currentTitle,
      content: currentContent.join('\n').trim(),
    });
  }

  return sections;
}

function titleToId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Build data sources section from context (deterministic).
 */
function buildDataSourcesSection(context: AnalysisContext): ReportSection {
  const sources: string[] = [];

  for (const ticker of context.tickers) {
    const filings = context.filings[ticker] || [];
    for (const filing of filings.slice(0, 3)) {
      sources.push(`- [${ticker} ${filing.filing_type} (${filing.date_filed})](${filing.primary_document_url})`);
    }
  }

  sources.push('');
  sources.push('*All data sourced from SEC EDGAR. This analysis is generated from public SEC filings and is not financial advice.*');

  return {
    id: 'data_sources',
    title: 'Data Sources',
    content: sources.join('\n'),
  };
}
