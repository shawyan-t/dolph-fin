/**
 * Deterministic SVG Chart Generation — Analyst-Grade Templates.
 *
 * Chart pack:
 * 1. Revenue + Margin (dual-axis) — bars + margin overlay lines
 * 2. FCF Bridge Waterfall — Net Income → Adjustments → CFO → CapEx → FCF
 * 3. Peer Normalized Scorecard — Z-scored horizontal bars (comparison only)
 * 4. Return vs Leverage Quadrant — ROE vs D/E scatter (comparison only)
 * 5. Growth Durability — YoY growth bars + CAGR line + volatility band
 *
 * NO external dependencies — pure string-based SVG construction.
 */

import type { AnalysisContext, TrendData, CompanyFacts } from '@dolph/shared';
import { classifyChangeMeaning, getMappingByName, formatCompactCurrency } from '@dolph/shared';
import { buildCanonicalAnnualPeriodMap } from './report-facts.js';

// ── Color palette ─────────────────────────────────────────────

const COLORS = {
  primary: '#4B3A2E',     // Burnt umber
  secondary: '#B08D57',   // Brass
  accent: '#5B6448',      // Forest olive
  warning: '#A06A4B',     // Muted copper
  danger: '#6A3B32',      // Burgundy
  gray: '#6D6258',        // Muted text
  gridLine: '#D8CCBD',    // Stone beige grid
  background: '#FFFFFF',  // Crisp chart canvas
};

const CHART_COLORS = ['#5B6448', '#B08D57', '#A06A4B', '#4B3A2E', '#6A3B32'];

// ── Chart dimensions ──────────────────────────────────────────

const CHART_WIDTH = 700;
const CHART_HEIGHT = 360;

// ── Public API ────────────────────────────────────────────────

export interface ChartSet {
  revenueMarginChart: string | null;
  fcfBridgeChart: string | null;
  peerScorecardChart: string | null;
  returnLeverageChart: string | null;
  growthDurabilityChart: string | null;
}

export interface ChartPeriodLock {
  current: string | null;
  prior: string | null;
}

/**
 * Generate all applicable charts for a report.
 * Returns SVG strings ready to embed in HTML.
 */
export function generateCharts(context: AnalysisContext): ChartSet {
  return generateChartsWithLocks(context);
}

export function generateChartsWithLocks(
  context: AnalysisContext,
  periodLocks: Record<string, ChartPeriodLock> = {},
): ChartSet {
  const ticker = context.tickers[0]!;
  const primaryLock = periodLocks[ticker];

  return {
    revenueMarginChart: buildRevenueMarginChart(context, ticker, primaryLock),
    fcfBridgeChart: buildFCFBridgeChart(context, ticker, primaryLock),
    peerScorecardChart: context.type === 'comparison'
      ? buildPeerScorecardChart(context, periodLocks) : null,
    returnLeverageChart: context.type === 'comparison'
      ? buildReturnLeverageChart(context, periodLocks) : null,
    growthDurabilityChart: buildGrowthDurabilityChart(context, ticker, primaryLock),
  };
}

// ── 1. Revenue + Margin Chart (Dual-Axis) ─────────────────────

function buildRevenueMarginChart(
  context: AnalysisContext,
  ticker: string,
  periodLock?: ChartPeriodLock,
): string | null {
  const trends = context.trends[ticker] || [];
  const revenueTrend = trends.find(t => t.metric === 'revenue');
  if (!revenueTrend || revenueTrend.values.length < 2) return null;

  const periods = selectAnnualChartValues(revenueTrend.values, 5, periodLock?.current ?? null);
  const n = periods.length;
  if (n < 2) return null;

  // Gather income trends to compute margins per period
  const opIncomeTrend = trends.find(t => t.metric === 'operating_income');
  const netIncomeTrend = trends.find(t => t.metric === 'net_income');
  const grossProfitTrend = trends.find(t => t.metric === 'gross_profit');

  type MarginLine = { label: string; color: string; dash?: string; values: (number | null)[] };
  const marginLines: MarginLine[] = [];

  function buildMarginLine(
    trend: TrendData | undefined,
    label: string,
    color: string,
    dash?: string,
  ): MarginLine | null {
    if (!trend) return null;
    const values = periods.map(p => {
      const match = trend.values.find(v => v.period === p.period);
      if (!match || p.value <= 0) return null;
      return match.value / p.value;
    });
    if (values.every(v => v === null)) return null;
    return { label, color, dash, values };
  }

  const gross = buildMarginLine(grossProfitTrend, 'Gross Margin', COLORS.accent);
  const operating = buildMarginLine(opIncomeTrend, 'Op. Margin', COLORS.secondary);
  const net = buildMarginLine(netIncomeTrend, 'Net Margin', COLORS.warning, '4,3');

  if (gross) marginLines.push(gross);
  if (operating) marginLines.push(operating);
  if (net) marginLines.push(net);

  // Chart layout — right padding for margin axis
  const pad = { top: 30, right: 60, bottom: 50, left: 80 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  // Revenue scale (left Y-axis)
  const revenues = periods.map(p => p.value);
  const maxRev = Math.max(...revenues);
  const revCeil = niceMax(maxRev);

  // Margin scale (right Y-axis) — 0% to max margin rounded up
  const allMargins = marginLines.flatMap(l => l.values.filter(v => v !== null) as number[]);
  const maxMarginPct = allMargins.length > 0 ? Math.max(...allMargins) * 100 : 50;
  const marginCeil = Math.ceil(maxMarginPct / 10) * 10 + 10;

  const barSpacing = plotW / n;
  const barWidth = barSpacing * 0.55;

  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgBg(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgTitle(`${escSvg(ticker)} — Revenue &amp; Margin Profile`, CHART_WIDTH));

  // Left Y-axis grid + labels (Revenue)
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.top + (plotH * i / yTicks);
    const value = revCeil * (1 - i / yTicks);
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${formatAxisValue(value)}</text>`);
  }

  // Right Y-axis labels (Margin %)
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.top + (plotH * i / yTicks);
    const pct = marginCeil * (1 - i / yTicks);
    parts.push(`<text x="${pad.left + plotW + 8}" y="${y + 3}" text-anchor="start" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${pct.toFixed(0)}%</text>`);
  }

  // Revenue bars
  for (let i = 0; i < n; i++) {
    const x = pad.left + i * barSpacing + (barSpacing - barWidth) / 2;
    const barH = (revenues[i]! / revCeil) * plotH;
    const y = pad.top + plotH - barH;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${COLORS.primary}" rx="2" opacity="0.75"/>`);
  }

  // X-axis labels
  for (let i = 0; i < n; i++) {
    const x = pad.left + i * barSpacing + barSpacing / 2;
    parts.push(`<text x="${x}" y="${pad.top + plotH + 16}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(formatPeriodShort(periods[i]!.period))}</text>`);
  }

  // Margin overlay lines
  for (const ml of marginLines) {
    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const val = ml.values[i];
      if (val === null) continue;
      const x = pad.left + i * barSpacing + barSpacing / 2;
      const y = pad.top + plotH - (val * 100 / marginCeil * plotH);
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (points.length < 2) continue;
    const dashAttr = ml.dash ? ` stroke-dasharray="${ml.dash}"` : '';
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${ml.color}" stroke-width="2"${dashAttr} stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const pt of points) {
      const [cx, cy] = pt.split(',');
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${ml.color}" stroke="${COLORS.background}" stroke-width="1.5"/>`);
    }
  }

  // Legend
  const legendItems: LegendItem[] = [
    { label: 'Revenue', color: COLORS.primary, type: 'rect' },
    ...marginLines.map(ml => ({ label: ml.label, color: ml.color, type: 'line' as const })),
  ];
  parts.push(buildLegend(legendItems, pad.left, pad.top + plotH + 34));

  parts.push('</svg>');
  return parts.join('\n');
}

// ── 2. FCF Bridge Waterfall ───────────────────────────────────

function getFactValue(
  facts: CompanyFacts,
  metric: string,
  lockedPeriod: string | null = null,
): number | null {
  const fact = facts.facts.find(f => f.metric === metric);
  if (!fact || fact.periods.length === 0) return null;
  const annualForms = new Set(['10-K', '20-F', '40-F']);
  if (lockedPeriod) {
    const exact = fact.periods.find(p => annualForms.has(p.form) && p.period === lockedPeriod);
    if (exact) return exact.value;
  }
  const annual = fact.periods.find(p => annualForms.has(p.form));
  return annual?.value ?? fact.periods[0]?.value ?? null;
}

function buildFCFBridgeChart(
  context: AnalysisContext,
  ticker: string,
  periodLock?: ChartPeriodLock,
): string | null {
  const facts = context.facts[ticker];
  if (!facts) return null;

  const netIncome = getFactValue(facts, 'net_income', periodLock?.current ?? null);
  const ocf = getFactValue(facts, 'operating_cash_flow', periodLock?.current ?? null);
  const capex = getFactValue(facts, 'capex', periodLock?.current ?? null);

  if (netIncome === null || ocf === null) return null;

  const adjustments = ocf - netIncome;
  const capexAbs = Math.abs(capex || 0);
  const fcf = ocf - capexAbs;

  interface WaterfallItem {
    label: string;
    value: number;
    type: 'base' | 'delta' | 'subtotal' | 'total';
  }

  const items: WaterfallItem[] = [
    { label: 'Net Income', value: netIncome, type: 'base' },
    { label: 'Non-Cash Adj.', value: adjustments, type: 'delta' },
    { label: 'CFO', value: ocf, type: 'subtotal' },
    { label: 'CapEx', value: -capexAbs, type: 'delta' },
    { label: 'FCF', value: fcf, type: 'total' },
  ];

  // Compute y-range from all positions
  const allYValues = [0, netIncome, ocf, fcf];
  let running = 0;
  for (const item of items) {
    if (item.type === 'base' || item.type === 'subtotal' || item.type === 'total') {
      running = item.value;
    } else {
      allYValues.push(running, running + item.value);
      running += item.value;
    }
  }

  const minY = Math.min(...allYValues);
  const maxY = Math.max(...allYValues);
  const yRange = maxY - minY || 1;
  const yFloor = minY - yRange * 0.1;
  const yCeil = maxY + yRange * 0.15;
  const totalYRange = yCeil - yFloor;

  const pad = { top: 30, right: 30, bottom: 50, left: 80 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  const barCount = items.length;
  const barSpacing = plotW / barCount;
  const barWidth = barSpacing * 0.55;

  const valToY = (v: number) => pad.top + plotH - ((v - yFloor) / totalYRange * plotH);
  const zeroY = valToY(0);

  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgBg(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgTitle(`${escSvg(ticker)} — Cash Flow Conversion`, CHART_WIDTH));

  // Grid lines
  const gridStep = niceStep(totalYRange, 5);
  for (let v = Math.ceil(yFloor / gridStep) * gridStep; v <= yCeil; v += gridStep) {
    const y = valToY(v);
    parts.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${formatAxisValue(v)}</text>`);
  }

  // Zero line
  if (yFloor <= 0 && yCeil >= 0) {
    parts.push(`<line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${pad.left + plotW}" y2="${zeroY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="3,2"/>`);
  }

  // Draw waterfall bars + connectors
  running = 0;
  let prevBarEndY = zeroY;

  for (let i = 0; i < barCount; i++) {
    const item = items[i]!;
    const cx = pad.left + i * barSpacing + barSpacing / 2;
    const x = cx - barWidth / 2;

    let barTop: number;
    let barBottom: number;
    let color: string;

    if (item.type === 'base' || item.type === 'subtotal' || item.type === 'total') {
      barTop = valToY(Math.max(0, item.value));
      barBottom = valToY(Math.min(0, item.value));
      color = COLORS.primary;
      running = item.value;
    } else {
      const start = running;
      const end = running + item.value;
      barTop = valToY(Math.max(start, end));
      barBottom = valToY(Math.min(start, end));
      color = item.value >= 0 ? COLORS.accent : COLORS.danger;
      running = end;
    }

    const barH = barBottom - barTop;

    // Connector line from previous bar
    if (i > 0) {
      const prevCx = pad.left + (i - 1) * barSpacing + barSpacing / 2;
      parts.push(`<line x1="${(prevCx + barWidth / 2).toFixed(1)}" y1="${prevBarEndY.toFixed(1)}" x2="${(cx - barWidth / 2).toFixed(1)}" y2="${prevBarEndY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="2,2"/>`);
    }

    // Bar
    parts.push(`<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${color}" rx="2" opacity="0.85"/>`);

    // Value label
    const labelY = item.value >= 0 ? barTop - 5 : barBottom + 12;
    parts.push(`<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" font-weight="600" fill="${color}">${formatAxisValue(item.value)}</text>`);

    // X-axis label
    parts.push(`<text x="${cx.toFixed(1)}" y="${pad.top + plotH + 16}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(item.label)}</text>`);

    prevBarEndY = valToY(running);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ── 3. Peer Normalized Scorecard ──────────────────────────────

function buildPeerScorecardChart(
  context: AnalysisContext,
  periodLocks: Record<string, ChartPeriodLock> = {},
): string | null {
  if (context.tickers.length < 2) return null;
  const tickers = context.tickers;
  const metricDefs: Array<{ key: string; label: string }> = [
    { key: 'revenue', label: 'Revenue' },
    { key: 'net_income', label: 'Net Income' },
    { key: 'operating_income', label: 'Operating Income' },
    { key: 'gross_profit', label: 'Gross Profit' },
    { key: 'operating_cash_flow', label: 'Operating Cash Flow' },
    { key: 'total_assets', label: 'Total Assets' },
    { key: 'stockholders_equity', label: "Stockholders' Equity" },
    { key: 'total_debt', label: 'Total Debt' },
  ];

  interface ZScoreRow {
    label: string;
    scores: Record<string, number>;
  }

  const rows: ZScoreRow[] = [];

  const canonicalByTicker = new Map<string, Map<string, Record<string, number>>>();
  for (const ticker of tickers) {
    canonicalByTicker.set(ticker, buildCanonicalAnnualPeriodMap(context, ticker));
  }

  for (const def of metricDefs) {
    const vals: number[] = [];
    const byTicker: Record<string, number> = {};
    for (const t of tickers) {
      const lock = periodLocks[t]?.current ?? null;
      const canonical = canonicalByTicker.get(t);
      if (!canonical) continue;
      const orderedPeriods = Array.from(canonical.keys()).sort((a, b) => b.localeCompare(a));
      const chosenPeriod = lock && canonical.has(lock) ? lock : orderedPeriods[0];
      if (!chosenPeriod) continue;
      const value = canonical.get(chosenPeriod)?.[def.key];
      if (value === undefined || value === null || !isFinite(value)) continue;
      byTicker[t] = value;
      vals.push(value);
    }
    if (vals.length < 2) continue;

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stddev = Math.sqrt(vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length);

    const scores: Record<string, number> = {};
    for (const t of tickers) {
      const v = byTicker[t];
      if (v === null || v === undefined || !isFinite(v)) continue;
      scores[t] = stddev > 0 ? Math.max(-2.5, Math.min(2.5, (v - mean) / stddev)) : 0;
    }

    const mapping = getMappingByName(def.key);
    rows.push({
      label: mapping?.displayName || def.label,
      scores,
    });
  }

  if (rows.length === 0) return null;

  const chartH = Math.max(200, 30 + rows.length * 35 + 40);
  const pad = { top: 30, right: 30, bottom: 40, left: 140 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;
  const rowH = plotH / rows.length;

  const zMin = -2.5;
  const zMax = 2.5;
  const zRange = zMax - zMin;
  const zToX = (z: number) => pad.left + ((z - zMin) / zRange) * plotW;
  const zeroX = zToX(0);
  const barH = Math.min(12, rowH / tickers.length * 0.7);

  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, chartH));
  parts.push(svgBg(CHART_WIDTH, chartH));
  parts.push(svgTitle(`${escSvg(tickers.join(' vs '))} — Peer Positioning`, CHART_WIDTH));

  // Vertical grid lines at z = -2, -1, 0, 1, 2
  for (let z = -2; z <= 2; z++) {
    const x = zToX(z);
    const isCenter = z === 0;
    parts.push(`<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="${isCenter ? COLORS.gray : COLORS.gridLine}" stroke-width="${isCenter ? 1 : 0.5}"${isCenter ? ' stroke-dasharray="4,3"' : ''}/>`);
    const sigmaLabel = z > 0 ? `+${z}` : `${z}`;
    parts.push(`<text x="${x.toFixed(1)}" y="${pad.top + plotH + 14}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${sigmaLabel}&#963;</text>`);
  }

  // Rows
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const rowCenterY = pad.top + r * rowH + rowH / 2;

    // Metric label
    const displayLabel = row.label.length > 20 ? row.label.slice(0, 20) + '...' : row.label;
    parts.push(`<text x="${pad.left - 8}" y="${rowCenterY + 4}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(displayLabel)}</text>`);

    // Row separator
    if (r > 0) {
      parts.push(`<line x1="${pad.left}" y1="${(pad.top + r * rowH).toFixed(1)}" x2="${pad.left + plotW}" y2="${(pad.top + r * rowH).toFixed(1)}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    }

    // Bars for each ticker
    const barGroup = tickers.filter(t => row.scores[t] !== undefined);
    const totalBarH = barGroup.length * barH;
    const startY = rowCenterY - totalBarH / 2;

    for (let b = 0; b < barGroup.length; b++) {
      const t = barGroup[b]!;
      const z = row.scores[t]!;
      const barX = z >= 0 ? zeroX : zToX(z);
      const barW = Math.abs(z) / zRange * plotW;
      const y = startY + b * barH;
      const color = CHART_COLORS[tickers.indexOf(t) % CHART_COLORS.length]!;

      parts.push(`<rect x="${barX.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW).toFixed(1)}" height="${(barH - 1).toFixed(1)}" fill="${color}" rx="1.5" opacity="0.85"/>`);
    }
  }

  // Legend
  const legendItems = tickers.map((t, i) => ({
    label: t,
    color: CHART_COLORS[i % CHART_COLORS.length]!,
    type: 'rect' as const,
  }));
  parts.push(buildLegend(legendItems, pad.left, chartH - 12));

  parts.push('</svg>');
  return parts.join('\n');
}

// ── 4. Return vs Leverage Quadrant ────────────────────────────

function buildReturnLeverageChart(
  context: AnalysisContext,
  periodLocks: Record<string, ChartPeriodLock> = {},
): string | null {
  if (context.tickers.length < 2) return null;

  interface DataPoint { ticker: string; roe: number; de: number }
  const points: DataPoint[] = [];

  for (const t of context.tickers) {
    const ratios = context.ratios[t] || [];
    const lock = periodLocks[t]?.current ?? null;
    const roe = lock
      ? ratios.find(r => r.name === 'roe' && r.period === lock) || ratios.find(r => r.name === 'roe')
      : ratios.find(r => r.name === 'roe');
    const de = lock
      ? ratios.find(r => r.name === 'de' && r.period === lock) || ratios.find(r => r.name === 'de')
      : ratios.find(r => r.name === 'de');
    if (roe && de) {
      points.push({ ticker: t, roe: roe.value * 100, de: de.value });
    }
  }

  if (points.length < 2) return null;

  const pad = { top: 30, right: 40, bottom: 50, left: 60 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  // Axis ranges with padding
  const allDE = points.map(p => p.de);
  const allROE = points.map(p => p.roe);
  const deMin = Math.max(0, Math.min(...allDE) - 0.3);
  const deMax = Math.max(...allDE) + 0.3;
  const roeMin = Math.min(...allROE) - 5;
  const roeMax = Math.max(...allROE) + 5;

  const medDE = arrMedian(allDE);
  const medROE = arrMedian(allROE);

  const xToPlot = (de: number) => pad.left + ((de - deMin) / (deMax - deMin)) * plotW;
  const yToPlot = (roe: number) => pad.top + plotH - ((roe - roeMin) / (roeMax - roeMin)) * plotH;

  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgBg(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgTitle('Return vs Leverage', CHART_WIDTH));

  // X-axis grid (D/E)
  const deStep = niceStep(deMax - deMin, 5);
  for (let v = Math.ceil(deMin / deStep) * deStep; v <= deMax; v += deStep) {
    const x = xToPlot(v);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${pad.top + plotH + 14}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${v.toFixed(1)}x</text>`);
  }
  parts.push(`<text x="${pad.left + plotW / 2}" y="${pad.top + plotH + 30}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">D/E Ratio</text>`);

  // Y-axis grid (ROE)
  const roeStep = niceStep(roeMax - roeMin, 5);
  for (let v = Math.ceil(roeMin / roeStep) * roeStep; v <= roeMax; v += roeStep) {
    const y = yToPlot(v);
    parts.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${v.toFixed(0)}%</text>`);
  }
  parts.push(`<text x="14" y="${pad.top + plotH / 2}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}" transform="rotate(-90 14 ${pad.top + plotH / 2})">ROE (%)</text>`);

  // Median lines (dashed) creating quadrants
  const medX = xToPlot(medDE);
  const medY = yToPlot(medROE);
  parts.push(`<line x1="${medX.toFixed(1)}" y1="${pad.top}" x2="${medX.toFixed(1)}" y2="${pad.top + plotH}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="4,3"/>`);
  parts.push(`<line x1="${pad.left}" y1="${medY.toFixed(1)}" x2="${pad.left + plotW}" y2="${medY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="4,3"/>`);

  // Quadrant labels
  const qs = 7;
  const qp = 6;
  parts.push(`<text x="${pad.left + qp}" y="${pad.top + qp + qs}" font-family="Times New Roman, Times, serif" font-size="${qs}" fill="${COLORS.accent}" opacity="0.6">High Return / Low Leverage</text>`);
  parts.push(`<text x="${pad.left + plotW - qp}" y="${pad.top + qp + qs}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="${qs}" fill="${COLORS.warning}" opacity="0.6">High Return / High Leverage</text>`);
  parts.push(`<text x="${pad.left + qp}" y="${pad.top + plotH - qp}" font-family="Times New Roman, Times, serif" font-size="${qs}" fill="${COLORS.gray}" opacity="0.6">Low Return / Low Leverage</text>`);
  parts.push(`<text x="${pad.left + plotW - qp}" y="${pad.top + plotH - qp}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="${qs}" fill="${COLORS.danger}" opacity="0.6">Low Return / High Leverage</text>`);

  // Data points
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const cx = xToPlot(p.de);
    const cy = yToPlot(p.roe);
    const color = CHART_COLORS[i % CHART_COLORS.length]!;

    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${color}" stroke="${COLORS.background}" stroke-width="2" opacity="0.9"/>`);
    parts.push(`<text x="${(cx + 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-family="Times New Roman, Times, serif" font-size="9" font-weight="600" fill="${color}">${escSvg(p.ticker)}</text>`);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ── 5. Growth Durability ──────────────────────────────────────

function buildGrowthDurabilityChart(
  context: AnalysisContext,
  ticker: string,
  periodLock?: ChartPeriodLock,
): string | null {
  const trends = context.trends[ticker] || [];
  const revenueTrend = trends.find(t => t.metric === 'revenue');
  if (!revenueTrend || revenueTrend.values.length < 3) return null;

  const periods = selectAnnualChartValues(revenueTrend.values, 6, periodLock?.current ?? null);
  if (periods.length < 3) return null;

  const growthPeriods: Array<{ period: string; growth: number }> = [];
  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1]!;
    const curr = periods[i]!;
    if (!isFinite(prev.value) || !isFinite(curr.value) || prev.value <= 0) continue;
    if (classifyChangeMeaning(curr.value, prev.value) !== 'ok') continue;
    growthPeriods.push({
      period: curr.period,
      growth: ((curr.value / prev.value) - 1) * 100,
    });
  }
  const normalizedGrowth = normalizeGrowthSeries(growthPeriods);
  if (normalizedGrowth.length < 2) return null;

  const growthRates = normalizedGrowth.map(p => p.growth);

  // 3-year rolling CAGR
  const cagrPoints: { idx: number; cagr: number }[] = [];
  for (let i = 3; i < periods.length; i++) {
    const startVal = periods[i - 3]!;
    const endVal = periods[i]!;
    if (startVal.value > 0) {
      const cagr = (Math.pow(endVal.value / startVal.value, 1 / 3) - 1) * 100;
      cagrPoints.push({ idx: i - 1, cagr });
    }
  }

  // Stats for volatility band
  const meanGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
  const stddev = Math.sqrt(growthRates.reduce((sum, v) => sum + (v - meanGrowth) ** 2, 0) / growthRates.length);

  const overallCagr = revenueTrend.cagr !== null ? (revenueTrend.cagr * 100).toFixed(1) : null;

  const pad = { top: 30, right: 30, bottom: 50, left: 60 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  const n = normalizedGrowth.length;
  const barSpacing = plotW / n;
  const barWidth = barSpacing * 0.55;

  // Y-axis range
  const allVals = [...growthRates, meanGrowth + stddev, meanGrowth - stddev, ...cagrPoints.map(c => c.cagr)];
  const minVal = Math.min(0, ...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 10;
  const yFloor = minVal - range * 0.1;
  const yCeil = maxVal + range * 0.15;
  const totalRange = yCeil - yFloor;

  const valToY = (v: number) => pad.top + plotH - ((v - yFloor) / totalRange * plotH);
  const zeroY = valToY(0);

  const titleCagr = overallCagr ? ` (${overallCagr}% CAGR)` : '';

  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgBg(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgTitle(`${escSvg(ticker)} — Revenue Growth${titleCagr}`, CHART_WIDTH));

  // Grid lines
  const yStep = niceStep(totalRange, 5);
  for (let v = Math.ceil(yFloor / yStep) * yStep; v <= yCeil; v += yStep) {
    const y = valToY(v);
    parts.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${v.toFixed(0)}%</text>`);
  }

  // Zero line
  if (yFloor <= 0 && yCeil >= 0) {
    parts.push(`<line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${pad.left + plotW}" y2="${zeroY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1"/>`);
  }

  // Volatility band (mean ± 1 stddev)
  const bandTop = valToY(meanGrowth + stddev);
  const bandBottom = valToY(meanGrowth - stddev);
  const bandH = bandBottom - bandTop;
  parts.push(`<rect x="${pad.left}" y="${bandTop.toFixed(1)}" width="${plotW}" height="${bandH.toFixed(1)}" fill="${COLORS.secondary}" opacity="0.08" rx="2"/>`);

  // Mean line
  const meanY = valToY(meanGrowth);
  parts.push(`<line x1="${pad.left}" y1="${meanY.toFixed(1)}" x2="${pad.left + plotW}" y2="${meanY.toFixed(1)}" stroke="${COLORS.secondary}" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/>`);

  // YoY Growth bars
  for (let i = 0; i < n; i++) {
    const g = growthRates[i]!;
    const cx = pad.left + i * barSpacing + barSpacing / 2;
    const x = cx - barWidth / 2;
    const barTop = g >= 0 ? valToY(g) : zeroY;
    const barBot = g >= 0 ? zeroY : valToY(g);
    const barH = barBot - barTop;
    const color = g >= 0 ? COLORS.primary : COLORS.danger;

    parts.push(`<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${color}" rx="2" opacity="0.75"/>`);

    // Value label
    const labelY = g >= 0 ? barTop - 4 : barBot + 12;
    parts.push(`<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" font-weight="600" fill="${color}">${g.toFixed(1)}%</text>`);

    // X-axis label
    parts.push(`<text x="${cx.toFixed(1)}" y="${pad.top + plotH + 16}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(formatPeriodShort(normalizedGrowth[i]!.period))}</text>`);
  }

  // 3Y CAGR overlay line
  if (cagrPoints.length >= 2) {
    const linePoints: string[] = [];
    for (const cp of cagrPoints) {
      const cx = pad.left + cp.idx * barSpacing + barSpacing / 2;
      const cy = valToY(cp.cagr);
      linePoints.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
    }
    parts.push(`<polyline points="${linePoints.join(' ')}" fill="none" stroke="${COLORS.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const pt of linePoints) {
      const [cx, cy] = pt.split(',');
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${COLORS.accent}" stroke="${COLORS.background}" stroke-width="1.5"/>`);
    }
  }

  // Legend
  const legendItems: LegendItem[] = [
    { label: 'YoY Growth', color: COLORS.primary, type: 'rect' },
  ];
  if (cagrPoints.length >= 2) {
    legendItems.push({ label: '3Y Rolling CAGR', color: COLORS.accent, type: 'line' });
  }
  legendItems.push({ label: '\u00b11\u03c3 Band', color: COLORS.secondary, type: 'rect' });
  parts.push(buildLegend(legendItems, pad.left, pad.top + plotH + 34));

  parts.push('</svg>');
  return parts.join('\n');
}

// ── Utility functions ─────────────────────────────────────────

function formatAxisValue(n: number): string {
  return formatCompactCurrency(n, { smallDecimals: 0, smartDecimals: true });
}

function normalizeGrowthSeries(
  points: Array<{ period: string; growth: number }>,
): Array<{ period: string; growth: number }> {
  if (points.length <= 3) return points;
  let out = [...points];
  while (
    out.length > 3 &&
    Math.abs(out[0]!.growth) > 150 &&
    Math.abs(out[0]!.growth) > Math.abs(out[1]!.growth) * 2
  ) {
    // Drop leading base-effect outliers so one transition does not swamp
    // the whole chart and hide the subsequent operating pattern.
    out = out.slice(1);
  }
  return out;
}

function selectAnnualChartValues(
  values: TrendData['values'],
  maxPoints: number,
  lockCurrent: string | null = null,
): TrendData['values'] {
  // Keep a single representative period per fiscal year to avoid mixed
  // year-start/year-end artifacts in chart labels and growth math.
  const byYear = new Map<number, TrendData['values'][number]>();
  const sorted = [...values]
    .filter(v => !lockCurrent || v.period.localeCompare(lockCurrent) <= 0)
    .sort((a, b) => a.period.localeCompare(b.period));
  for (const v of sorted) {
    const date = new Date(v.period);
    if (isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    const prev = byYear.get(year);
    if (!prev || v.period > prev.period) {
      byYear.set(year, v);
    }
  }
  return Array.from(byYear.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-maxPoints);
}

function formatPeriodShort(period: string): string {
  const date = new Date(period);
  if (isNaN(date.getTime())) return period;
  const year = date.getUTCFullYear() % 100;
  const yr = year.toString().padStart(2, '0');
  return `FY'${yr}`;
}

function escSvg(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgOpen(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;height:auto;">`;
}

function svgBg(w: number, h: number): string {
  return `<rect width="${w}" height="${h}" fill="${COLORS.background}" rx="4"/>`;
}

function svgTitle(text: string, w: number): string {
  return `<text x="${w / 2}" y="20" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="14" font-weight="700" fill="${COLORS.primary}">${text}</text>`;
}

/** Round up to a "nice" axis maximum */
function niceMax(val: number): number {
  if (val <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  const norm = val / magnitude;
  if (norm <= 1) return magnitude;
  if (norm <= 2) return 2 * magnitude;
  if (norm <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

/** Compute a nice step size for axis ticks */
function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / magnitude;
  if (norm <= 1.5) return magnitude;
  if (norm <= 3.5) return 2 * magnitude;
  if (norm <= 7.5) return 5 * magnitude;
  return 10 * magnitude;
}

function arrMedian(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface LegendItem {
  label: string;
  color: string;
  type: 'rect' | 'line';
}

function buildLegend(items: LegendItem[], startX: number, y: number): string {
  const parts: string[] = [];
  let x = startX;
  for (const item of items) {
    if (item.type === 'line') {
      parts.push(`<line x1="${x}" y1="${y - 3}" x2="${x + 12}" y2="${y - 3}" stroke="${item.color}" stroke-width="2" stroke-linecap="round"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y - 6}" width="12" height="8" rx="1.5" fill="${item.color}" opacity="0.75"/>`);
    }
    parts.push(`<text x="${x + 16}" y="${y}" font-family="Times New Roman, Times, serif" font-size="9.2" fill="${COLORS.gray}">${escSvg(item.label)}</text>`);
    x += 18 + item.label.length * 5.6 + 16;
  }
  return parts.join('\n');
}
