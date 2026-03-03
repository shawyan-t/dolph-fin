/**
 * Corrector — re-generates failing sections using LLM.
 * Only called if code-based validation fails (rare).
 */

import type { ReportSection, ValidationIssue, LLMProvider, AnalysisContext } from '@filinglens/shared';
import { buildCorrectionPrompt } from './prompts/correction.js';
import type { AnalysisInsights } from './analyzer.js';

/**
 * Fix sections that failed validation by regenerating them with the LLM.
 * Returns corrected sections and the number of LLM calls made.
 */
export async function correctSections(
  sections: ReportSection[],
  issues: ValidationIssue[],
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  llm: LLMProvider,
): Promise<{ correctedSections: ReportSection[]; llmCallCount: number }> {
  let llmCallCount = 0;

  // Group issues by section
  const issuesBySection = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (issue.severity !== 'error') continue; // Only fix errors, not warnings
    const existing = issuesBySection.get(issue.section) || [];
    existing.push(issue);
    issuesBySection.set(issue.section, existing);
  }

  // No errors to fix
  if (issuesBySection.size === 0) {
    return { correctedSections: sections, llmCallCount: 0 };
  }

  // Build source data summary for correction context
  const sourceData = buildSourceDataSummary(context, insights);

  // Correct each failing section
  const correctedSections = [...sections];

  for (const [sectionId, sectionIssues] of issuesBySection) {
    const sectionIdx = correctedSections.findIndex(
      s => s.id === sectionId || s.id.includes(sectionId),
    );

    if (sectionIdx === -1) {
      // Section is missing — need to generate it fresh
      const prompt = buildCorrectionPrompt(
        sectionId,
        '', // no existing content
        sectionIssues,
        sourceData,
      );

      const response = await llm.generate(prompt);
      llmCallCount++;

      correctedSections.push({
        id: sectionId,
        title: sectionId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        content: response.content,
      });
    } else {
      // Section exists but has issues — regenerate
      const existing = correctedSections[sectionIdx]!;
      const prompt = buildCorrectionPrompt(
        existing.title,
        existing.content,
        sectionIssues,
        sourceData,
      );

      const response = await llm.generate(prompt);
      llmCallCount++;

      correctedSections[sectionIdx] = {
        ...existing,
        content: response.content,
      };
    }
  }

  return { correctedSections, llmCallCount };
}

function buildSourceDataSummary(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const lines: string[] = [];

  for (const ticker of context.tickers) {
    const tickerInsights = insights[ticker];
    if (!tickerInsights) continue;

    lines.push(`# ${ticker} Key Data`);

    for (const [name, data] of Object.entries(tickerInsights.keyMetrics)) {
      lines.push(`${name}: ${data.current} (${data.unit})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
