import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisContext, CompanyFacts, FinancialStatement, Report } from '@dolph/shared';
import { runDeterministicQAGates } from './deterministic-qa.js';
import { buildCanonicalReportPackage } from './canonical-report-package.js';


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

function makeContext(ticker: string): AnalysisContext {
  const income = makeStatement(ticker, 'income', [
    { period: '2025-12-31', data: { revenue: 34_600_000_000, net_income: 4_330_000_000, operating_income: 3_690_000_000, eps_diluted: 2.65 } },
    { period: '2024-12-31', data: { revenue: 25_785_000_000, net_income: 1_641_000_000, operating_income: 653_000_000, eps_diluted: 1.0 } },
  ]);
  const balance = makeStatement(ticker, 'balance_sheet', [
    { period: '2025-12-31', data: { stockholders_equity: 63_000_000_000, shares_outstanding: 1_636_000_000, total_assets: 80_000_000_000, total_liabilities: 17_000_000_000, current_assets: 26_900_000_000, current_liabilities: 9_460_000_000, inventory: 7_920_000_000, total_debt: 3_250_000_000 } },
    { period: '2024-12-31', data: { stockholders_equity: 56_000_000_000, shares_outstanding: 1_592_000_000, total_assets: 73_000_000_000, total_liabilities: 17_000_000_000, current_assets: 24_900_000_000, current_liabilities: 8_500_000_000, inventory: 7_800_000_000, total_debt: 3_200_000_000 } },
  ]);
  const cash = makeStatement(ticker, 'cash_flow', [
    { period: '2025-12-31', data: { operating_cash_flow: 7_709_000_000, capex: -974_000_000 } },
    { period: '2024-12-31', data: { operating_cash_flow: 3_041_000_000, capex: -636_000_000 } },
  ]);

  const facts = makeFacts(ticker, {
    '2025-12-31': { revenue: 34_600_000_000, net_income: 4_330_000_000, operating_cash_flow: 7_709_000_000, capex: -974_000_000, eps_diluted: 2.65, stockholders_equity: 63_000_000_000, shares_outstanding: 1_636_000_000 },
    '2024-12-31': { revenue: 25_785_000_000, net_income: 1_641_000_000, operating_cash_flow: 3_041_000_000, capex: -636_000_000, eps_diluted: 1.0, stockholders_equity: 56_000_000_000, shares_outstanding: 1_592_000_000 },
  });

  return {
    tickers: [ticker],
    type: 'single',
    plan: { type: 'single', tickers: [ticker], steps: [] },
    results: [],
    filings: {},
    filing_content: {},
    facts: { [ticker]: facts },
    statements: { [ticker]: [income, balance, cash] },
    ratios: { [ticker]: [] },
    trends: { [ticker]: [] },
  };
}

function makeReport(keyMetrics: string, executive: string): Report {
  return {
    id: 'r1',
    tickers: ['AMD'],
    type: 'single',
    generated_at: '2026-03-05T00:00:00.000Z',
    sections: [
      { id: 'executive_summary', title: 'Executive Summary', content: executive },
      { id: 'key_metrics', title: 'Key Metrics', content: keyMetrics },
      { id: 'trend_analysis', title: 'Trend Analysis', content: '' },
      { id: 'risk_factors', title: 'Risk Factors', content: '' },
      { id: 'analyst_notes', title: 'Analyst Notes', content: '' },
      { id: 'financial_statements', title: 'Financial Statements', content: '' },
      { id: 'data_sources', title: 'Data Sources', content: '' },
    ],
    sources: [],
    validation: { pass: true, issues: [], checked_at: '2026-03-05T00:00:00.000Z' },
    metadata: { llm_calls: 0, total_duration_ms: 1, data_points_used: 1 },
  };
}

function makeComparisonReport(keyMetrics: string, executive: string): Report {
  return {
    id: 'r2',
    tickers: ['AMD', 'INTC'],
    type: 'comparison',
    generated_at: '2026-03-05T00:00:00.000Z',
    sections: [
      { id: 'executive_summary', title: 'Executive Summary', content: executive },
      { id: 'key_metrics', title: 'Key Metrics', content: keyMetrics },
      { id: 'relative_strengths', title: 'Relative Strengths', content: '' },
      { id: 'risk_factors', title: 'Risk Factors', content: '' },
      { id: 'analyst_notes', title: 'Analyst Notes', content: '' },
      { id: 'financial_statements', title: 'Financial Statements', content: '' },
      { id: 'data_sources', title: 'Data Sources', content: '' },
    ],
    sources: [],
    validation: { pass: true, issues: [], checked_at: '2026-03-05T00:00:00.000Z' },
    metadata: { llm_calls: 0, total_duration_ms: 1, data_points_used: 1 },
  };
}

function makeComparisonContext(): AnalysisContext {
  const amd = makeContext('AMD');
  const intc = makeContext('INTC');
  intc.statements['INTC']![0]!.periods[0]!.data['revenue'] = 54_200_000_000;
  intc.statements['INTC']![0]!.periods[0]!.data['net_income'] = 9_100_000_000;
  intc.statements['INTC']![2]!.periods[0]!.data['operating_cash_flow'] = 12_000_000_000;
  intc.facts['INTC'] = makeFacts('INTC', {
    '2025-12-31': {
      revenue: 54_200_000_000,
      net_income: 9_100_000_000,
      operating_cash_flow: 12_000_000_000,
      capex: -3_000_000_000,
      eps_diluted: 2.1,
      stockholders_equity: 110_000_000_000,
      shares_outstanding: 4_300_000_000,
    },
    '2024-12-31': {
      revenue: 52_000_000_000,
      net_income: 7_300_000_000,
      operating_cash_flow: 10_000_000_000,
      capex: -2_700_000_000,
      eps_diluted: 1.7,
      stockholders_equity: 102_000_000_000,
      shares_outstanding: 4_200_000_000,
    },
  });

  return {
    tickers: ['AMD', 'INTC'],
    type: 'comparison',
    plan: { type: 'comparison', tickers: ['AMD', 'INTC'], steps: [] },
    results: [],
    filings: {},
    filing_content: {},
    facts: { ...amd.facts, ...intc.facts },
    statements: { ...amd.statements, ...intc.statements },
    ratios: { ...amd.ratios, ...intc.ratios },
    trends: { ...amd.trends, ...intc.trends },
  };
}

function runQA(report: Report, context: AnalysisContext) {
  return runDeterministicQAGates(report, context, buildCanonicalReportPackage(context));
}

describe('deterministic QA gates', () => {
  it('requires a sealed canonical package instead of silently recomputing one', () => {
    const context = makeContext('AMD');
    const report = makeReport('', '');
    assert.throws(
      () => runDeterministicQAGates(report, context, undefined as any),
      /sealed canonical report package/i,
    );
  });

  it('fails no-fake-NA when dashboard marks computable prior as N/A', () => {
    const context = makeContext('AMD');
    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
        '| Free Cash Flow | $6.74B | N/A | N/A |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(qa.pass, false);
    assert.ok(qa.failures.some(f => f.gate === 'data.no_fake_na' && /Free Cash Flow/i.test(f.source)));
  });

  it('fails when large share-basis drift is unlabeled and lacks corporate-action evidence', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![0]!.periods[0]!.data['net_income'] = 4_330_000_000;
    context.statements['AMD']![0]!.periods[0]!.data['eps_diluted'] = 2.0;
    context.statements['AMD']![1]!.periods[0]!.data['shares_outstanding'] = 2_800_000_000; // +76% jump vs prior
    context.statements['AMD']![1]!.periods[1]!.data['shares_outstanding'] = 1_592_000_000;
    const sharesFact = context.facts['AMD']!.facts.find(f => f.metric === 'shares_outstanding');
    if (sharesFact) {
      const current = sharesFact.periods.find(p => p.period === '2025-12-31');
      const prior = sharesFact.periods.find(p => p.period === '2024-12-31');
      if (current) current.value = 2_800_000_000;
      if (prior) prior.value = 1_592_000_000;
    }
    context.filing_content['AMD'] = { sections: [], raw_text: '', word_count: 0 };

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(qa.pass, false);
    assert.ok(
      qa.failures.some(f => f.source.includes('shares_outstanding') || f.source.includes('share_basis')),
      'expected share basis validation failure',
    );
  });

  it('accepts a large period-end share change when diluted weighted shares corroborate the same move and labels are present', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![1]!.periods[0]!.data['shares_outstanding'] = 2_800_000_000;
    context.statements['AMD']![1]!.periods[1]!.data['shares_outstanding'] = 1_592_000_000;
    context.statements['AMD']![0]!.periods[0]!.data['weighted_avg_shares_diluted'] = 2_620_000_000;
    context.statements['AMD']![0]!.periods[1]!.data['weighted_avg_shares_diluted'] = 1_520_000_000;

    const sharesFact = context.facts['AMD']!.facts.find(f => f.metric === 'shares_outstanding');
    if (sharesFact) {
      const current = sharesFact.periods.find(p => p.period === '2025-12-31');
      const prior = sharesFact.periods.find(p => p.period === '2024-12-31');
      if (current) current.value = 2_800_000_000;
      if (prior) prior.value = 1_592_000_000;
    }
    context.facts['AMD']!.facts.push({
      metric: 'weighted_avg_shares_diluted',
      periods: [
        { period: '2025-12-31', value: 2_620_000_000, unit: 'shares', form: '10-K', filed: '2026-02-01' },
        { period: '2024-12-31', value: 1_520_000_000, unit: 'shares', form: '10-K', filed: '2026-02-01' },
      ],
    });
    context.filing_content['AMD'] = { sections: [], raw_text: '', word_count: 0 };

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '*Per-share basis: EPS uses diluted weighted-average shares; BVPS uses period-end shares outstanding.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(
      qa.failures.some(f => f.source.includes('shares_outstanding')),
      false,
      'corroborated share-count change should not fail the shares-outstanding sanity gate',
    );
  });

  it('normalizes outflow sign conventions before sanity validation', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![2]!.periods[0]!.data['dividends_paid'] = 1_160_000_000; // raw positive outflow
    context.statements['AMD']![2]!.periods[0]!.data['share_repurchases'] = 2_000_000_000; // raw positive outflow

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '*Per-share basis: EPS uses diluted weighted-average shares; BVPS uses period-end shares outstanding.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(
      qa.failures.some(f => /dividends_paid|share_repurchases/.test(f.source)),
      false,
      'outflow-sign failure should not trigger after normalization',
    );
  });

  it('enforces cross-section equality in comparison reports', () => {
    const context = makeComparisonContext();
    const report = makeComparisonReport(
      [
        'Each company is shown at its own latest annual filing period; fiscal year-ends can differ across peers.',
        '| Metric | AMD | INTC |',
        '|:---|---:|---:|',
        '| Revenue | $34.6B | N/A |',
        '| Net Income | $4.3B | $9.1B |',
        '| Operating Cash Flow | $7.7B | $12.0B |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(qa.pass, false);
    assert.ok(
      qa.failures.some(f => f.gate === 'data.no_fake_na' && f.source.includes('comparison:INTC:Revenue')),
      'expected no-fake-NA failure for comparison metric',
    );
  });

  it('fails comparison leverage-ranking claims when a peer lacks debt-to-equity', () => {
    const context = makeComparisonContext();
    delete context.statements['INTC']![1]!.periods[0]!.data['total_debt'];
    delete context.statements['INTC']![1]!.periods[1]!.data['total_debt'];

    const report = makeComparisonReport(
      [
        'Each company is shown at its own latest annual filing period; fiscal year-ends can differ across peers.',
        '| Metric | AMD | INTC |',
        '|:---|---:|---:|',
        '| Revenue | $34.6B | $54.2B |',
        '| Net Income | $4.3B | $9.1B |',
      ].join('\n'),
      'AMD has the most conservative leverage profile in the peer set.',
    );

    const qa = runQA(report, context);
    assert.equal(qa.pass, false);
    assert.ok(
      qa.failures.some(f => f.source === 'comparison:narrative' && /leverage ranking/i.test(f.message)),
      'expected comparison narrative leverage-ranking failure',
    );
  });

  it('fails strong-liquidity narrative when cash generation is negative', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![2]!.periods[0]!.data['operating_cash_flow'] = -1_200_000;
    context.statements['AMD']![2]!.periods[0]!.data['capex'] = -100_000;
    const ocfFact = context.facts['AMD']!.facts.find(f => f.metric === 'operating_cash_flow');
    if (ocfFact) {
      const current = ocfFact.periods.find(p => p.period === '2025-12-31');
      if (current) current.value = -1_200_000;
    }

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
      ].join('\n'),
      'The balance sheet is conservatively positioned and indicates strong liquidity with significant strategic flexibility.',
    );

    const qa = runQA(report, context);
    assert.equal(qa.pass, false);
    assert.ok(
      qa.failures.some(f => f.gate === 'narrative.threshold_alignment' && /negative operating or free cash flow/i.test(f.message)),
      'expected narrative liquidity alignment failure',
    );
  });

  it('does not fail when separately reported D&A subtotal and component lines do not reconcile exactly', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![2]!.periods[0]!.data['depreciation_and_amortization'] = 68_000;
    context.statements['AMD']![2]!.periods[0]!.data['depreciation_expense'] = 68_000;
    context.statements['AMD']![2]!.periods[0]!.data['amortization_expense'] = 83_000;

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Revenue | $34.6B | $25.8B | 34.3% |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(
      qa.failures.some(f => /depreciation & amortization/i.test(f.message)),
      false,
      'reported subtotal/component differences should not fail filing-first QA on their own',
    );
  });

  it('accepts compact share displays that differ only by displayed rounding precision', () => {
    const context = makeContext('AMD');
    context.statements['AMD']![1]!.periods[0]!.data['shares_outstanding'] = 1_048_766_702;
    const sharesFact = context.facts['AMD']!.facts.find(f => f.metric === 'shares_outstanding');
    if (sharesFact) {
      const current = sharesFact.periods.find(p => p.period === '2025-12-31');
      if (current) current.value = 1_048_766_702;
    }

    const report = makeReport(
      [
        '*Snapshot period: FY2025. Prior period: FY2024.*',
        '| Metric | Current Value | Prior Period | Change (%) |',
        '|:---|---:|---:|---:|',
        '| Shares Outstanding | 1.0B | 1.6B | -34.2% |',
      ].join('\n'),
      '',
    );

    const qa = runQA(report, context);
    assert.equal(
      qa.failures.some(f => /Shares Outstanding/i.test(f.source)),
      false,
      'compact share rounding should not fail cross-section equality',
    );
  });

});
