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
    assert.equal(policy.comparisonBasisMode, 'overlap_normalized');
    assert.equal(policy.comparisonRequireOverlap, true);
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
        layoutIssues: [],
      });

      const policyManifest = JSON.parse(
        await readFile(manifest.files['policy-manifest.json']!, 'utf8'),
      ) as { policy: { comparisonBasisMode: string } };
      const comparisonManifest = JSON.parse(
        await readFile(manifest.files['comparison-basis-manifest.json']!, 'utf8'),
      ) as { requested_basis_mode: string; effective_basis_mode: string };
      const qaManifest = JSON.parse(
        await readFile(manifest.files['qa-result.json']!, 'utf8'),
      ) as { status: string; pass: boolean };
      const renderManifest = JSON.parse(
        await readFile(manifest.files['render-manifest.json']!, 'utf8'),
      ) as { pdf_rendered: boolean; pdf: string | null };
      const layoutManifest = JSON.parse(
        await readFile(manifest.files['layout-qa-report.json']!, 'utf8'),
      ) as { status: string; issues: unknown[] | null };

      assert.equal(policyManifest.policy.comparisonBasisMode, 'overlap_normalized');
      assert.equal(comparisonManifest.requested_basis_mode, 'overlap_normalized');
      assert.equal(comparisonManifest.effective_basis_mode, 'overlap_normalized');
      assert.equal(qaManifest.status, 'pass');
      assert.equal(qaManifest.pass, true);
      assert.equal(renderManifest.pdf_rendered, true);
      assert.equal(renderManifest.pdf, 'AMG.pdf');
      assert.equal(layoutManifest.status, 'completed');
      assert.ok(manifest.files['canonical-ledger.json']);
      assert.ok(manifest.files['derived-metrics-manifest.json']);
      assert.ok(manifest.files['warnings-manifest.json']);
      assert.ok(manifest.files['layout-qa-report.json']);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
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
        layoutIssues: [],
      });
      const renderManifest = JSON.parse(
        await readFile(manifest.files['render-manifest.json']!, 'utf8'),
      ) as { pdf_rendered: boolean; pdf: string | null };
      const qaManifest = JSON.parse(
        await readFile(manifest.files['qa-result.json']!, 'utf8'),
      ) as { status: string; pass: boolean };
      const layoutManifest = JSON.parse(
        await readFile(manifest.files['layout-qa-report.json']!, 'utf8'),
      ) as { status: string; issues: unknown[] | null };
      assert.equal(renderManifest.pdf_rendered, false);
      assert.equal(renderManifest.pdf, null);
      assert.equal(qaManifest.status, 'pass');
      assert.equal(qaManifest.pass, true);
      assert.equal(layoutManifest.status, 'not_run');
      assert.equal(layoutManifest.issues, null);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('refuses to write success-side audit artifacts without a structured narrative payload', async () => {
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
      id: 'missing-narrative-audit-test',
      tickers: ['AMG'],
      type: 'single',
      policy: context.policy,
      generated_at: '2026-03-07T00:00:00.000Z',
      sections: [],
      sources: [],
      validation: { pass: true, issues: [], checked_at: '2026-03-07T00:00:00.000Z' },
      metadata: {
        llm_calls: 0,
        total_duration_ms: 1,
        data_points_used: 10,
        policy_mode: context.policy.mode,
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

    const baseDir = await mkdtemp(join(tmpdir(), 'dolph-audit-narrative-'));
    try {
      await assert.rejects(
        writeAuditArtifacts({
          report,
          context,
          insights,
          reportModel,
          qa,
          outputDir: baseDir,
          pdfPath: null,
          layoutIssues: [],
        }),
        /structured narrative payload/i,
      );
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
          narrativeMode: 'deterministic',
          deterministicNarrative: deterministic,
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

  it('repairs invalid LLM narrative before persistence so report sections and narrative payload stay identical', async () => {
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
      const finalized = await finalizeGovernedReport(report, context, canonicalPackage, {
        auditOutputDir: baseDir,
        narrativeMode: 'llm',
        deterministicNarrative: deterministic,
        persistAuditArtifacts: true,
      });
      const executiveSection = finalized.sections.find(section => section.id === 'executive_summary');
      const executiveNarrative = finalized.narrative?.sections.find(section => section.id === 'executive_summary');
      assert.equal(
        executiveSection?.content,
        executiveNarrative?.paragraphs.map(paragraph => paragraph.text).join('\n\n'),
      );
      assert.ok(
        executiveNarrative?.paragraphs.every(paragraph => paragraph.fact_ids.length > 0),
        'expected repaired narrative payload to retain fact bindings',
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('resolves overlap-normalized fiscal cohorts for close but non-identical annual year ends', () => {
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
    assert.equal(context.comparison_basis?.effective_mode, 'overlap_normalized');
    assert.equal(context.comparison_basis?.resolution_kind, 'fiscal_cohort_tolerance');
    assert.equal(context.comparison_basis?.comparable_current_key, 'FY2025');
    assert.equal(insights['AAA']?.snapshotPeriod, '2025-12-31');
    assert.equal(insights['BBB']?.snapshotPeriod, '2025-12-29');
  });

  it('marks institutional comparison unavailable when no shared annual cohort exists', () => {
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

    analyzeData(context, context.policy);

    assert.equal(context.comparison_basis?.status, 'unavailable');
    assert.equal(context.comparison_basis?.effective_mode, 'overlap_normalized');
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
});
