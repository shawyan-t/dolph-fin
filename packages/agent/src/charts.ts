/**
 * Deterministic SVG Chart Generation.
 *
 * 1. Revenue + Margin (dual-axis) — bars + margin overlay lines
 * 2. FCF Bridge Waterfall — Net Income → Adjustments → CFO → CapEx → FCF
 *
 * Pure string-based SVG construction, no external dependencies.
 */

import { formatCompactCurrency } from '@dolph/shared';
import type { CompanyReportModel, ReportModel } from './report-model.js';
import { PDF_THEME } from './pdf-theme.js';

// ── Color palette ─────────────────────────────────────────────

const COLORS = {
  primary: PDF_THEME.colors.accentInk,
  secondary: '#5E748A',
  accent: PDF_THEME.colors.positive,
  warning: PDF_THEME.colors.caution,
  danger: PDF_THEME.colors.negative,
  gray: PDF_THEME.colors.mutedText,
  gridLine: PDF_THEME.colors.rule,
  background: PDF_THEME.colors.page,
};


// ── Chart dimensions ──────────────────────────────────────────

const CHART_WIDTH = 700;
const CHART_HEIGHT = 360;

// ── Public API ────────────────────────────────────────────────

export interface ChartSet {
  revenueMarginChart: string | null;
  fcfBridgeChart: string | null;
}

export interface ChartPeriodLock {
  current: string | null;
  prior: string | null;
}

export function generateChartsForReportModel(
  reportModel: ReportModel,
): ChartSet {
  const company = reportModel.companies[0];
  if (!company) {
    return {
      revenueMarginChart: null,
      fcfBridgeChart: null,
    };
  }

  return {
    revenueMarginChart: buildRevenueMarginChartFromCompany(company),
    fcfBridgeChart: buildFCFBridgeChartFromCompany(company),
  };
}

function buildRevenueMarginChartFromCompany(
  company: CompanyReportModel,
): string | null {
  const periods = selectCompanyChartPeriods(company, 5);
  if (periods.length < 2) return null;

  const series = periods
    .map(period => {
      const values = company.canonicalPeriodMap.get(period) || {};
      const revenue = finiteOrNull(values['revenue']);
      if (revenue === null) return null;
      return {
        period,
        revenue,
        grossMargin: safeDivideValue(values['gross_profit'], values['revenue']),
        operatingMargin: safeDivideValue(values['operating_income'], values['revenue']),
        netMargin: safeDivideValue(values['net_income'], values['revenue']),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  if (series.length < 2) return null;

  const n = series.length;
  const pad = { top: 30, right: 60, bottom: 50, left: 80 };
  const plotW = CHART_WIDTH - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;
  const revenues = series.map(point => point.revenue);
  const maxRev = Math.max(...revenues);
  const revCeil = niceMax(maxRev);

  type MarginLine = { label: string; color: string; dash?: string; values: (number | null)[] };
  const marginLines: MarginLine[] = [];
  const gross = { label: 'Gross Margin', color: COLORS.accent, values: series.map(point => point.grossMargin) };
  const operating = { label: 'Op. Margin', color: COLORS.secondary, values: series.map(point => point.operatingMargin) };
  const net = { label: 'Net Margin', color: COLORS.warning, dash: '4,3', values: series.map(point => point.netMargin) };
  if (gross.values.some(value => value !== null)) marginLines.push(gross);
  if (operating.values.some(value => value !== null)) marginLines.push(operating);
  if (net.values.some(value => value !== null)) marginLines.push(net);

  const allMargins = marginLines.flatMap(line => line.values.filter((value): value is number => value !== null));
  const maxMarginPct = allMargins.length > 0 ? Math.max(...allMargins) * 100 : 50;
  const marginCeil = Math.ceil(maxMarginPct / 10) * 10 + 10;

  const barSpacing = plotW / n;
  const barWidth = barSpacing * 0.55;
  const parts: string[] = [];
  parts.push(svgOpen(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgBg(CHART_WIDTH, CHART_HEIGHT));
  parts.push(svgTitle(`${escSvg(company.ticker)} — Revenue &amp; Margin Profile`, CHART_WIDTH));

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.top + (plotH * i / yTicks);
    const value = revCeil * (1 - i / yTicks);
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${formatAxisValue(value)}</text>`);
  }
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.top + (plotH * i / yTicks);
    const pct = marginCeil * (1 - i / yTicks);
    parts.push(`<text x="${pad.left + plotW + 8}" y="${y + 3}" text-anchor="start" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${pct.toFixed(0)}%</text>`);
  }

  for (let i = 0; i < n; i++) {
    const x = pad.left + i * barSpacing + (barSpacing - barWidth) / 2;
    const barH = (revenues[i]! / revCeil) * plotH;
    const y = pad.top + plotH - barH;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${COLORS.primary}" rx="2" opacity="0.75"/>`);
  }
  for (let i = 0; i < n; i++) {
    const x = pad.left + i * barSpacing + barSpacing / 2;
    parts.push(`<text x="${x}" y="${pad.top + plotH + 16}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(formatPeriodShort(series[i]!.period))}</text>`);
  }

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

  const legendItems: LegendItem[] = [
    { label: 'Revenue', color: COLORS.primary, type: 'rect' },
    ...marginLines.map(ml => ({ label: ml.label, color: ml.color, type: 'line' as const })),
  ];
  parts.push(buildLegend(legendItems, pad.left, pad.top + plotH + 34));
  parts.push('</svg>');
  return parts.join('\n');
}

function buildFCFBridgeChartFromCompany(
  company: CompanyReportModel,
): string | null {
  const netIncome = company.metricsByKey.get('net_income')?.current ?? null;
  const operatingCashFlow = company.metricsByKey.get('operating_cash_flow')?.current ?? null;
  const capex = company.metricsByKey.get('capex')?.current ?? null;
  if (netIncome === null || operatingCashFlow === null || capex === null) return null;

  const adjustments = operatingCashFlow - netIncome;
  const capexAbs = Math.abs(capex);
  const fcf = company.metricsByKey.get('fcf')?.current ?? (operatingCashFlow - capexAbs);
  if (fcf === null) return null;

  interface WaterfallItem {
    label: string;
    value: number;
    type: 'base' | 'delta' | 'subtotal' | 'total';
  }

  const items: WaterfallItem[] = [
    { label: 'Net Income', value: netIncome, type: 'base' },
    { label: 'Non-Cash Adj.', value: adjustments, type: 'delta' },
    { label: 'CFO', value: operatingCashFlow, type: 'subtotal' },
    { label: 'CapEx', value: -capexAbs, type: 'delta' },
    { label: 'FCF', value: fcf, type: 'total' },
  ];

  const allYValues = [0, netIncome, operatingCashFlow, fcf];
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
  parts.push(svgTitle(`${escSvg(company.ticker)} — Cash Flow Conversion`, CHART_WIDTH));

  const gridStep = niceStep(totalYRange, 5);
  for (let v = Math.ceil(yFloor / gridStep) * gridStep; v <= yCeil; v += gridStep) {
    const y = valToY(v);
    parts.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" stroke="${COLORS.gridLine}" stroke-width="0.5"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${formatAxisValue(v)}</text>`);
  }
  if (yFloor <= 0 && yCeil >= 0) {
    parts.push(`<line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${pad.left + plotW}" y2="${zeroY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="3,2"/>`);
  }

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
    if (i > 0) {
      const prevCx = pad.left + (i - 1) * barSpacing + barSpacing / 2;
      parts.push(`<line x1="${(prevCx + barWidth / 2).toFixed(1)}" y1="${prevBarEndY.toFixed(1)}" x2="${(cx - barWidth / 2).toFixed(1)}" y2="${prevBarEndY.toFixed(1)}" stroke="${COLORS.gray}" stroke-width="1" stroke-dasharray="2,2"/>`);
    }
    parts.push(`<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${color}" rx="2" opacity="0.85"/>`);
    const labelY = item.value >= 0 ? barTop - 5 : barBottom + 12;
    parts.push(`<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" font-weight="600" fill="${color}">${formatAxisValue(item.value)}</text>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${pad.top + plotH + 16}" text-anchor="middle" font-family="Times New Roman, Times, serif" font-size="9" fill="${COLORS.gray}">${escSvg(item.label)}</text>`);
    prevBarEndY = valToY(running);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ── Utility functions ─────────────────────────────────────────

function formatAxisValue(n: number): string {
  return formatCompactCurrency(n, { smallDecimals: 0, smartDecimals: true });
}

function selectCompanyChartPeriods(
  company: CompanyReportModel,
  maxPoints: number,
): string[] {
  return Array.from(company.canonicalPeriodMap.keys())
    .filter(period => !company.snapshotPeriod || period.localeCompare(company.snapshotPeriod) <= 0)
    .sort((a, b) => a.localeCompare(b))
    .slice(-maxPoints);
}

function finiteOrNull(value: number | undefined): number | null {
  if (value === undefined || !isFinite(value)) return null;
  return value;
}

function safeDivideValue(
  numerator: number | undefined,
  denominator: number | undefined,
): number | null {
  const a = finiteOrNull(numerator);
  const b = finiteOrNull(denominator);
  if (a === null || b === null || b === 0) return null;
  return a / b;
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
