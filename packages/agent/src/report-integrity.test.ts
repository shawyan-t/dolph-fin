import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMetricChange } from '@dolph/shared';
import { stripMarkdown } from './pdf-render-rules.js';
import { applyDerivedPeriodValues } from './report-facts.js';

describe('report integrity helpers', () => {
  it('preserves economic signs, dates, and hyphenated terms when stripping markdown', () => {
    const input = [
      '## Executive Summary',
      '- Net income was -$743.7K on 2025-06-30 after non-cash adjustments.',
      '- Operating margin was -30.8%.',
    ].join('\n');

    const output = stripMarkdown(input);
    assert.match(output, /-\$743\.7K/);
    assert.match(output, /2025-06-30/);
    assert.match(output, /non-cash/);
    assert.match(output, /-30\.8%/);
    assert.doesNotMatch(output, /^##/);
  });

  it('marks tiny-base and sign-flip changes as not meaningful', () => {
    assert.equal(formatMetricChange(-5195.805194805195, -1_200_000, 231), 'NM');
    assert.equal(formatMetricChange(-3.2409638554216866, -744_000, 332_000), 'NM');
    assert.equal(formatMetricChange(0.34283517548962576, 34_600_000_000, 25_785_000_000), '34.3%');
  });

  it('limits derivations to conservative filing-first metrics only', () => {
    const values: Record<string, number> = {
      gross_profit: 2_000_000,
      cost_of_revenue: 1_000_000,
      operating_income: 500_000,
      depreciation_and_amortization: 68_000,
      depreciation_expense: 68_000,
      amortization_expense: 83_000,
    };

    applyDerivedPeriodValues(values);

    assert.equal(values['revenue'], undefined);
    assert.equal(values['operating_expenses'], undefined);
    assert.equal(values['depreciation_and_amortization'], 68_000);
  });
});
