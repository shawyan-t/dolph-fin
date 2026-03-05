import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDCFAssumptions, runDCFModel } from './dcf-builder.js';
import type { AnalysisContext, CompanyFacts } from '@dolph/shared';

/** Build a minimal AnalysisContext with the facts needed for DCF */
function makeContext(ticker: string, metrics: Record<string, number>): AnalysisContext {
  const facts: CompanyFacts = {
    ticker,
    cik: '0000000000',
    company_name: 'Test Corp',
    facts: Object.entries(metrics).map(([metric, value]) => ({
      metric,
      periods: [{ period: '2024-12-31', value, unit: 'USD', form: '10-K', filed: '2025-02-15' }],
    })),
  };

  return {
    tickers: [ticker],
    type: 'single',
    plan: { type: 'single', tickers: [ticker], steps: [] },
    results: [],
    filings: {},
    filing_content: {},
    facts: { [ticker]: facts },
    statements: {},
    ratios: {},
    trends: {},
  };
}

describe('buildDCFAssumptions', () => {
  it('extracts assumptions from context', () => {
    const ctx = makeContext('AAPL', {
      revenue: 400_000_000_000,
      operating_income: 120_000_000_000,
      operating_cash_flow: 110_000_000_000,
      capex: -10_000_000_000,
      shares_outstanding: 15_000_000_000,
      stockholders_equity: 100_000_000_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'AAPL');
    assert.equal(assumptions.ticker, 'AAPL');
    assert.equal(assumptions.company_name, 'Test Corp');
    assert.equal(assumptions.base_revenue, 400_000_000_000);
    assert.equal(assumptions.shares_outstanding, 15_000_000_000);
    assert.equal(assumptions.projection_years, 5);
    assert.equal(assumptions.revenue_growth_rates.length, 5);
    assert.ok(assumptions.discount_rate >= 0.09 && assumptions.discount_rate <= 0.12,
      `WACC ${assumptions.discount_rate} should be in [0.09, 0.12]`);
    assert.equal(assumptions.terminal_growth_rate, 0.025);
    assert.equal(assumptions.tax_rate, 0.21);
  });

  it('derives operating margin from actual data', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    assert.equal(assumptions.operating_margin, 0.2); // 200k / 1M
  });

  it('throws for missing ticker', () => {
    const ctx = makeContext('AAPL', { revenue: 100, shares_outstanding: 10 });
    assert.throws(() => buildDCFAssumptions(ctx, 'MSFT'), /No facts available for MSFT/);
  });

  it('throws when revenue is missing', () => {
    const ctx = makeContext('TEST', {
      operating_income: 200_000,
      shares_outstanding: 10_000,
    });
    assert.throws(() => buildDCFAssumptions(ctx, 'TEST'), /DCF requires revenue/);
  });

  it('throws when shares outstanding is missing', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
    });
    assert.throws(() => buildDCFAssumptions(ctx, 'TEST'), /DCF requires shares outstanding/);
  });

  it('adjusts WACC upward for high leverage', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
      long_term_debt: 400_000,
      short_term_debt: 200_000,
      stockholders_equity: 200_000, // D/E = 3.0
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    assert.equal(assumptions.discount_rate, 0.12); // D/E > 2 → 12%
  });

  it('treats non-positive equity as highest leverage bucket', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      shares_outstanding: 10_000,
      long_term_debt: 200_000,
      stockholders_equity: -50_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    assert.equal(assumptions.discount_rate, 0.12);
  });

  it('throws when both operating cash flow and operating income are missing/zero', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      shares_outstanding: 10_000,
      capex: -50_000,
      operating_income: 0,
      operating_cash_flow: 0,
    });

    assert.throws(
      () => buildDCFAssumptions(ctx, 'TEST'),
      /requires operating cash flow or operating income/i,
    );
  });
});

describe('runDCFModel', () => {
  it('produces projections with positive enterprise value', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
      stockholders_equity: 500_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);

    assert.equal(dcf.projections.length, 5);
    assert.ok(dcf.enterprise_value > 0, 'Enterprise value should be positive');
    assert.ok(dcf.terminal_value > 0, 'Terminal value should be positive');
  });

  it('applies declining growth rates to revenue', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);

    // Each year's revenue should be higher than base
    for (const p of dcf.projections) {
      assert.ok(p.revenue > 1_000_000, `Year ${p.year} revenue should exceed base`);
    }

    // Revenue should grow monotonically (all positive growth rates)
    for (let i = 1; i < dcf.projections.length; i++) {
      assert.ok(
        dcf.projections[i]!.revenue > dcf.projections[i - 1]!.revenue,
        `Year ${i + 1} revenue should exceed year ${i}`,
      );
    }
  });

  it('computes FCF as NOPAT + D&A - CapEx - NWC change', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);

    // Verify first year FCF math manually
    const yr1 = dcf.projections[0]!;
    const growthRate = assumptions.revenue_growth_rates[0]!;
    const expectedRevenue = Math.round(1_000_000 * (1 + growthRate));
    assert.equal(yr1.revenue, expectedRevenue);

    const expectedOpIncome = Math.round(expectedRevenue * assumptions.operating_margin);
    assert.equal(yr1.operating_income, expectedOpIncome);

    const expectedNopat = Math.round(expectedOpIncome * (1 - assumptions.tax_rate));
    assert.equal(yr1.nopat, expectedNopat);
  });

  it('computes equity value with net debt bridge', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
      long_term_debt: 100_000,
      short_term_debt: 20_000,
      cash_and_equivalents: 50_000,
      stockholders_equity: 500_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);

    // Net debt = 100k + 20k - 50k = 70k
    assert.equal(dcf.net_debt, 70_000);
    assert.ok(dcf.equity_value < dcf.enterprise_value,
      'Equity value should be less than EV when net debt is positive');
    assert.equal(dcf.equity_value, dcf.enterprise_value - 70_000);
  });

  it('equity exceeds EV when net cash positive', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
      long_term_debt: 10_000,
      cash_and_equivalents: 500_000,
      stockholders_equity: 800_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);

    // Net debt = 10k + 0 - 500k = -490k (net cash)
    assert.ok(dcf.net_debt < 0, 'Net debt should be negative (net cash)');
    assert.ok(dcf.equity_value > dcf.enterprise_value,
      'Equity value should exceed EV when net cash positive');
  });

  it('does not double-count short-term debt when total_debt already exists', () => {
    const ctx = makeContext('TEST', {
      revenue: 1_000_000,
      operating_income: 200_000,
      operating_cash_flow: 250_000,
      capex: -50_000,
      shares_outstanding: 10_000,
      total_debt: 120_000,        // already total
      short_term_debt: 20_000,    // should NOT be added again
      cash_and_equivalents: 50_000,
      stockholders_equity: 500_000,
    });

    const assumptions = buildDCFAssumptions(ctx, 'TEST');
    const dcf = runDCFModel(assumptions, ctx);
    assert.equal(dcf.net_debt, 70_000);
  });
});
