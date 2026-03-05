/**
 * Corrector — re-generates failing NARRATIVE sections using LLM.
 * Only called if code-based validation detects errors (rare with structured output).
 *
 * Key design choices:
 * - Uses the SAME system prompt as narrator for tone consistency
 * - Uses EXACT section ID matching (not .includes())
 * - Never corrects deterministic sections (those are rebuilt by code)
 * - LLM returns only prose content — no headings
 */

import type { ReportSection, ValidationIssue, LLMProvider, AnalysisContext } from '@dolph/shared';
import { DETERMINISTIC_SECTION_IDS } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import { buildDataBlock } from './prompts/narrative.js';

/** Same system prompt as narrator for tone consistency */
const SYSTEM_PROMPT = `You are a senior financial analyst at a top-tier investment bank producing an institutional-grade research report. Write in a neutral, authoritative third-person voice. Use precise quantitative language. Never use superlatives, hedging words, or promotional tone. Every assertion must cite a specific figure from the data. Do NOT output any section titles, headings, or markdown structure — output ONLY the prose content requested.`;

/** Deterministic sections that should never be sent to the LLM for correction */
const DETERMINISTIC_SECTIONS = new Set<string>(DETERMINISTIC_SECTION_IDS);

/**
 * Fix sections that failed validation by regenerating them with the LLM.
 */
export async function correctSections(
  sections: ReportSection[],
  issues: ValidationIssue[],
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
  llm: LLMProvider,
  signal?: AbortSignal,
): Promise<{ correctedSections: ReportSection[]; llmCallCount: number }> {
  let llmCallCount = 0;

  // Group errors by section (exact ID)
  const issuesBySection = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    // Skip deterministic sections — those can't be fixed by LLM
    if (DETERMINISTIC_SECTIONS.has(issue.section)) continue;

    const existing = issuesBySection.get(issue.section) || [];
    existing.push(issue);
    issuesBySection.set(issue.section, existing);
  }

  if (issuesBySection.size === 0) {
    return { correctedSections: sections, llmCallCount: 0 };
  }

  const dataBlock = buildDataBlock(context, insights);
  const correctedSections = [...sections];
  const llmOptions = signal
    ? ({ signal } as Parameters<LLMProvider['generate']>[2])
    : undefined;

  for (const [sectionId, sectionIssues] of issuesBySection) {
    // Exact match — no .includes() fuzzy matching
    const sectionIdx = correctedSections.findIndex(s => s.id === sectionId);

    const issueList = sectionIssues
      .map((issue, i) => `${i + 1}. ${issue.issue}`)
      .join('\n');

    if (sectionIdx === -1) {
      // Missing section — generate fresh
      const prompt = buildCorrectionPrompt(sectionId, '', issueList, dataBlock);
      const response = await llm.generate(prompt, SYSTEM_PROMPT, llmOptions);
      llmCallCount++;

      correctedSections.push({
        id: sectionId,
        title: sectionIdToTitle(sectionId),
        content: response.content.trim(),
      });
    } else {
      // Existing section with issues — regenerate
      const existing = correctedSections[sectionIdx]!;
      const prompt = buildCorrectionPrompt(existing.title, existing.content, issueList, dataBlock);
      const response = await llm.generate(prompt, SYSTEM_PROMPT, llmOptions);
      llmCallCount++;

      correctedSections[sectionIdx] = {
        ...existing,
        content: response.content.trim(),
      };
    }
  }

  return { correctedSections, llmCallCount };
}

function buildCorrectionPrompt(
  sectionTitle: string,
  existingContent: string,
  issueList: string,
  dataBlock: string,
): string {
  const existingBlock = existingContent
    ? `\nCURRENT CONTENT:\n${existingContent}\n`
    : '';

  return `Fix the "${sectionTitle}" section of a financial report.
${existingBlock}
ISSUES TO FIX:
${issueList}

SOURCE DATA:
${dataBlock}

INSTRUCTIONS:
- Rewrite this section to fix all listed issues
- Replace any vague language with specific numbers from the source data
- Every claim must be backed by a specific data point
- Do NOT output any headings or section titles — only the corrected prose content
- Do NOT hallucinate any numbers not present in the source data
- Format large numbers as $X.XB (billions) or $X.XM (millions)

Output ONLY the corrected section content.`;
}

function sectionIdToTitle(id: string): string {
  return id
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
