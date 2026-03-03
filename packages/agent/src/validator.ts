/**
 * CODE-BASED validator — no LLM call.
 * Programmatic checks for report quality.
 */

import type { ReportSection, ValidationResult, ValidationIssue } from '@filinglens/shared';
import { REQUIRED_REPORT_SECTIONS, FILLER_PHRASES } from '@filinglens/shared';

/**
 * Validate a generated report using code-based checks.
 * No LLM involved — all deterministic.
 */
export function validateReport(
  sections: ReportSection[],
  _sourceData?: Record<string, unknown>,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Check all required sections exist and are non-empty
  for (const required of REQUIRED_REPORT_SECTIONS) {
    const section = sections.find(s => s.id === required || s.id.includes(required));
    if (!section) {
      issues.push({
        section: required,
        issue: `Missing required section: ${required}`,
        severity: 'error',
      });
    } else if (section.content.trim().length < 50) {
      issues.push({
        section: required,
        issue: `Section "${required}" is too short (${section.content.trim().length} chars)`,
        severity: 'error',
      });
    }
  }

  // 2. Check for generic filler phrases
  for (const section of sections) {
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

  // 3. Check that financial sections contain actual numbers
  const financialSections = ['key_metrics', 'trend_analysis', 'financial_statements'];
  for (const sectionId of financialSections) {
    const section = sections.find(s => s.id === sectionId || s.id.includes(sectionId.replace('_', '')));
    if (!section) continue;

    // Count numbers in the section ($ amounts, percentages, plain numbers)
    const numberPattern = /\$[\d,.]+[BMK]?|[\d,.]+%|\d{1,3}(,\d{3})+/g;
    const numberCount = (section.content.match(numberPattern) || []).length;

    if (numberCount < 3) {
      issues.push({
        section: sectionId,
        issue: `Section has too few specific numbers (found ${numberCount}, expected at least 3)`,
        severity: 'warning',
      });
    }
  }

  // 4. Check that data sources section has URLs
  const sourceSection = sections.find(s => s.id === 'data_sources');
  if (sourceSection) {
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

  // 5. Check for tables in metrics/statements sections
  const tableSections = ['key_metrics', 'financial_statements'];
  for (const sectionId of tableSections) {
    const section = sections.find(s => s.id === sectionId || s.id.includes(sectionId.replace('_', '')));
    if (!section) continue;

    if (!section.content.includes('|')) {
      issues.push({
        section: sectionId,
        issue: `Section "${sectionId}" should contain a Markdown table`,
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
