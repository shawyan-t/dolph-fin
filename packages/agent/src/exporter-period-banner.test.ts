import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Report } from '@shawyan/shared';
import { __test as exporterTest } from './exporter.js';
import { PERIOD_BANNER_SLOT } from './pdf-page-templates.js';

function makeReport(type: Report['type'] = 'single'): Report {
  return {
    id: 'r1',
    tickers: type === 'comparison' ? ['TSM', 'ASML'] : ['TSM'],
    type,
    generated_at: '2026-03-05T00:00:00.000Z',
    sections: [],
    sources: [],
    validation: { pass: true, issues: [], checked_at: '2026-03-05T00:00:00.000Z' },
    metadata: { llm_calls: 0, total_duration_ms: 1, data_points_used: 1 },
  };
}

describe('period banner invariants', () => {
  it('counts non-cover/non-sources pages and slot tokens deterministically', () => {
    const body = [
      '<section class="report-page page-cover"><div></div></section>',
      `<section class="report-page page-executive">${PERIOD_BANNER_SLOT}</section>`,
      `<section class="report-page page-dashboard">${PERIOD_BANNER_SLOT}</section>`,
      '<section class="report-page page-sources"><div></div></section>',
    ].join('\n');

    assert.equal(exporterTest.countNonCoverSourcesPages(body), 2);
    assert.equal(exporterTest.countToken(body, PERIOD_BANNER_SLOT), 2);
  });

  it('fails early when current period is missing', () => {
    const report = makeReport('single');
    const built = exporterTest.buildPeriodBanner(report, {
      TSM: { current: null, prior: '2023-12-31' },
    });

    assert.equal(built.ok, false);
    if (!built.ok) {
      assert.match(built.error, /Period missing/i);
    }
  });

  it('renders banner text with both current and prior labels', () => {
    const report = makeReport('comparison');
    const built = exporterTest.buildPeriodBanner(report, {
      TSM: { current: '2024-12-31', prior: '2023-12-31' },
      ASML: { current: '2025-12-31', prior: '2024-12-31' },
    });

    assert.equal(built.ok, true);
    if (built.ok) {
      assert.match(built.html, /Current period:/i);
      assert.match(built.html, /Prior period:/i);
      assert.match(built.html, /TSM/);
      assert.match(built.html, /ASML/);
    }
  });
});
