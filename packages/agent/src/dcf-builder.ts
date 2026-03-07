/**
 * DCF Model Builder — generates analyst production outputs.
 *
 * Outputs:
 * 1. XLSX workbook (Assumptions + Model + Outputs sheets)
 * 2. JSON assumptions manifest
 * 3. Provenance manifest linking every input to its SEC source
 *
 * All calculations are deterministic — no LLM.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import type { AnalysisContext, CompanyFacts, Ratio, TrendData, ProvenanceReceipt } from '@dolph/shared';
import { formatCompactCurrency } from '@dolph/shared';
import { defaultReportsDir } from './report-paths.js';

// ── Types ─────────────────────────────────────────────────────

export interface DCFAssumptions {
  ticker: string;
  company_name: string;
  as_of_date: string;
  projection_years: number;
  discount_rate: number;
  terminal_growth_rate: number;
  revenue_growth_rates: number[];
  operating_margin: number;
  tax_rate: number;
  capex_as_pct_revenue: number;
  depreciation_as_pct_revenue: number;
  nwc_as_pct_revenue: number;
  base_revenue: number;
  base_fcf: number;
  shares_outstanding: number;
}

export interface DCFOutput {
  assumptions: DCFAssumptions;
  projections: Array<{
    year: number;
    revenue: number;
    operating_income: number;
    nopat: number;
    fcf: number;
    discount_factor: number;
    pv_fcf: number;
  }>;
  terminal_value: number;
  pv_terminal: number;
  enterprise_value: number;
  net_debt: number;
  equity_value: number;
  implied_share_price: number;
  provenance: Record<string, ProvenanceReceipt>;
}

// ── Helpers ───────────────────────────────────────────────────

function getMetricValue(facts: CompanyFacts, metric: string): number | null {
  const fact = facts.facts.find(f => f.metric === metric);
  if (!fact || fact.periods.length === 0) return null;
  // Return most recent annual value
  const annualForms = new Set(['10-K', '20-F', '40-F']);
  const annual = fact.periods.find(p => annualForms.has(p.form));
  return annual?.value ?? fact.periods[0]?.value ?? null;
}

function getProvenance(facts: CompanyFacts, metric: string): ProvenanceReceipt | undefined {
  const fact = facts.facts.find(f => f.metric === metric);
  if (!fact || fact.periods.length === 0) return undefined;
  const annualForms = new Set(['10-K', '20-F', '40-F']);
  const annual = fact.periods.find(p => annualForms.has(p.form));
  return annual?.provenance ?? fact.periods[0]?.provenance;
}

function resolveDebtBase(facts: CompanyFacts): {
  debtBase: number;
  debtMetrics: string[];
} {
  const totalDebt = getMetricValue(facts, 'total_debt');
  if (totalDebt !== null && isFinite(totalDebt)) {
    return { debtBase: totalDebt, debtMetrics: ['total_debt'] };
  }

  const longTermDebt = getMetricValue(facts, 'long_term_debt') || 0;
  const shortTermDebt = getMetricValue(facts, 'short_term_debt') || 0;
  return { debtBase: longTermDebt + shortTermDebt, debtMetrics: ['long_term_debt', 'short_term_debt'] };
}

// ── DCF Model ─────────────────────────────────────────────────

/**
 * Build DCF assumptions from company data (deterministic).
 */
export function buildDCFAssumptions(context: AnalysisContext, ticker: string): DCFAssumptions {
  const facts = context.facts[ticker];
  if (!facts) throw new Error(`No facts available for ${ticker}`);

  const ratios = context.ratios[ticker] || [];
  const trends = context.trends[ticker] || [];

  // Extract base values — hard fail on critical inputs
  const revenue = getMetricValue(facts, 'revenue');
  if (!revenue || revenue === 0) {
    throw new Error(`DCF requires revenue data for ${ticker} but none was found in SEC filings.`);
  }
  const shares = getMetricValue(facts, 'shares_outstanding');
  if (!shares || shares === 0) {
    throw new Error(`DCF requires shares outstanding for ${ticker} but none was found in SEC filings.`);
  }

  const opIncomeRaw = getMetricValue(facts, 'operating_income');
  const ocfRaw = getMetricValue(facts, 'operating_cash_flow');
  const opIncome = opIncomeRaw ?? 0;
  const ocf = ocfRaw ?? 0;
  const capex = Math.abs(getMetricValue(facts, 'capex') || 0);

  if ((ocfRaw === null || ocfRaw === 0) && (opIncomeRaw === null || opIncomeRaw === 0)) {
    throw new Error(
      `DCF requires operating cash flow or operating income for ${ticker} but neither was found in SEC filings.`,
    );
  }

  // Derive margins and rates from actual data
  const opMargin = revenue > 0 ? opIncome / revenue : 0.1;
  const capexPct = revenue > 0 ? capex / revenue : 0.05;

  // Leverage-based WACC: adjust baseline 10% based on D/E ratio
  const { debtBase } = resolveDebtBase(facts);
  const equity = getMetricValue(facts, 'stockholders_equity') || 0;
  const deRatio = equity > 0 ? debtBase / equity : 5;
  let wacc = 0.10;
  if (deRatio > 2) wacc = 0.12;
  else if (deRatio > 1) wacc = 0.11;
  else if (deRatio < 0.3) wacc = 0.09;

  // Revenue growth: use CAGR from trend data, capped at reasonable range
  const revTrend = trends.find(t => t.metric === 'revenue');
  const historicalGrowth = revTrend?.cagr ?? 0.05;
  const cappedGrowth = Math.max(-0.1, Math.min(0.3, historicalGrowth));

  // Build declining growth rate schedule (mean-revert toward 3%)
  const projectionYears = 5;
  const growthRates: number[] = [];
  for (let i = 0; i < projectionYears; i++) {
    const rate = cappedGrowth + (0.03 - cappedGrowth) * (i / (projectionYears - 1));
    growthRates.push(Math.round(rate * 1000) / 1000);
  }

  return {
    ticker: ticker.toUpperCase(),
    company_name: facts.company_name,
    as_of_date: new Date().toISOString().split('T')[0]!,
    projection_years: projectionYears,
    discount_rate: wacc,
    terminal_growth_rate: 0.025,
    revenue_growth_rates: growthRates,
    operating_margin: Math.round(opMargin * 1000) / 1000,
    tax_rate: 0.21,
    capex_as_pct_revenue: Math.round(capexPct * 1000) / 1000,
    depreciation_as_pct_revenue: Math.round(capexPct * 0.8 * 1000) / 1000,
    nwc_as_pct_revenue: 0.05,
    base_revenue: revenue,
    base_fcf: ocf - capex,
    shares_outstanding: shares,
  };
}

/**
 * Run DCF model with given assumptions (deterministic).
 */
export function runDCFModel(
  assumptions: DCFAssumptions,
  context: AnalysisContext,
): DCFOutput {
  const ticker = assumptions.ticker;
  const facts = context.facts[ticker];
  const projections: DCFOutput['projections'] = [];

  let prevRevenue = assumptions.base_revenue;

  for (let i = 0; i < assumptions.projection_years; i++) {
    const growthRate = assumptions.revenue_growth_rates[i] ?? 0.03;
    const revenue = prevRevenue * (1 + growthRate);
    const opIncome = revenue * assumptions.operating_margin;
    const nopat = opIncome * (1 - assumptions.tax_rate);
    const depreciation = revenue * assumptions.depreciation_as_pct_revenue;
    const capex = revenue * assumptions.capex_as_pct_revenue;
    const nwcChange = (revenue - prevRevenue) * assumptions.nwc_as_pct_revenue;
    const fcf = nopat + depreciation - capex - nwcChange;
    const year = i + 1;
    const discountFactor = Math.pow(1 + assumptions.discount_rate, -year);
    const pvFcf = fcf * discountFactor;

    projections.push({
      year,
      revenue: Math.round(revenue),
      operating_income: Math.round(opIncome),
      nopat: Math.round(nopat),
      fcf: Math.round(fcf),
      discount_factor: Math.round(discountFactor * 10000) / 10000,
      pv_fcf: Math.round(pvFcf),
    });

    prevRevenue = revenue;
  }

  // Terminal value (Gordon Growth Model)
  const lastFCF = projections[projections.length - 1]!.fcf;
  const terminalValue = Math.round(
    (lastFCF * (1 + assumptions.terminal_growth_rate)) /
    (assumptions.discount_rate - assumptions.terminal_growth_rate),
  );

  const pvTerminal = Math.round(
    terminalValue * Math.pow(1 + assumptions.discount_rate, -assumptions.projection_years),
  );

  const sumPvFcf = projections.reduce((sum, p) => sum + p.pv_fcf, 0);
  const enterpriseValue = sumPvFcf + pvTerminal;

  // Net debt bridge: equity_value = enterprise_value - net_debt
  const debtInfo = facts ? resolveDebtBase(facts) : { debtBase: 0, debtMetrics: [] as string[] };
  const cashEq = facts ? (getMetricValue(facts, 'cash_and_equivalents') || 0) : 0;
  const netDebt = debtInfo.debtBase - cashEq;
  const equityValue = enterpriseValue - netDebt;
  const impliedPrice = assumptions.shares_outstanding > 0
    ? Math.round(equityValue / assumptions.shares_outstanding * 100) / 100
    : 0;

  // Collect provenance
  const provenance: Record<string, ProvenanceReceipt> = {};
  if (facts) {
    for (const metric of [
      'revenue', 'operating_income', 'operating_cash_flow', 'capex',
      'shares_outstanding', ...debtInfo.debtMetrics, 'cash_and_equivalents',
    ]) {
      const prov = getProvenance(facts, metric);
      if (prov) provenance[metric] = prov;
    }
  }

  return {
    assumptions,
    projections,
    terminal_value: terminalValue,
    pv_terminal: pvTerminal,
    enterprise_value: enterpriseValue,
    net_debt: netDebt,
    equity_value: equityValue,
    implied_share_price: impliedPrice,
    provenance,
  };
}

// ── XLSX Export ────────────────────────────────────────────────

function fmt(n: number): string {
  return formatCompactCurrency(n, { smallDecimals: 0, compactDecimals: 1 });
}

/**
 * Generate the full DCF production output package.
 * Returns paths to all generated files.
 */
export async function generateDCFPackage(
  context: AnalysisContext,
  ticker: string,
  outputDir?: string,
): Promise<{ xlsxPath: string; jsonPath: string; provenancePath: string }> {
  const dir = outputDir || defaultReportsDir();
  await mkdir(dir, { recursive: true });

  const assumptions = buildDCFAssumptions(context, ticker);
  const dcf = runDCFModel(assumptions, context);
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = `${ticker}-dcf-${dateStr}`;

  // ── XLSX Workbook ──────────────────────────────────────────

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dolph';
  wb.created = new Date();

  // Sheet 1: Assumptions
  const aSheet = wb.addWorksheet('Assumptions');
  aSheet.columns = [
    { header: 'Parameter', key: 'param', width: 35 },
    { header: 'Value', key: 'value', width: 25 },
  ];

  const aRows = [
    ['Company', assumptions.company_name],
    ['Ticker', assumptions.ticker],
    ['As-of Date', assumptions.as_of_date],
    ['Projection Years', assumptions.projection_years],
    ['Discount Rate (WACC)', `${(assumptions.discount_rate * 100).toFixed(1)}%`],
    ['Terminal Growth Rate', `${(assumptions.terminal_growth_rate * 100).toFixed(1)}%`],
    ['Operating Margin', `${(assumptions.operating_margin * 100).toFixed(1)}%`],
    ['Tax Rate', `${(assumptions.tax_rate * 100).toFixed(1)}%`],
    ['CapEx % of Revenue', `${(assumptions.capex_as_pct_revenue * 100).toFixed(1)}%`],
    ['D&A % of Revenue', `${(assumptions.depreciation_as_pct_revenue * 100).toFixed(1)}%`],
    ['NWC % of Revenue', `${(assumptions.nwc_as_pct_revenue * 100).toFixed(1)}%`],
    ['Base Revenue', fmt(assumptions.base_revenue)],
    ['Base FCF', fmt(assumptions.base_fcf)],
    ['Shares Outstanding', assumptions.shares_outstanding.toLocaleString()],
    ['', ''],
    ['Revenue Growth Schedule', ''],
    ...assumptions.revenue_growth_rates.map((r, i) => [`  Year ${i + 1}`, `${(r * 100).toFixed(1)}%`]),
  ];

  for (const [param, value] of aRows) {
    aSheet.addRow({ param, value });
  }

  // Style header
  aSheet.getRow(1).font = { bold: true };

  // Sheet 2: DCF Model
  const mSheet = wb.addWorksheet('DCF Model');
  mSheet.columns = [
    { header: 'Year', key: 'year', width: 8 },
    { header: 'Revenue', key: 'revenue', width: 18 },
    { header: 'Operating Income', key: 'op_income', width: 18 },
    { header: 'NOPAT', key: 'nopat', width: 18 },
    { header: 'Free Cash Flow', key: 'fcf', width: 18 },
    { header: 'Discount Factor', key: 'df', width: 16 },
    { header: 'PV of FCF', key: 'pv_fcf', width: 18 },
  ];

  for (const p of dcf.projections) {
    mSheet.addRow({
      year: p.year,
      revenue: p.revenue,
      op_income: p.operating_income,
      nopat: p.nopat,
      fcf: p.fcf,
      df: p.discount_factor,
      pv_fcf: p.pv_fcf,
    });
  }

  // Add summary rows
  mSheet.addRow({});
  mSheet.addRow({ year: '', revenue: 'Terminal Value', op_income: '', nopat: '', fcf: dcf.terminal_value, df: '', pv_fcf: dcf.pv_terminal });
  mSheet.addRow({ year: '', revenue: 'Enterprise Value', op_income: '', nopat: '', fcf: '', df: '', pv_fcf: dcf.enterprise_value });
  mSheet.addRow({ year: '', revenue: 'Net Debt', op_income: '', nopat: '', fcf: '', df: '', pv_fcf: dcf.net_debt });
  mSheet.addRow({ year: '', revenue: 'Equity Value', op_income: '', nopat: '', fcf: '', df: '', pv_fcf: dcf.equity_value });
  const impliedPriceRow = mSheet.addRow({
    year: '',
    revenue: 'Implied Share Price',
    op_income: '',
    nopat: '',
    fcf: '',
    df: '',
    pv_fcf: dcf.implied_share_price,
  });

  mSheet.getRow(1).font = { bold: true };

  // Format number columns
  // Revenue/op income/NOPAT/FCF/PV of FCF are integer dollars.
  for (const col of [2, 3, 4, 5, 7]) {
    mSheet.getColumn(col).numFmt = '#,##0';
  }
  // Discount factor is fractional.
  mSheet.getColumn(6).numFmt = '0.0000';
  // Implied share price should keep cents.
  impliedPriceRow.getCell('pv_fcf').numFmt = '$#,##0.00';

  // Sheet 3: Provenance
  const pSheet = wb.addWorksheet('Provenance');
  pSheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'XBRL Tag', key: 'tag', width: 45 },
    { header: 'Namespace', key: 'ns', width: 12 },
    { header: 'Accession #', key: 'accn', width: 25 },
    { header: 'Filing URL', key: 'url', width: 60 },
    { header: 'Extracted At', key: 'time', width: 22 },
  ];

  for (const [metric, prov] of Object.entries(dcf.provenance)) {
    pSheet.addRow({
      metric,
      tag: prov.xbrl_tag,
      ns: prov.namespace,
      accn: prov.accession_number,
      url: prov.filing_url,
      time: prov.extracted_at,
    });
  }

  pSheet.getRow(1).font = { bold: true };

  const xlsxPath = resolve(dir, `${prefix}.xlsx`);
  await wb.xlsx.writeFile(xlsxPath);

  // ── JSON Assumptions ───────────────────────────────────────

  const jsonPath = resolve(dir, `${prefix}-assumptions.json`);
  await writeFile(jsonPath, JSON.stringify(dcf.assumptions, null, 2), 'utf-8');

  // ── Provenance Manifest ────────────────────────────────────

  const provenancePath = resolve(dir, `${prefix}-provenance.json`);
  await writeFile(provenancePath, JSON.stringify({
    ticker,
    model: 'dcf',
    generated_at: new Date().toISOString(),
    implied_share_price: dcf.implied_share_price,
    enterprise_value: dcf.enterprise_value,
    sources: dcf.provenance,
  }, null, 2), 'utf-8');

  return { xlsxPath, jsonPath, provenancePath };
}
