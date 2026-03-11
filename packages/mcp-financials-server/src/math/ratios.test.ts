import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRatios } from './ratios.js';
import type { CompanyFacts, RatioName } from '@shawyan/shared';

/** Helper: build a minimal CompanyFacts fixture with period-coherent data */
function makeFacts(metrics: Record<string, number>, period = '2024-12-31'): CompanyFacts {
  return {
    ticker: 'TEST',
    cik: '0000000000',
    company_name: 'Test Corp',
    facts: Object.entries(metrics).map(([metric, value]) => ({
      metric,
      periods: [{ period, value, unit: 'USD', form: '10-K', filed: '2025-02-15' }],
    })),
  };
}

describe('calculateRatios', () => {
  it('computes debt-to-equity', () => {
    const facts = makeFacts({ long_term_debt: 200_000, short_term_debt: 50_000, stockholders_equity: 250_000 });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.name, 'de');
    assert.equal(ratios[0]!.value, 1);
  });

  it('prefers total_debt over debt components when both are available', () => {
    const facts = makeFacts({
      total_debt: 500_000,
      long_term_debt: 200_000,
      short_term_debt: 50_000,
      stockholders_equity: 250_000,
    });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.value, 2);
    assert.equal(ratios[0]!.formula, 'total_debt / stockholders_equity');
  });

  it('computes gross margin', () => {
    const facts = makeFacts({ gross_profit: 400_000, revenue: 1_000_000 });
    const ratios = calculateRatios(facts, ['gross_margin']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.name, 'gross_margin');
    assert.equal(ratios[0]!.value, 0.4);
  });

  it('computes book value per share (bvps)', () => {
    const facts = makeFacts({ stockholders_equity: 1_000_000, shares_outstanding: 100_000 });
    const ratios = calculateRatios(facts, ['bvps']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.name, 'bvps');
    assert.equal(ratios[0]!.value, 10);
  });

  it('returns empty for missing metrics', () => {
    const facts = makeFacts({ revenue: 1_000_000 }); // no gross_profit
    const ratios = calculateRatios(facts, ['gross_margin']);
    assert.equal(ratios.length, 0);
  });

  it('returns null (skips) for zero denominator', () => {
    const facts = makeFacts({ long_term_debt: 500_000, stockholders_equity: 0 });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 0);
  });

  it('continues to older period if latest period is invalid', () => {
    const facts: CompanyFacts = {
      ticker: 'TEST',
      cik: '0000000000',
      company_name: 'Test Corp',
      facts: [
        {
          metric: 'long_term_debt',
          periods: [
            { period: '2024-12-31', value: 600_000, unit: 'USD', form: '10-K', filed: '2025-02-15' },
            { period: '2023-12-31', value: 500_000, unit: 'USD', form: '10-K', filed: '2024-02-15' },
          ],
        },
        {
          metric: 'stockholders_equity',
          periods: [
            { period: '2024-12-31', value: 0, unit: 'USD', form: '10-K', filed: '2025-02-15' },
            { period: '2023-12-31', value: 250_000, unit: 'USD', form: '10-K', filed: '2024-02-15' },
          ],
        },
      ],
    };

    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.period, '2023-12-31');
    assert.equal(ratios[0]!.value, 2);
  });

  it('falls back to total_debt for debt-to-equity when components are unavailable', () => {
    const facts = makeFacts({ total_liabilities: 600_000, stockholders_equity: 200_000 });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 0);
  });

  it('computes debt-to-equity from total_debt fallback', () => {
    const facts = makeFacts({ total_debt: 400_000, stockholders_equity: 200_000 });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.value, 2);
    assert.equal(ratios[0]!.formula, 'total_debt / stockholders_equity');
    assert.equal(ratios[0]!.components['total_debt'], 400_000);
  });

  it('computes all ratios when no filter specified', () => {
    const facts = makeFacts({
      long_term_debt: 400_000,
      short_term_debt: 100_000,
      stockholders_equity: 250_000,
      net_income: 100_000,
      total_assets: 800_000,
      current_assets: 300_000,
      current_liabilities: 150_000,
      inventory: 25_000,
      gross_profit: 400_000,
      revenue: 1_000_000,
      operating_income: 200_000,
      eps_diluted: 2.5,
      shares_outstanding: 100_000,
      operating_cash_flow: 180_000,
      capex: -50_000,
    });
    const ratios = calculateRatios(facts);
    // Should compute all 11 defined ratios
    assert.equal(ratios.length, 11);
    const names = ratios.map(r => r.name);
    assert.ok(names.includes('de'));
    assert.ok(names.includes('bvps'));
    assert.ok(names.includes('fcf'));
  });

  it('computes quick ratio without inventory (inventory defaults to 0)', () => {
    const facts = makeFacts({ current_assets: 300_000, current_liabilities: 150_000 });
    const ratios = calculateRatios(facts, ['quick_ratio']);
    assert.equal(ratios.length, 1);
    assert.equal(ratios[0]!.value, 2);
  });

  it('enforces period coherence — skips ratios with cross-period data', () => {
    const facts: CompanyFacts = {
      ticker: 'TEST',
      cik: '0000000000',
      company_name: 'Test Corp',
      facts: [
        { metric: 'gross_profit', periods: [{ period: '2024-12-31', value: 400_000, unit: 'USD', form: '10-K', filed: '2025-02-15' }] },
        { metric: 'revenue', periods: [{ period: '2023-12-31', value: 1_000_000, unit: 'USD', form: '10-K', filed: '2024-02-15' }] },
      ],
    };
    const ratios = calculateRatios(facts, ['gross_margin']);
    // gross_profit is in 2024, revenue is in 2023 — no period has both, so no ratio
    assert.equal(ratios.length, 0);
  });

  it('includes correct components in output', () => {
    const facts = makeFacts({ long_term_debt: 500_000, short_term_debt: 100_000, stockholders_equity: 200_000 });
    const ratios = calculateRatios(facts, ['de']);
    assert.equal(ratios[0]!.components['long_term_debt'], 500_000);
    assert.equal(ratios[0]!.components['short_term_debt'], 100_000);
    assert.equal(ratios[0]!.components['stockholders_equity'], 200_000);
    assert.equal(ratios[0]!.period, '2024-12-31');
  });
});
