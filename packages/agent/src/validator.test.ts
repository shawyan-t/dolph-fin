import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport } from './validator.js';
import type { ReportSection } from '@dolph/shared';

/** Helper: build a section with enough content to pass length checks */
function section(id: string, content?: string): ReportSection {
  return {
    id,
    title: id.replace(/_/g, ' '),
    content: content ?? `This is substantive content for ${id} with $1.5B revenue and 12.5% growth and more details to pass all checks.`,
  };
}

/** Build a valid markdown table for deterministic sections */
function tableContent(): string {
  return '| Metric | Value |\n| --- | --- |\n| Revenue | $1.5B |\n| Net Income | $200M |';
}

describe('validateReport — single mode', () => {
  it('passes when all required sections present with content', () => {
    const sections: ReportSection[] = [
      section('executive_summary'),
      section('key_metrics', tableContent()),
      section('trend_analysis'),
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1 and https://sec.gov/filing2'),
    ];
    const result = validateReport(sections, 'single');
    assert.equal(result.pass, true);
    const errors = result.issues.filter(i => i.severity === 'error');
    assert.equal(errors.length, 0);
  });

  it('fails when a required section is missing', () => {
    const sections: ReportSection[] = [
      section('executive_summary'),
      section('key_metrics', tableContent()),
      // missing: trend_analysis
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1'),
    ];
    const result = validateReport(sections, 'single');
    assert.equal(result.pass, false);
    const missing = result.issues.find(i => i.issue.includes('trend_analysis'));
    assert.ok(missing);
    assert.equal(missing!.severity, 'error');
  });

  it('fails when section content is too short', () => {
    const sections: ReportSection[] = [
      section('executive_summary', 'Too short'),
      section('key_metrics', tableContent()),
      section('trend_analysis'),
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1'),
    ];
    const result = validateReport(sections, 'single');
    assert.equal(result.pass, false);
  });

  it('warns on filler phrases', () => {
    const sections: ReportSection[] = [
      section('executive_summary', 'The company is growing steadily with $1.5B revenue and 12% margin and continues operations.'),
      section('key_metrics', tableContent()),
      section('trend_analysis'),
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1'),
    ];
    const result = validateReport(sections, 'single');
    const fillerWarning = result.issues.find(i => i.issue.includes('filler phrase'));
    assert.ok(fillerWarning);
    assert.equal(fillerWarning!.severity, 'warning');
  });
});

describe('validateReport — comparison mode', () => {
  it('requires relative_strengths instead of trend_analysis', () => {
    const sections: ReportSection[] = [
      section('executive_summary'),
      section('key_metrics', tableContent()),
      section('relative_strengths'),
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1'),
    ];
    const result = validateReport(sections, 'comparison');
    assert.equal(result.pass, true);
    const errors = result.issues.filter(i => i.severity === 'error');
    assert.equal(errors.length, 0);
  });

  it('fails comparison mode when relative_strengths is missing', () => {
    const sections: ReportSection[] = [
      section('executive_summary'),
      section('key_metrics', tableContent()),
      section('trend_analysis'), // wrong section for comparison
      section('risk_factors'),
      section('financial_statements', tableContent()),
      section('analyst_notes'),
      section('data_sources', 'Sources: https://sec.gov/filing1'),
    ];
    const result = validateReport(sections, 'comparison');
    assert.equal(result.pass, false);
    const missing = result.issues.find(i => i.issue.includes('relative_strengths'));
    assert.ok(missing);
  });
});
