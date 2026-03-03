/**
 * Prompt template for LLM correction of report sections
 * that failed validation.
 */

import type { ValidationIssue } from '@filinglens/shared';

export function buildCorrectionPrompt(
  originalSection: string,
  sectionContent: string,
  issues: ValidationIssue[],
  sourceData: string,
): string {
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.issue}`)
    .join('\n');

  return `You are a senior financial analyst fixing issues in a report section.

ORIGINAL SECTION: ${originalSection}
---
${sectionContent}
---

ISSUES FOUND:
${issueList}

SOURCE DATA:
${sourceData}

INSTRUCTIONS:
Rewrite ONLY this section to fix all listed issues.
- Replace any vague language with specific numbers from the source data.
- Fix any incorrect numbers to match the source data.
- Ensure all claims are backed by specific data points.
- Keep the same Markdown formatting.
- Output ONLY the corrected section content, nothing else.`;
}
