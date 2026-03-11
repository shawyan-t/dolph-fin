import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisContext, CompanyFacts, FinancialStatement } from '@shawyan/shared';
import { analyzeData } from './analyzer.js';

function makeFacts(ticker: string, metricsByPeriod: Record<string, Record<string, number>>): CompanyFacts {
  const byMetric = new Map<string, Array<{ period: string; value: number }>>();
  for (const [period, metrics] of Object.entries(metricsByPeriod)) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (!byMetric.has(metric)) byMetric.set(metric, []);
      byMetric.get(metric)!.push({ period, value });
    }
  }

  return {
    ticker,
    cik: '0000000000',
    company_name: `${ticker} Corp`,
    facts: Array.from(byMetric.entries()).map(([metric, rows]) => ({
      metric,
      periods: rows
        .sort((a, b) => b.period.localeCompare(a.period))
        .map(r => ({
          period: r.period,
          value: r.value,
          unit: 'USD',
          form: '10-K',
          filed: '2026-02-01',
        })),
    })),
  };
}

function makeStatement(
  ticker: string,
  statement_type: FinancialStatement['statement_type'],
  periods: Array<{ period: string; data: Record<string, number> }>,
): FinancialStatement {
  return {
    ticker,
    statement_type,
    period_type: 'annual',
    periods: periods.map(p => ({ period: p.period, filed: '2026-02-01', data: p.data })),
  };
}

function makeContext(
  ticker: string,
  statements: FinancialStatement[],
  facts: CompanyFacts,
): AnalysisContext {
  return {
    tickers: [ticker],
    type: 'single',
    plan: { type: 'single', tickers: [ticker], steps: [] },
    results: [],
    filings: {},
    filing_content: {},
    facts: { [ticker]: facts },
    statements: { [ticker]: statements },
    ratios: { [ticker]: [] },
    trends: { [ticker]: [] },
  };
}

describe('analyzer period lock + completeness', () => {
  it('locks to the best-covered annual period when latest period is sparse', () => {
    const ticker = 'GOOG';
    const income = makeStatement(ticker, 'income', [
      { period: '2025-12-31', data: { net_income: 132_000_000_000, operating_income: 129_000_000_000 } },
      { period: '2024-12-31', data: { revenue: 350_000_000_000, net_income: 100_000_000_000, operating_income: 110_000_000_000 } },
      { period: '2023-12-31', data: { revenue: 307_000_000_000, net_income: 75_000_000_000, operating_income: 85_000_000_000 } },
    ]);
    const balance = makeStatement(ticker, 'balance_sheet', [
      { period: '2024-12-31', data: { total_assets: 450_000_000_000, stockholders_equity: 320_000_000_000 } },
      { period: '2023-12-31', data: { total_assets: 410_000_000_000, stockholders_equity: 290_000_000_000 } },
    ]);
    const cash = makeStatement(ticker, 'cash_flow', [
      { period: '2024-12-31', data: { operating_cash_flow: 130_000_000_000, capex: -30_000_000_000 } },
      { period: '2023-12-31', data: { operating_cash_flow: 110_000_000_000, capex: -28_000_000_000 } },
    ]);
    const facts = makeFacts(ticker, {
      '2025-12-31': { net_income: 132_000_000_000, operating_income: 129_000_000_000 },
      '2024-12-31': { revenue: 350_000_000_000, net_income: 100_000_000_000, operating_income: 110_000_000_000 },
      '2023-12-31': { revenue: 307_000_000_000, net_income: 75_000_000_000, operating_income: 85_000_000_000 },
    });

    const insights = analyzeData(makeContext(ticker, [income, balance, cash], facts))[ticker]!;
    assert.equal(insights.snapshotPeriod, '2024-12-31');
    assert.equal(insights.priorPeriod, '2023-12-31');
    assert.equal(insights.keyMetrics['Revenue']?.current, 350_000_000_000);
    assert.equal(insights.keyMetrics['Net Income']?.current, 100_000_000_000);
    assert.equal(insights.keyMetrics['Revenue']?.prior, 307_000_000_000);
  });

  it('computes prior values for FCF, EPS, and BVPS when inputs exist', () => {
    const ticker = 'AMD';
    const income = makeStatement(ticker, 'income', [
      { period: '2025-12-31', data: { revenue: 34_600_000_000, net_income: 4_330_000_000, eps_diluted: 2.65 } },
      { period: '2024-12-31', data: { revenue: 25_800_000_000, net_income: 1_640_000_000, eps_diluted: 1.00 } },
    ]);
    const balance = makeStatement(ticker, 'balance_sheet', [
      { period: '2025-12-31', data: { stockholders_equity: 63_000_000_000, shares_outstanding: 16_300_000_000 } },
      { period: '2024-12-31', data: { stockholders_equity: 56_000_000_000, shares_outstanding: 16_100_000_000 } },
    ]);
    const cash = makeStatement(ticker, 'cash_flow', [
      { period: '2025-12-31', data: { operating_cash_flow: 9_800_000_000, capex: -800_000_000 } },
      { period: '2024-12-31', data: { operating_cash_flow: 3_040_000_000, capex: -640_000_000 } },
    ]);
    const facts = makeFacts(ticker, {
      '2025-12-31': { revenue: 34_600_000_000, net_income: 4_330_000_000, eps_diluted: 2.65 },
      '2024-12-31': { revenue: 25_800_000_000, net_income: 1_640_000_000, eps_diluted: 1.00 },
    });

    const insights = analyzeData(makeContext(ticker, [income, balance, cash], facts))[ticker]!;
    assert.equal(insights.keyMetrics['Free Cash Flow']?.current, 9_000_000_000);
    assert.equal(insights.keyMetrics['Free Cash Flow']?.prior, 2_400_000_000);
    assert.equal(insights.keyMetrics['Earnings Per Share (Diluted)']?.prior, 1.00);

    const expectedBvpsPrior = 56_000_000_000 / 16_100_000_000;
    assert.ok(Math.abs((insights.keyMetrics['Book Value Per Share']?.prior ?? 0) - expectedBvpsPrior) < 1e-9);
  });

  it('flags gross-profit mapping breaks and excludes gross margin from key metrics', () => {
    const ticker = 'RTX';
    const income = makeStatement(ticker, 'income', [
      {
        period: '2025-12-31',
        data: {
          revenue: 88_600_000_000,
          gross_profit: 2_200_000_000,
          operating_income: 9_300_000_000,
          net_income: 6_000_000_000,
        },
      },
      {
        period: '2024-12-31',
        data: {
          revenue: 80_000_000_000,
          gross_profit: 21_000_000_000,
          operating_income: 8_500_000_000,
          net_income: 5_500_000_000,
        },
      },
    ]);
    const balance = makeStatement(ticker, 'balance_sheet', [
      { period: '2025-12-31', data: { total_assets: 200_000_000_000, total_liabilities: 120_000_000_000, stockholders_equity: 80_000_000_000 } },
      { period: '2024-12-31', data: { total_assets: 195_000_000_000, total_liabilities: 117_000_000_000, stockholders_equity: 78_000_000_000 } },
    ]);
    const cash = makeStatement(ticker, 'cash_flow', [
      { period: '2025-12-31', data: { operating_cash_flow: 11_000_000_000, capex: -2_500_000_000 } },
      { period: '2024-12-31', data: { operating_cash_flow: 10_000_000_000, capex: -2_300_000_000 } },
    ]);
    const facts = makeFacts(ticker, {
      '2025-12-31': { revenue: 88_600_000_000, gross_profit: 2_200_000_000, operating_income: 9_300_000_000 },
      '2024-12-31': { revenue: 80_000_000_000, gross_profit: 21_000_000_000, operating_income: 8_500_000_000 },
    });

    const insights = analyzeData(makeContext(ticker, [income, balance, cash], facts))[ticker]!;
    assert.equal(insights.keyMetrics['Gross Margin'], undefined);
    assert.ok(
      insights.redFlags.some(flag => /gross profit mapping check failed/i.test(flag.flag)),
      'expected gross profit sanity flag',
    );
  });

  it('synthesizes total debt from components and normalizes cash outflow signs', () => {
    const ticker = 'FANG';
    const income = makeStatement(ticker, 'income', [
      { period: '2025-12-31', data: { revenue: 15_000_000_000, net_income: 1_660_000_000, operating_income: 1_270_000_000 } },
      { period: '2024-12-31', data: { revenue: 11_100_000_000, net_income: 3_340_000_000, operating_income: 1_900_000_000 } },
    ]);
    const balance = makeStatement(ticker, 'balance_sheet', [
      { period: '2025-12-31', data: { stockholders_equity: 43_000_000_000, long_term_debt: 13_700_000_000, short_term_debt: 760_000_000 } },
      { period: '2024-12-31', data: { stockholders_equity: 40_000_000_000, long_term_debt: 12_900_000_000, short_term_debt: 700_000_000 } },
    ]);
    const cash = makeStatement(ticker, 'cash_flow', [
      { period: '2025-12-31', data: { operating_cash_flow: 8_760_000_000, capex: 970_000_000, dividends_paid: 1_160_000_000 } },
      { period: '2024-12-31', data: { operating_cash_flow: 6_220_000_000, capex: 740_000_000, dividends_paid: 1_020_000_000 } },
    ]);
    const facts = makeFacts(ticker, {
      '2025-12-31': { revenue: 15_000_000_000, net_income: 1_660_000_000 },
      '2024-12-31': { revenue: 11_100_000_000, net_income: 3_340_000_000 },
    });

    const insights = analyzeData(makeContext(ticker, [income, balance, cash], facts))[ticker]!;
    assert.equal(insights.keyMetrics['Total Debt']?.current, 14_460_000_000);
    assert.ok(Math.abs((insights.keyMetrics['Debt-to-Equity']?.current ?? 0) - (14_460_000_000 / 43_000_000_000)) < 1e-9);
    // Outflow sign normalization should force capex negative in the ledger while keeping FCF deterministic.
    assert.equal(insights.keyMetrics['Capital Expenditures']?.current, -970_000_000);
    assert.equal(insights.keyMetrics['Free Cash Flow']?.current, 7_790_000_000);
  });
});
