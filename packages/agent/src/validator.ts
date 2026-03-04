/**
 * CODE-BASED validator — no LLM call.
 * Programmatic checks for report quality.
 *
 * Design:
 * - Uses EXACT section ID matching (section.id === required)
 * - Type-aware: uses correct required sections for single vs comparison
 * - Number regex handles $X.XB, $2000M, plain numbers, percentages
 * - Table validation checks for proper markdown table syntax (header + separator)
 * - Deterministic sections skip content-quality checks (they're code-generated)
 */

import type { ReportSection, ValidationResult, ValidationIssue, AnalysisType } from '@dolph/shared';
import {
  REQUIRED_SINGLE_SECTIONS,
  REQUIRED_COMPARISON_SECTIONS,
  DETERMINISTIC_SECTION_IDS,
  FILLER_PHRASES,
} from '@dolph/shared';

/** Sections built deterministically — skip prose quality checks */
const DETERMINISTIC_SECTIONS = new Set<string>(DETERMINISTIC_SECTION_IDS);

/**
 * Validate a generated report using code-based checks.
 * @param sections - The report sections to validate
 * @param reportType - 'single' or 'comparison' — determines required sections
 */
export function validateReport(
  sections: ReportSection[],
  reportType: AnalysisType = 'single',
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const requiredSections = reportType === 'comparison'
    ? REQUIRED_COMPARISON_SECTIONS
    : REQUIRED_SINGLE_SECTIONS;

  // Build a map for O(1) lookup — exact ID match
  const sectionMap = new Map<string, ReportSection>();
  for (const s of sections) {
    sectionMap.set(s.id, s);
  }

  // 1. Check all required sections exist and have content
  for (const required of requiredSections) {
    const section = sectionMap.get(required);
    if (!section) {
      issues.push({
        section: required,
        issue: `Missing required section: ${required}`,
        severity: 'error',
      });
    } else if (section.content.trim().length < 20) {
      // Deterministic sections with empty content haven't been filled yet —
      // this is a pipeline bug, not a validation issue
      if (DETERMINISTIC_SECTIONS.has(required) && section.content.trim().length === 0) {
        issues.push({
          section: required,
          issue: `Deterministic section "${required}" has no content — pipeline did not fill it`,
          severity: 'error',
        });
      } else if (!DETERMINISTIC_SECTIONS.has(required)) {
        issues.push({
          section: required,
          issue: `Section "${required}" is too short (${section.content.trim().length} chars)`,
          severity: 'error',
        });
      }
    }
  }

  // 2. Check narrative sections for filler phrases
  for (const section of sections) {
    if (DETERMINISTIC_SECTIONS.has(section.id)) continue;

    for (const filler of FILLER_PHRASES) {
      if (section.content.toLowerCase().includes(filler.toLowerCase())) {
        issues.push({
          section: section.id,
          issue: `Contains filler phrase: "${filler}". Use specific numbers instead.`,
          severity: 'warning',
        });
      }
    }
  }

  // 3. Check that narrative financial sections contain actual numbers
  // Use the correct sections based on report type
  const narrativeFinancialSections = reportType === 'comparison'
    ? ['relative_strengths', 'analyst_notes', 'executive_summary']
    : ['trend_analysis', 'analyst_notes', 'executive_summary'];

  for (const sectionId of narrativeFinancialSections) {
    const section = sectionMap.get(sectionId);
    if (!section) continue;

    const numberCount = countFinancialNumbers(section.content);
    if (numberCount < 2) {
      issues.push({
        section: sectionId,
        issue: `Section has too few specific numbers (found ${numberCount}, expected at least 2)`,
        severity: 'warning',
      });
    }
  }

  // 4. Check that data sources section has URLs
  const sourceSection = sectionMap.get('data_sources');
  if (sourceSection && sourceSection.content.length > 0) {
    const urlPattern = /https?:\/\/[^\s)]+/g;
    const urls = sourceSection.content.match(urlPattern) || [];
    if (urls.length === 0) {
      issues.push({
        section: 'data_sources',
        issue: 'Data sources section has no URLs',
        severity: 'warning',
      });
    }
  }

  // 5. Check deterministic table sections have actual table syntax
  const tableSections = ['key_metrics', 'financial_statements'];
  for (const sectionId of tableSections) {
    const section = sectionMap.get(sectionId);
    if (!section || section.content.length === 0) continue;

    if (!hasValidMarkdownTable(section.content)) {
      issues.push({
        section: sectionId,
        issue: `Section "${sectionId}" should contain a properly formatted Markdown table`,
        severity: 'warning',
      });
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;

  return {
    pass: errorCount === 0,
    issues,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Count financial numbers in text.
 * Matches: $1.5B, $200M, $1,234, 12.5%, 1,234,567, plain decimals like 0.45
 */
function countFinancialNumbers(text: string): number {
  const patterns = [
    /\$[\d,.]+\s*[TBMK]/gi,       // $1.5B, $200M, $1.2T, $500K
    /\$[\d,.]+/g,                   // $1,234 or $1234.56
    /[\d,.]+%/g,                    // 12.5%, 3.2%
    /\d{1,3}(?:,\d{3})+/g,        // 1,234,567 (comma-separated)
  ];

  const seen = new Set<string>();
  let count = 0;

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      if (!seen.has(match)) {
        seen.add(match);
        count++;
      }
    }
  }

  return count;
}

/**
 * Check if text contains a valid Markdown table (header row + separator row).
 * A valid table has at least: | col | col |\n| --- | --- |
 */
function hasValidMarkdownTable(text: string): boolean {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]!.trim();

    // Current line has pipes (header row)
    if (line.includes('|') && line.split('|').length >= 3) {
      // Next line is the separator (must contain | and ---)
      if (nextLine.includes('|') && /[-:]{3,}/.test(nextLine)) {
        return true;
      }
    }
  }
  return false;
}
