import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisContext, CompanyFacts, FinancialStatement, Report } from '@dolph/shared';
import { applyDerivedPeriodValues } from './report-facts.js';
import { buildCanonicalAnnualPeriodMap } from './report-facts.js';
import { resolveReportingPolicy } from './report-policy.js';
import { analyzeData } from './analyzer.js';
import { buildReportModel } from './report-model.js';
import { writeAuditArtifacts } from './audit-artifacts.js';
import { generateDeterministicNarrative } from './deterministic-narrative.js';
import { buildCanonicalReportPackage } from './canonical-report-package.js';
import { finalizeGovernedReport } from './pipeline.js';
import { buildKeyMetricsSection } from './metrics-builder.js';
import { buildFinancialStatementsSection } from './statements-builder.js';

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
      periods: rows.map(row => ({
        period: row.period,
        value: row.value,
        unit: metric.includes('shares') ? 'shares' : 'USD',
        form: '10-K',
        fiscal_year: Number.parseInt(row.period.slice(0, 4), 10),
        fiscal_period: 'FY',
        filed: '2026-02-01',
      })),
    })),
  };
}

function makeStatement(
  ticker: string,
  statementType: FinancialStatement['statement_type'],
  periods: Array<{ period: string; data: Record<string, number> }>,
): FinancialStatement {
  return {
    ticker,
    statement_type: statementType,
    period_type: 'annual',
    periods: periods.map(period => ({
      period: period.period,
      filed: '2026-02-01',
      data: period.data,
    })),
  };
}

function makeContext(ticker: string): AnalysisContext {
  const income = makeStatement(ticker, 'income', [
    {
      period: '2025-12-31',
      data: {
        revenue: 2_070_000_000,
        net_income: 716_600_000,
        operating_income: 900_000_000,
        gross_profit: 1_050_000_000,
        eps_diluted: 4.21,
      },
    },
    {
      period: '2024-12-31',
      data: {
        revenue: 1_980_000_000,
        net_income: 650_000_000,
        operating_income: 830_000_000,
        gross_profit: 1_000_000_000,
        eps_diluted: 3.8,
      },
    },
  ]);
  const balance = makeStatement(ticker, 'balance_sheet', [
    {
      period: '2025-12-31',
      data: {
        total_assets: 9_210_000_000,
        total_liabilities: 4_790_000_000,
        stockholders_equity: 4_420_000_000,
        current_assets: 1_250_000_000,
        current_liabilities: 450_000_000,
        cash_and_equivalents: 600_000_000,
        shares_outstanding: 170_000_000,
        total_debt: 2_690_000_000,
      },
    },
    {
      period: '2024-12-31',
      data: {
        total_assets: 8_900_000_000,
        total_liabilities: 4_650_000_000,
        stockholders_equity: 4_250_000_000,
        current_assets: 1_180_000_000,
        current_liabilities: 470_000_000,
        cash_and_equivalents: 550_000_000,
        shares_outstanding: 171_000_000,
        total_debt: 2_750_000_000,
      },
    },
  ]);
  const cash = makeStatement(ticker, 'cash_flow', [
    {
      period: '2025-12-31',
      data: {
        operating_cash_flow: 973_200_000,
        capex: -6_100_000,
        cash_ending: 600_000_000,
      },
    },
    {
      period: '2024-12-31',
      data: {
        operating_cash_flow: 900_000_000,
        capex: -7_000_000,
        cash_ending: 550_000_000,
      },
    },
  ]);

  return {
    tickers: [ticker],
    type: 'single',
    plan: { type: 'single', tickers: [ticker], steps: [] },
    results: [],
    filings: {},
    filing_content: {},
    facts: {
      [ticker]: makeFacts(ticker, {
        '2025-12-31': {
          revenue: 2_070_000_000,
          net_income: 716_600_000,
          operating_income: 900_000_000,
          operating_cash_flow: 973_200_000,
          capex: -6_100_000,
          stockholders_equity: 4_420_000_000,
          shares_outstanding: 170_000_000,
          eps_diluted: 4.21,
        },
        '2024-12-31': {
          revenue: 1_980_000_000,
          net_income: 650_000_000,
          operating_income: 830_000_000,
          operating_cash_flow: 900_000_000,
          capex: -7_000_000,
          stockholders_equity: 4_250_000_000,
          shares_outstanding: 171_000_000,
          eps_diluted: 3.8,
        },
      }),
    },
    statements: { [ticker]: [income, balance, cash] },
    ratios: { [ticker]: [] },
    trends: { [ticker]: [] },
  };
}

describe('report governance hardening', () => {
  it('uses governed institutional defaults for comparison mode', () => {
    const policy = resolveReportingPolicy({
      tickers: ['GLE', 'AMG'],
      type: 'comparison',
      maxRetries: 1,
      maxValidationLoops: 0,
    });

    assert.equal(policy.mode, 'institutional');
    assert.equal(policy.comparisonBasisMode, 'latest_per_peer_with_prominent_disclosure');
    assert.equal(policy.comparisonRequireOverlap, false);
    assert.equal(policy.strictLayoutQA, true);
    assert.equal(policy.statementHistoryPeriods, 5);
    assert.equal(policy.trendHistoryPeriods, 10);
  });

  it('limits sparse-filer derivations to the approved conservative metric set', () => {
    const values: Record<string, number> = {
      cash_ending: 120_000,
      marketable_securities: 30_000,
      accounts_receivable: 50_000,
      inventory: 20_000,
      other_current_assets: 10_000,
      accounts_payable: 18_000,
      accrued_expenses: 12_000,
      other_current_liabilities: 5_000,
      total_debt: 40_000,
      long_term_debt: 28_000,
      total_assets: 200_000,
      total_liabilities: 90_000,
    };

    applyDerivedPeriodValues(values);

    assert.equal(values['cash_and_equivalents'], undefined);
    assert.equal(values['short_term_debt'], undefined);
    assert.equal(values['current_assets'], undefined);
    assert.equal(values['current_liabilities'], undefined);
    assert.equal(values['stockholders_equity'], undefined);
    assert.equal(values['total_debt'], 40_000);
  });

  it('excludes non-FY points from canonical annual fact series when fiscal metadata is available', () => {
    const context = makeContext('TST');
    context.facts['TST']!.facts.find(f => f.metric === 'revenue')!.periods.unshift({
      period: '2025-09-30',
      value: 1_500_000_000,
      unit: 'USD',
      form: '10-K',
      fiscal_year: 2025,
      fiscal_period: 'Q3',
      filed: '2025-11-01',
    });

    const annualPeriods = Array.from(buildCanonicalAnnualPeriodMap(context, 'TST').keys());
    assert.deepEqual(annualPeriods.slice(0, 2), ['2025-12-31', '2024-12-31']);
    assert.equal(annualPeriods.includes('2025-09-30'), false);
  });

  it('writes a complete success-side audit package', async () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });
    const insights = analyzeData(context, context.policy);
    const reportModel = buildReportModel(context, insights);

    const report: Report = {
      id: 'audit-test',
      tickers: ['AMG'],
      type: 'single',
      policy: context.policy,
      generated_at: '2026-03-07T00:00:00.000Z',
      sections: [
        { id: 'executive_summary', title: 'Executive Summary', content: 'AMG reports strong free cash flow and moderate leverage.' },
        { id: 'key_metrics', title: 'Key Metrics', content: '| Metric | Current Value | Prior Period | Change (%) |\n|:---|---:|---:|---:|\n| Revenue | $2.07B | $1.98B | 4.5% |' },
        { id: 'financial_statements', title: 'Financial Statements', content: '' },
        { id: 'data_sources', title: 'Data Sources', content: '' },
      ],
      sources: [],
      validation: { pass: true, issues: [], checked_at: '2026-03-07T00:00:00.000Z' },
      metadata: {
        llm_calls: 0,
        total_duration_ms: 1,
        data_points_used: 10,
        policy_mode: context.policy.mode,
      },
      narrative: {
        mode: 'deterministic',
        sections: [
          {
            id: 'executive_summary',
            title: 'Executive Summary',
            rendered_content: 'AMG reports strong free cash flow and moderate leverage.',
            paragraphs: [{ text: 'AMG reports strong free cash flow and moderate leverage.', fact_ids: ['fcf', 'de'] }],
          },
        ],
      },
    };

    const qa = {
      pass: true,
      failures: [],
      periodBasis: {
        AMG: {
          current: reportModel.companies[0]?.snapshotPeriod || null,
          prior: reportModel.companies[0]?.priorPeriod || null,
        },
      },
      mappingFixes: [],
      recomputedMetrics: {},
    };

    const baseDir = await mkdtemp(join(tmpdir(), 'dolph-audit-'));
    const pdfPath = join(baseDir, 'AMG.pdf');
    await writeFile(pdfPath, 'placeholder', 'utf8');

    try {
      const manifest = await writeAuditArtifacts({
        report,
        context,
        insights,
        reportModel,
        qa,
        outputDir: baseDir,
        pdfPath,
      });

      const qaManifest = JSON.parse(
        await readFile(manifest.files['qa-result.json']!, 'utf8'),
      ) as { status: string; pass: boolean };

      assert.equal(qaManifest.status, 'pass');
      assert.equal(qaManifest.pass, true);
      assert.ok(manifest.files['qa-result.json']);
      assert.ok(manifest.files['source-manifest.json']);
      assert.ok(manifest.files['canonical-ledger.json']);
      // Only 3 artifacts should exist
      assert.equal(Object.keys(manifest.files).length, 3);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('surfaces broader reported cash-family lines without treating narrow cash as missing', () => {
    const context = makeContext('SKIN');
    const balance = context.statements['SKIN']!.find(statement => statement.statement_type === 'balance_sheet')!;
    const cashFlow = context.statements['SKIN']!.find(statement => statement.statement_type === 'cash_flow')!;

    delete balance.periods[0]!.data['cash_and_equivalents'];
    balance.periods[0]!.data['cash_and_equivalents_and_restricted_cash'] = 370_063_000;
    balance.periods[1]!.data['cash_and_equivalents'] = 523_025_000;
    cashFlow.periods[0]!.data['cash_ending'] = 370_063_000;

    context.facts['SKIN'] = makeFacts('SKIN', {
      '2025-12-31': {
        revenue: 2_070_000_000,
        net_income: 716_600_000,
        operating_income: 900_000_000,
        operating_cash_flow: 973_200_000,
        capex: -6_100_000,
        stockholders_equity: 4_420_000_000,
        shares_outstanding: 170_000_000,
        eps_diluted: 4.21,
        cash_and_equivalents_and_restricted_cash: 370_063_000,
        cash_ending: 370_063_000,
      },
      '2024-12-31': {
        revenue: 1_980_000_000,
        net_income: 650_000_000,
        operating_income: 830_000_000,
        operating_cash_flow: 900_000_000,
        capex: -7_000_000,
        stockholders_equity: 4_250_000_000,
        shares_outstanding: 171_000_000,
        eps_diluted: 3.8,
        cash_and_equivalents: 523_025_000,
        cash_ending: 523_025_000,
      },
    });

    const insights = analyzeData(context, context.policy || resolveReportingPolicy({
      tickers: ['SKIN'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    }));
    const reportModel = buildReportModel(context, insights);
    const company = reportModel.companies[0]!;
    const balanceTable = company.statementTables.find(table => table.statementType === 'balance_sheet')!;

    assert.ok(balanceTable.rows.some(row => row.key === 'cash_and_equivalents_and_restricted_cash'));
    assert.equal(balanceTable.rows.some(row => row.key === 'cash_and_equivalents'), false);
    assert.equal(
      insights['SKIN']!.redFlags.some(flag => /Cash & Equivalents/i.test(flag.detail)),
      false,
    );
  });

  it('surfaces cash-flow ending cash when no current balance-sheet cash-family line is available', () => {
    const context = makeContext('SKIN');
    const balance = context.statements['SKIN']!.find(statement => statement.statement_type === 'balance_sheet')!;
    const cashFlow = context.statements['SKIN']!.find(statement => statement.statement_type === 'cash_flow')!;

    delete balance.periods[0]!.data['cash_and_equivalents'];
    delete balance.periods[0]!.data['cash_and_equivalents_and_restricted_cash'];
    cashFlow.periods[0]!.data['cash_ending'] = 370_063_000;

    context.facts['SKIN'] = makeFacts('SKIN', {
      '2024-12-31': {
        revenue: 334_100_000,
        net_income: -29_100_000,
        operating_income: -67_800_000,
        operating_cash_flow: 16_134_000,
        capex: -1_303_000,
        stockholders_equity: 51_800_000,
        shares_outstanding: 140_000_000,
        eps_diluted: -0.36,
        cash_ending: 370_063_000,
      },
      '2023-12-31': {
        revenue: 420_000_000,
        net_income: -120_000_000,
        operating_income: -140_000_000,
        operating_cash_flow: 22_000_000,
        capex: -4_000_000,
        stockholders_equity: 200_000_000,
        shares_outstanding: 138_000_000,
        eps_diluted: -0.87,
        cash_and_equivalents: 523_025_000,
        cash_ending: 523_025_000,
      },
    });

    const insights = analyzeData(context, context.policy || resolveReportingPolicy({
      tickers: ['SKIN'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    }));
    const reportModel = buildReportModel(context, insights);
    const company = reportModel.companies[0]!;
    const balanceTable = company.statementTables.find(table => table.statementType === 'balance_sheet')!;

    assert.equal(balanceTable.rows.some(row => row.key === 'cash_and_equivalents'), false);
    assert.equal(
      company.metricsByLabel.get('Cash at End of Period (cash-flow statement)')?.currentDisplay,
      '$370M',
    );
  });

  it('suppresses duplicate broader cash-family metrics when they exactly mirror cash and equivalents', () => {
    const context = makeContext('NVDA');
    const balance = context.statements['NVDA']!.find(statement => statement.statement_type === 'balance_sheet')!;
    balance.periods[0]!.data['cash_and_equivalents_and_restricted_cash'] = 600_000_000;
    balance.periods[1]!.data['cash_and_equivalents_and_restricted_cash'] = 550_000_000;

    context.facts['NVDA'] = makeFacts('NVDA', {
      '2025-12-31': {
        revenue: 2_070_000_000,
        net_income: 716_600_000,
        operating_income: 900_000_000,
        operating_cash_flow: 973_200_000,
        capex: -6_100_000,
        stockholders_equity: 4_420_000_000,
        shares_outstanding: 170_000_000,
        eps_diluted: 4.21,
        cash_and_equivalents: 600_000_000,
        cash_and_equivalents_and_restricted_cash: 600_000_000,
      },
      '2024-12-31': {
        revenue: 1_980_000_000,
        net_income: 650_000_000,
        operating_income: 830_000_000,
        operating_cash_flow: 900_000_000,
        capex: -7_000_000,
        stockholders_equity: 4_250_000_000,
        shares_outstanding: 171_000_000,
        eps_diluted: 3.8,
        cash_and_equivalents: 550_000_000,
        cash_and_equivalents_and_restricted_cash: 550_000_000,
      },
    });

    const insights = analyzeData(context, context.policy || resolveReportingPolicy({
      tickers: ['NVDA'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    }));
    const reportModel = buildReportModel(context, insights);
    const company = reportModel.companies[0]!;
    const balanceTable = company.statementTables.find(table => table.statementType === 'balance_sheet')!;

    assert.equal(company.metricsByLabel.has('Cash, Cash Equivalents & Restricted Cash'), false);
    assert.equal(balanceTable.rows.some(row => row.key === 'cash_and_equivalents_and_restricted_cash'), false);
    assert.equal(company.metricsByLabel.get('Cash & Equivalents')?.currentDisplay, '$600M');
  });

  it('writes a governed audit package before PDF rendering occurs', async () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });
    const insights = analyzeData(context, context.policy);
    const reportModel = buildReportModel(context, insights);
    const deterministic = generateDeterministicNarrative(context, insights);

    const report: Report = {
      id: 'pre-pdf-audit-test',
      tickers: ['AMG'],
      type: 'single',
      policy: context.policy,
      generated_at: '2026-03-07T00:00:00.000Z',
      sections: deterministic.sections,
      sources: [],
      validation: { pass: true, issues: [], checked_at: '2026-03-07T00:00:00.000Z' },
      metadata: {
        llm_calls: 0,
        total_duration_ms: 1,
        data_points_used: 10,
        policy_mode: context.policy.mode,
      },
      narrative: deterministic.narrative,
    };

    const qa = {
      pass: true,
      failures: [],
      periodBasis: {
        AMG: {
          current: reportModel.companies[0]?.snapshotPeriod || null,
          prior: reportModel.companies[0]?.priorPeriod || null,
        },
      },
      mappingFixes: [],
      recomputedMetrics: {},
    };

    const baseDir = await mkdtemp(join(tmpdir(), 'dolph-audit-prepdf-'));
    try {
      const manifest = await writeAuditArtifacts({
        report,
        context,
        insights,
        reportModel,
        qa,
        outputDir: baseDir,
        pdfPath: null,
      });
      const qaManifest = JSON.parse(
        await readFile(manifest.files['qa-result.json']!, 'utf8'),
      ) as { status: string; pass: boolean };
      assert.equal(qaManifest.status, 'pass');
      assert.equal(qaManifest.pass, true);
      assert.equal(Object.keys(manifest.files).length, 3);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('fails closed at the pipeline governance stage when deterministic QA fails', async () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });
    const canonicalPackage = buildCanonicalReportPackage(context);
    const deterministic = generateDeterministicNarrative(context, canonicalPackage.insights);

    const report: Report = {
      id: 'pipeline-qa-fail-test',
      tickers: ['AMG'],
      type: 'single',
      policy: context.policy,
      generated_at: '2026-03-07T00:00:00.000Z',
      sections: [
        { id: 'executive_summary', title: 'Executive Summary', content: deterministic.sections.find(s => s.id === 'executive_summary')?.content || '' },
        {
          id: 'key_metrics',
          title: 'Key Metrics',
          content: [
            '*Snapshot period: FY2025. Prior period: FY2024.*',
            '| Metric | Current Value | Prior Period | Change (%) |',
            '|:---|---:|---:|---:|',
            '| Revenue | $2.07B | $1.95B | 6.2% |',
            '| Free Cash Flow | $967M | N/A | N/A |',
          ].join('\n'),
        },
        { id: 'trend_analysis', title: 'Trend Analysis', content: deterministic.sections.find(s => s.id === 'trend_analysis')?.content || '' },
        { id: 'risk_factors', title: 'Risk Factors', content: deterministic.sections.find(s => s.id === 'risk_factors')?.content || '' },
        { id: 'analyst_notes', title: 'Analyst Notes', content: deterministic.sections.find(s => s.id === 'analyst_notes')?.content || '' },
        { id: 'financial_statements', title: 'Financial Statements', content: '| Metric | Current | Prior |\n| --- | ---: | ---: |\n| Revenue | $2.07B | $1.95B |' },
        { id: 'data_sources', title: 'Data Sources', content: 'https://www.sec.gov/' },
      ],
      sources: [],
      validation: { pass: true, issues: [], checked_at: '2026-03-07T00:00:00.000Z' },
      metadata: {
        llm_calls: 0,
        total_duration_ms: 1,
        data_points_used: 10,
        policy_mode: context.policy.mode,
      },
      narrative: deterministic.narrative,
    };

    const baseDir = await mkdtemp(join(tmpdir(), 'dolph-pipeline-fail-'));
    try {
      await assert.rejects(
        finalizeGovernedReport(report, context, canonicalPackage, {
          auditOutputDir: baseDir,
          persistAuditArtifacts: true,
        }),
        /Report failed deterministic QA:/,
      );
      const dirEntries = await readFile(join(baseDir, `${report.tickers.join('-')}-${report.generated_at.replace(/[:.]/g, '-').slice(0, 19)}-qa-failure.md`), 'utf8').catch(() => null);
      assert.ok(dirEntries !== null, 'expected pipeline governance to persist a QA failure report');
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('fails closed when LLM narrative is invalid instead of repairing it after package creation', async () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
      narrativeMode: 'llm',
    });
    const canonicalPackage = buildCanonicalReportPackage(context);
    const deterministic = generateDeterministicNarrative(context, canonicalPackage.insights);

    const report: Report = {
      id: 'pipeline-narrative-repair-test',
      tickers: ['AMG'],
      type: 'single',
      policy: context.policy,
      generated_at: '2026-03-07T00:00:00.000Z',
      sections: [
        { id: 'executive_summary', title: 'Executive Summary', content: 'Revenue Revenue is currently $2.07B.' },
        buildKeyMetricsSection(canonicalPackage),
        { id: 'trend_analysis', title: 'Trend Analysis', content: deterministic.sections.find(section => section.id === 'trend_analysis')?.content || '' },
        { id: 'risk_factors', title: 'Risk Factors', content: deterministic.sections.find(section => section.id === 'risk_factors')?.content || '' },
        { id: 'analyst_notes', title: 'Analyst Notes', content: deterministic.sections.find(section => section.id === 'analyst_notes')?.content || '' },
        buildFinancialStatementsSection(canonicalPackage),
        { id: 'data_sources', title: 'Data Sources', content: 'https://www.sec.gov/' },
      ],
      sources: [],
      validation: { pass: true, issues: [], checked_at: '2026-03-07T00:00:00.000Z' },
      metadata: {
        llm_calls: 1,
        total_duration_ms: 1,
        data_points_used: 10,
        policy_mode: context.policy.mode,
      },
      narrative: {
        mode: 'structured_llm',
        sections: [
          {
            id: 'executive_summary',
            title: 'Executive Summary',
            rendered_content: 'Revenue Revenue is currently $2.07B.',
            paragraphs: [{ text: 'Revenue Revenue is currently $2.07B.', fact_ids: [] }],
          },
        ],
      },
    };

    const baseDir = await mkdtemp(join(tmpdir(), 'dolph-pipeline-repair-'));
    try {
      await assert.rejects(
        finalizeGovernedReport(report, context, canonicalPackage, {
          auditOutputDir: baseDir,
          persistAuditArtifacts: true,
        }),
        /Report failed deterministic QA:/,
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('resolves latest-per-peer comparison for close but non-identical annual year ends', () => {
    const first = makeContext('AAA');
    const second = makeContext('BBB');

    for (const fact of second.facts['BBB']!.facts) {
      for (const period of fact.periods) {
        if (period.period === '2025-12-31') period.period = '2025-12-29';
        if (period.period === '2024-12-31') period.period = '2024-12-28';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }
    for (const statement of second.statements['BBB'] || []) {
      for (const period of statement.periods) {
        if (period.period === '2025-12-31') period.period = '2025-12-29';
        if (period.period === '2024-12-31') period.period = '2024-12-28';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }

    const context: AnalysisContext = {
      tickers: ['AAA', 'BBB'],
      type: 'comparison',
      plan: { type: 'comparison', tickers: ['AAA', 'BBB'], steps: [] },
      results: [],
      filings: {},
      filing_content: {},
      facts: { ...first.facts, ...second.facts },
      statements: { ...first.statements, ...second.statements },
      ratios: { ...first.ratios, ...second.ratios },
      trends: { ...first.trends, ...second.trends },
      policy: resolveReportingPolicy({
        tickers: ['AAA', 'BBB'],
        type: 'comparison',
        maxRetries: 1,
        maxValidationLoops: 0,
      }),
    };

    const insights = analyzeData(context, context.policy);

    assert.equal(context.comparison_basis?.status, 'resolved');
    assert.equal(context.comparison_basis?.effective_mode, 'latest_per_peer_with_prominent_disclosure');
    assert.equal(insights['AAA']?.snapshotPeriod, '2025-12-31');
    assert.equal(insights['BBB']?.snapshotPeriod, '2025-12-29');
  });

  it('resolves latest-per-peer comparison when peers have different fiscal year-ends', () => {
    const first = makeContext('GLE');
    const second = makeContext('AMG');

    for (const fact of first.facts['GLE']!.facts) {
      for (const period of fact.periods) {
        if (period.period === '2025-12-31') period.period = '2025-06-30';
        if (period.period === '2024-12-31') period.period = '2024-06-30';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }
    for (const statement of first.statements['GLE'] || []) {
      for (const period of statement.periods) {
        if (period.period === '2025-12-31') period.period = '2025-06-30';
        if (period.period === '2024-12-31') period.period = '2024-06-30';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }

    const context: AnalysisContext = {
      tickers: ['GLE', 'AMG'],
      type: 'comparison',
      plan: { type: 'comparison', tickers: ['GLE', 'AMG'], steps: [] },
      results: [],
      filings: {},
      filing_content: {},
      facts: { ...first.facts, ...second.facts },
      statements: { ...first.statements, ...second.statements },
      ratios: { ...first.ratios, ...second.ratios },
      trends: { ...first.trends, ...second.trends },
      policy: resolveReportingPolicy({
        tickers: ['GLE', 'AMG'],
        type: 'comparison',
        maxRetries: 1,
        maxValidationLoops: 0,
      }),
    };

    const insights = analyzeData(context, context.policy);

    assert.equal(context.comparison_basis?.status, 'resolved');
    assert.equal(context.comparison_basis?.effective_mode, 'latest_per_peer_with_prominent_disclosure');
    assert.equal(insights['GLE']?.snapshotPeriod, '2025-06-30');
    assert.equal(insights['AMG']?.snapshotPeriod, '2025-12-31');
  });

  it('uses governed latest-per-peer disclosure mode when screening policy requests it', () => {
    const first = makeContext('GLE');
    const second = makeContext('AMG');

    for (const fact of first.facts['GLE']!.facts) {
      for (const period of fact.periods) {
        if (period.period === '2025-12-31') period.period = '2025-06-30';
        if (period.period === '2024-12-31') period.period = '2024-06-30';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }
    for (const statement of first.statements['GLE'] || []) {
      for (const period of statement.periods) {
        if (period.period === '2025-12-31') period.period = '2025-06-30';
        if (period.period === '2024-12-31') period.period = '2024-06-30';
        period.fiscal_year = Number.parseInt(period.period.slice(0, 4), 10);
        period.fiscal_period = 'FY';
      }
    }

    const context: AnalysisContext = {
      tickers: ['GLE', 'AMG'],
      type: 'comparison',
      plan: { type: 'comparison', tickers: ['GLE', 'AMG'], steps: [] },
      results: [],
      filings: {},
      filing_content: {},
      facts: { ...first.facts, ...second.facts },
      statements: { ...first.statements, ...second.statements },
      ratios: { ...first.ratios, ...second.ratios },
      trends: { ...first.trends, ...second.trends },
      policy: resolveReportingPolicy({
        tickers: ['GLE', 'AMG'],
        type: 'comparison',
        maxRetries: 1,
        maxValidationLoops: 0,
        policy: {
          mode: 'screening',
          comparisonBasisMode: 'latest_per_peer_with_prominent_disclosure',
        },
      }),
    };

    const insights = analyzeData(context, context.policy);

    assert.equal(context.comparison_basis?.status, 'resolved');
    assert.equal(context.comparison_basis?.effective_mode, 'latest_per_peer_with_prominent_disclosure');
    assert.equal(insights['GLE']?.snapshotPeriod, '2025-06-30');
    assert.equal(insights['AMG']?.snapshotPeriod, '2025-12-31');
  });

  it('emits deterministic narrative with fact bindings for every narrative paragraph', () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });
    const insights = analyzeData(context, context.policy);
    const narrative = generateDeterministicNarrative(context, insights).narrative;

    assert.equal(narrative.mode, 'deterministic');
    for (const section of narrative.sections) {
      for (const paragraph of section.paragraphs) {
        assert.ok(paragraph.text.trim().length > 0);
        assert.ok(paragraph.fact_ids.length > 0, `expected fact bindings for ${section.id}`);
      }
    }
  });

  it('locks statement tables to the fixed current/prior periods and omits raw statement extra rows', () => {
    const context = makeContext('GE');
    const income = context.statements['GE']!.find(statement => statement.statement_type === 'income')!;
    income.periods.push({
      period: '2024-09-30',
      filed: '2025-11-01',
      form: '10-K',
      fiscal_year: 2024,
      fiscal_period: 'Q3',
      data: {
        revenue: 999_000_000,
        net_income: 111_000_000,
        mystery_extra_line: 123_456,
      },
    });
    income.periods[0]!.data['mystery_extra_line'] = 222_222;

    context.policy = resolveReportingPolicy({
      tickers: ['GE'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });

    const insights = analyzeData(context, context.policy);
    const reportModel = buildReportModel(context, insights);
    const company = reportModel.companies[0]!;
    const incomeTable = company.statementTables.find(table => table.statementType === 'income')!;

    assert.deepEqual(incomeTable.periods, ['2025-12-31', '2024-12-31']);
    assert.equal(incomeTable.rows.some(row => row.key === 'mystery_extra_line'), false);
  });

  it('applies one fixed comparison row contract across peers regardless of issuer coverage', () => {
    const first = makeContext('AAA');
    const second = makeContext('BBB');

    for (const statement of second.statements['BBB'] || []) {
      for (const period of statement.periods) {
        delete period.data['current_assets'];
        delete period.data['current_liabilities'];
        delete period.data['gross_profit'];
      }
    }

    const context: AnalysisContext = {
      tickers: ['AAA', 'BBB'],
      type: 'comparison',
      plan: { type: 'comparison', tickers: ['AAA', 'BBB'], steps: [] },
      results: [],
      filings: {},
      filing_content: {},
      facts: { ...first.facts, ...second.facts },
      statements: { ...first.statements, ...second.statements },
      ratios: { ...first.ratios, ...second.ratios },
      trends: { ...first.trends, ...second.trends },
      policy: resolveReportingPolicy({
        tickers: ['AAA', 'BBB'],
        type: 'comparison',
        maxRetries: 1,
        maxValidationLoops: 0,
      }),
    };

    const insights = analyzeData(context, context.policy);
    const reportModel = buildReportModel(context, insights);
    const expected = reportModel.comparisonRowGroups.map(group => ({
      title: group.title,
      rowLabels: group.rowLabels,
    }));

    for (const company of reportModel.companies) {
      assert.deepEqual(
        company.comparisonGroups.map(group => ({
          title: group.title,
          rowLabels: group.rows.map(row => row.label),
        })),
        expected,
      );
    }

    const bbbLiquidity = reportModel.companiesByTicker.get('BBB')!.comparisonGroups.find(group => group.title === 'Liquidity & Leverage')!;
    assert.ok(bbbLiquidity.rows.some(row => row.label === 'Current Assets'));
    assert.equal(
      reportModel.companiesByTicker.get('BBB')!.metricsByLabel.get('Current Assets')?.currentDisplay,
      'Unavailable',
    );
  });

  it('builds fixed appendix support notes from the package contract', () => {
    const context = makeContext('AMG');
    context.policy = resolveReportingPolicy({
      tickers: ['AMG'],
      type: 'single',
      maxRetries: 1,
      maxValidationLoops: 0,
    });

    const insights = analyzeData(context, context.policy);
    const reportModel = buildReportModel(context, insights);
    const notes = reportModel.companies[0]!.appendixSupportNotes;

    assert.ok(notes.some(note => /central statement mapping catalog/i.test(note)));
    assert.ok(notes.some(note => /locked annual appendix basis/i.test(note)));
    assert.equal(notes.some(note => /Derived or reconciled appendix rows include/i.test(note)), false);
  });
});
