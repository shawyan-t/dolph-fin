import type { AnalysisContext, FinancialStatement, Report, ReportSection } from '@dolph/shared';
import {
  getMappingByName,
  getMappingsForStatement,
  formatCompactCurrency,
  formatCompactShares,
  formatFiscalPeriodLabel,
  formatMetricChange,
} from '@dolph/shared';
import {
  PDF_RENDER_RULES,
  clampWords,
  clipBullets,
  extractBullets,
  isUnavailableDisplay,
  normalizeDisplayCell,
  normalizeMissingDataMarkdown,
  parseMetricRows,
  stripMarkdown,
} from './pdf-render-rules.js';
import { generateChartsWithLocks, type ChartPeriodLock } from './charts.js';
import { packDeterministicPages, type LayoutModule } from './layout-packer.js';
import {
  type CanonicalMetricCell,
  type CompanyReportModel,
  type ReportModel,
} from './report-model.js';
import { comparisonBasisDescription, comparisonBasisLabel } from './report-policy.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';
import type { AnalysisInsights } from './analyzer.js';

export interface PdfPageBuildResult {
  bodyHTML: string;
}

export const PERIOD_BANNER_SLOT = '<!-- DOLPH_PERIOD_BANNER -->';

interface DashboardGroup {
  title: string;
  headers: string[];
  rows: string[][];
}

interface AppendixModule {
  title: string;
  headers: string[];
  rows: string[][];
}

interface MetricRow {
  metric: string;
  current: string;
  prior: string;
  change: string;
}

export function buildPdfPages(
  report: Report,
  context?: AnalysisContext,
  canonicalPackage?: CanonicalReportPackage,
): PdfPageBuildResult {
  const sections = indexSections(report.sections);
  const keyMetricsMarkdown = normalizeMissingDataMarkdown(sections['key_metrics']?.content || '');
  const pkg = context ? requireCanonicalReportPackage(canonicalPackage, 'buildPdfPages') : null;
  const insights = pkg?.insights || {};
  const reportModel = pkg?.reportModel || null;
  const primaryCompany = reportModel?.companies[0] || null;
  const metricRows = primaryCompany
    ? metricRowsFromCompany(primaryCompany)
    : parseMetricRows(keyMetricsMarkdown);
  const periodLocks: Record<string, ChartPeriodLock> = context
    ? Object.fromEntries(
      context.tickers.map(ticker => {
        const basis = insights[ticker];
        return [ticker, { current: basis?.snapshotPeriod ?? null, prior: basis?.priorPeriod ?? null }];
      }),
    )
    : {};
  const pages: string[] = [];

  pages.push(buildCoverPage(report, sections, metricRows, context, insights, reportModel));
  pages.push(buildExecutivePage(report, sections, metricRows, context, reportModel));
  pages.push(...buildVisualPages(context, periodLocks, reportModel));
  pages.push(...buildDashboardPages(keyMetricsMarkdown, context, metricRows, periodLocks, reportModel));
  pages.push(buildCommentaryPage(report, sections, context, metricRows, periodLocks, reportModel));
  pages.push(...buildAppendixPages(report, context, sections, insights, reportModel, pkg || undefined));
  pages.push(buildSourcesPage(context, sections, report, reportModel, pkg || undefined));

  return { bodyHTML: pages.filter(Boolean).join('\n') };
}

function indexSections(sections: ReportSection[]): Record<string, ReportSection> {
  const map: Record<string, ReportSection> = {};
  for (const section of sections) map[section.id] = section;
  return map;
}

function buildCoverPage(
  report: Report,
  sections: Record<string, ReportSection>,
  metricRows: MetricRow[],
  context?: AnalysisContext,
  insights: Record<string, AnalysisInsights> = {},
  reportModel: ReportModel | null = null,
): string {
  const kpiPriority = [
    'Revenue',
    'Net Income',
    'Operating Margin',
    'Free Cash Flow',
    'Debt-to-Equity',
    'Current Ratio',
    'Return on Equity',
  ];
  const cards: MetricRow[] = [];
  for (const metric of kpiPriority) {
    const row = metricRows.find(r => r.metric === metric && !isUnavailableDisplay(r.current));
    if (!row) continue;
    cards.push(row);
    if (cards.length >= PDF_RENDER_RULES.cover.maxKpis) break;
  }

  const thesis = composeCoverThesis(report, metricRows);
  const glance = composeCoverBullets(metricRows, sections, report, context, insights, reportModel);
  const companyTitle = report.type === 'single'
    ? (context?.facts?.[report.tickers[0] || '']?.company_name || report.tickers[0] || 'N/A')
    : report.tickers.join(' vs ');
  const peerKpiStrip = report.type === 'comparison'
    ? buildComparisonCoverStrip(context, insights)
    : '';
  const comparisonDisclosure = report.type === 'comparison'
    ? buildComparisonGovernanceNotice(reportModel)
    : '';
  const singleKpis = report.type === 'comparison'
    ? ''
    : `
      <div class="cover-kpis">
        ${cards.map(kpi => `
          <article class="kpi-card">
            <div class="kpi-label">${escapeHTML(kpi.metric)}</div>
            <div class="kpi-value">${escapeHTML(normalizeDisplayCell(kpi.current))}</div>
            <div class="kpi-note">${escapeHTML(formatKpiNote(kpi))}</div>
          </article>
        `).join('\n')}
      </div>
    `;

  return `
    <section class="report-page page-cover">
      <div class="cover-top">
        <div class="cover-brand">Dolph Research</div>
        <div class="cover-family">${escapeHTML(report.type === 'comparison' ? 'Peer Comparison Brief' : 'Equity Research Note')}</div>
        <div class="cover-date">${escapeHTML(formatDate(report.generated_at))}</div>
      </div>
      <div class="cover-hero">
        <h1>${escapeHTML(companyTitle)}</h1>
        <p class="cover-thesis">${escapeHTML(thesis)}</p>
      </div>
      ${singleKpis}
      ${peerKpiStrip}
      ${comparisonDisclosure}
      <div class="cover-glance">
        <h3>At a glance</h3>
        <ul>
          ${glance.map(item => `<li>${escapeHTML(item)}</li>`).join('\n')}
        </ul>
      </div>
    </section>
  `;
}

function formatKpiNote(kpi: MetricRow): string {
  const change = normalizeDisplayCell(kpi.change);
  if (!isUnavailableDisplay(change)) return change;
  const prior = normalizeDisplayCell(kpi.prior);
  if (!isUnavailableDisplay(prior)) return `Prior: ${prior}`;
  return 'Latest annual snapshot';
}

function composeCoverThesis(report: Report, rows: MetricRow[]): string {
  const revenue = rows.find(r => r.metric === 'Revenue')?.current;
  const netIncome = rows.find(r => r.metric === 'Net Income')?.current;
  const opMargin = rows.find(r => r.metric === 'Operating Margin')?.current;

  if (report.type === 'comparison') {
    if (revenue && netIncome) {
      return `This brief compares scale, margin quality, and funding profile across ${report.tickers.join(' and ')}, anchored to the latest annual filings.`;
    }
    return `This peer brief focuses on relative profitability, balance-sheet resilience, and cash-flow quality across the selected companies.`;
  }

  if (revenue && netIncome && opMargin) {
    return `This note frames the current earnings base for ${report.tickers[0]} with emphasis on profitability, capital structure, and cash-flow durability.`;
  }
  return `This report summarizes the latest annual fundamentals for ${report.tickers[0]} and highlights where risk and durability are concentrated.`;
}

function composeCoverBullets(
  rows: MetricRow[],
  sections: Record<string, ReportSection>,
  report: Report,
  context?: AnalysisContext,
  insights: Record<string, AnalysisInsights> = {},
  reportModel: ReportModel | null = null,
): string[] {
  if (report.type === 'comparison' && context) {
    const bullets = buildComparisonCoverBullets(context, insights);
    if (reportModel) {
      const completenessNotes = reportModel.companies
        .filter(company => isUnavailableDisplay(company.metricsByLabel.get('Debt-to-Equity')?.currentDisplay || 'N/A'))
        .map(company => company.ticker);
      if (completenessNotes.length > 0 && bullets.length < PDF_RENDER_RULES.cover.maxBullets) {
        bullets.push(`Leverage comparisons exclude missing debt mappings for ${completenessNotes.join(', ')}.`);
      }
    }
    if (bullets.length >= 3) return clipBullets(bullets, PDF_RENDER_RULES.cover.maxBullets);
  }

  const out: string[] = [];
  const revenue = rows.find(r => r.metric === 'Revenue');
  const netIncome = rows.find(r => r.metric === 'Net Income');
  const de = rows.find(r => r.metric === 'Debt-to-Equity');
  const current = rows.find(r => r.metric === 'Current Ratio');
  const fcf = rows.find(r => r.metric === 'Free Cash Flow');
  const opMargin = rows.find(r => r.metric === 'Operating Margin');

  if (revenue && !isUnavailableDisplay(revenue.current)) {
    const ch = normalizeDisplayCell(revenue.change);
    out.push(!isUnavailableDisplay(ch)
      ? `Revenue is ${revenue.current} with ${ch} change versus the prior period.`
      : `Revenue is currently ${revenue.current} on the latest annual filing.`);
  }
  if (netIncome && !isUnavailableDisplay(netIncome.current)) {
    out.push(`Net income is ${netIncome.current}, indicating current earnings scale.`);
  }
  if (de && current && !isUnavailableDisplay(de.current) && !isUnavailableDisplay(current.current)) {
    out.push(`Balance sheet reads at ${de.current} debt-to-equity and ${normalizeDisplayCell(current.current)} current ratio.`);
  } else if (opMargin) {
    out.push(`Operating margin is ${normalizeDisplayCell(opMargin.current)}, supporting the current profitability profile.`);
  }
  if (fcf && !isUnavailableDisplay(fcf.current)) {
    out.push(`Free cash flow is ${fcf.current}, a key check on earnings conversion quality.`);
  }

  // Avoid anomaly-heavy wording on cover.
  if (out.length < 3) {
    const watch = sanitizeBullets(extractBullets(sections['risk_factors']?.content || '')).find(
      b => !/sigma|z-score|anomaly|mean|std|spike/i.test(b),
    );
    if (watch) out.push(watch);
  }

  while (out.length < 3) {
    const fallback = [
      'The snapshot prioritizes durable profitability over one-period anomalies.',
      'Balance-sheet resilience is evaluated through leverage and liquidity together.',
      'Cash generation quality remains the key test for forward confidence.',
    ][out.length];
    out.push(fallback || 'Core signals are grounded in the latest annual filing evidence.');
  }

  return clipBullets(out.filter(Boolean), PDF_RENDER_RULES.cover.maxBullets);
}

function buildComparisonCoverStrip(
  context: AnalysisContext | undefined,
  insights: Record<string, AnalysisInsights>,
): string {
  if (!context || context.tickers.length === 0) return '';
  const kpiNames = ['Revenue', 'Net Income', 'Operating Margin', 'Free Cash Flow'];
  const cols = context.tickers.map(ticker => {
    const company = context.facts[ticker]?.company_name || ticker;
    const metricMap = insights[ticker]?.keyMetrics || {};
    const items = kpiNames
      .map(name => {
        const datum = metricMap[name];
        if (!datum || datum.current === null || !isFinite(datum.current)) return null;
        return {
          name,
          value: formatMetricDatumValue(datum.current, datum.unit),
        };
      })
      .filter((item): item is { name: string; value: string } => !!item);

    if (items.length === 0) return '';
    return `
      <article class="peer-kpi-col">
        <h3>${escapeHTML(company)} <span>(${escapeHTML(ticker)})</span></h3>
        <ul>
          ${items.map(item => `
            <li>
              <span>${escapeHTML(item.name)}</span>
              <strong>${escapeHTML(item.value)}</strong>
            </li>
          `).join('\n')}
        </ul>
      </article>
    `;
  }).filter(Boolean);

  if (cols.length === 0) return '';
  return `<div class="peer-kpi-strip">${cols.join('\n')}</div>`;
}

function buildComparisonCoverBullets(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string[] {
  const bullets: string[] = [];
  const byTicker = context.tickers.map(ticker => ({
    ticker,
    revenue: insights[ticker]?.keyMetrics['Revenue']?.current ?? null,
    netMargin: insights[ticker]?.keyMetrics['Net Margin']?.current ?? null,
    de: insights[ticker]?.keyMetrics['Debt-to-Equity']?.current ?? null,
    fcf: insights[ticker]?.keyMetrics['Free Cash Flow']?.current ?? null,
  }));

  const revenueRank = byTicker.filter(x => x.revenue !== null).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  if (revenueRank.length >= 2) {
    const lead = revenueRank[0]!;
    const lag = revenueRank[1]!;
    bullets.push(
      `${lead.ticker} leads on revenue scale (${formatCompactCurrency(lead.revenue!, { smallDecimals: 0, smartDecimals: true })} vs ${lag.ticker} at ${formatCompactCurrency(lag.revenue!, { smallDecimals: 0, smartDecimals: true })}).`,
    );
  }

  const marginRank = byTicker.filter(x => x.netMargin !== null).sort((a, b) => (b.netMargin ?? 0) - (a.netMargin ?? 0));
  if (marginRank.length >= 2) {
    const lead = marginRank[0]!;
    bullets.push(`${lead.ticker} currently leads on net margin at ${((lead.netMargin || 0) * 100).toFixed(1)}%.`);
  }

  const leverageRank = byTicker.filter(x => x.de !== null).sort((a, b) => (a.de ?? 99) - (b.de ?? 99));
  if (leverageRank.length === byTicker.length && leverageRank.length >= 2) {
    const conservative = leverageRank[0]!;
    bullets.push(`${conservative.ticker} has the most conservative leverage profile at ${(conservative.de || 0).toFixed(2)}x debt-to-equity.`);
  }

  const fcfRank = byTicker.filter(x => x.fcf !== null).sort((a, b) => (b.fcf ?? 0) - (a.fcf ?? 0));
  if (fcfRank.length >= 2 && bullets.length < 3) {
    bullets.push(`${fcfRank[0]!.ticker} leads current free cash generation at ${formatCompactCurrency(fcfRank[0]!.fcf!, { smallDecimals: 0, smartDecimals: true })}.`);
  }

  return bullets;
}

function buildComparisonGovernanceNotice(reportModel: ReportModel | null): string {
  if (!reportModel || reportModel.type !== 'comparison') return '';
  const policy = reportModel.companies[0]?.policy;
  if (!policy) return '';
  const effectiveMode = reportModel.comparisonBasis?.effective_mode || policy.comparisonBasisMode;
  const note = reportModel.comparisonBasis?.note || comparisonBasisDescription(policy);
  return `
    <div class="cover-governance-note">
      <strong>${escapeHTML(comparisonBasisLabel(effectiveMode))}</strong>
      <span>${escapeHTML(note)}</span>
    </div>
  `;
}

function metricRowsFromCompany(company: CompanyReportModel): MetricRow[] {
  return company.metrics.map(metric => ({
    metric: metric.label,
    current: metric.currentDisplay,
    prior: metric.priorDisplay,
    change: metric.changeDisplay,
  }));
}

function metricCell(
  company: CompanyReportModel,
  label: string,
): CanonicalMetricCell | null {
  return company.metricsByLabel.get(label) || null;
}

function metricRowsFromInsights(insight: AnalysisInsights | null): MetricRow[] {
  if (!insight) return [];
  return Object.entries(insight.keyMetrics).map(([metric, datum]) => ({
    metric,
    current: formatMetricDatumValue(datum.current, datum.unit),
    prior: datum.prior !== null ? formatMetricDatumValue(datum.prior, datum.unit) : 'N/A',
    change: formatMetricChange(datum.change, datum.current, datum.prior),
  }));
}

function formatMetricDatumValue(value: number, unit: string): string {
  if (!isFinite(value)) return 'N/A';
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'USD' || unit === 'USD/share' || unit === 'USD/shares') return formatByUnit(value, unit === 'USD' ? 'USD' : 'USD/shares');
  if (unit === 'shares') return formatCompactShares(value);
  return `${value}`;
}

function buildExecutivePage(
  report: Report,
  sections: Record<string, ReportSection>,
  metricRows: MetricRow[],
  context?: AnalysisContext,
  reportModel: ReportModel | null = null,
): string {
  const byMetric = new Map(metricRows.map(r => [r.metric, r]));
  const executiveSection = sections['executive_summary']?.content || '';
  const sectionSummary = isSectionSummaryUsable(executiveSection) ? executiveSection.trim() : '';
  const thesis = sectionSummary
    ? ''
    : clampWords(composeExecutiveThesis(report, byMetric), PDF_RENDER_RULES.executive.maxWords);
  const secondary = composeExecutiveSecondaryLine(report, byMetric, context, reportModel);
  const executiveBody = sectionSummary
    ? renderNarrativeParagraphs(sectionSummary, 5)
    : `<p class="thesis">${escapeHTML(thesis)}</p>`;
  const executiveSupport = report.type === 'comparison'
    ? buildComparisonExecutiveScorecard(reportModel)
    : `${buildExecutiveScorecard(byMetric)}${buildExecutiveStrip(byMetric)}`;

  return `
    <section class="report-page page-executive">
      <div class="page-header"><h2>Executive Summary</h2></div>
      ${PERIOD_BANNER_SLOT}
      <div class="module executive-copy">
        ${executiveBody}
        ${secondary ? `<p class="thesis-secondary">${escapeHTML(secondary)}</p>` : ''}
      </div>
      ${executiveSupport}
    </section>
  `;
}

function renderNarrativeParagraphs(markdown: string, maxParagraphs: number): string {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map(p => stripMarkdown(p).trim())
    .filter(Boolean)
    .slice(0, maxParagraphs);
  if (paragraphs.length === 0) return '';
  return paragraphs.map((paragraph, idx) => {
    const cls = idx === 0 ? 'thesis narrative-paragraph' : 'narrative-paragraph';
    return `<p class="${cls}">${escapeHTML(paragraph)}</p>`;
  }).join('\n');
}

function buildComparisonExecutiveScorecard(reportModel: ReportModel | null): string {
  if (!reportModel || reportModel.type !== 'comparison' || reportModel.companies.length < 2) return '';
  const tickers = reportModel.companies.map(company => company.ticker);
  const metrics = [
    'Revenue',
    'Net Income',
    'Operating Margin',
    'Debt-to-Equity',
    'Current Ratio',
    'Free Cash Flow',
  ];
  const rows = metrics
    .map(label => {
      const cells = reportModel.companies.map(company => company.metricsByLabel.get(label)?.currentDisplay || 'N/A');
      if (cells.every(cell => isUnavailableDisplay(cell))) return null;
      return [label, ...cells];
    })
    .filter((row): row is string[] => !!row);
  if (rows.length < 3) return '';
  return `
    <section class="module executive-scorecard">
      <h3>Snapshot Scorecard</h3>
      ${renderTable(['Metric', ...tickers], rows)}
    </section>
  `;
}

function composeExecutiveThesis(
  report: Report,
  byMetric: Map<string, MetricRow>,
): string {
  const rev = byMetric.get('Revenue')?.current;
  const ni = byMetric.get('Net Income')?.current;
  const om = byMetric.get('Operating Margin')?.current;
  const de = byMetric.get('Debt-to-Equity')?.current;

  if (report.type === 'comparison') {
    return `The peer set shows clear differences in scale, profitability, and balance-sheet posture. The key read is not a single ratio winner, but how each company converts revenue into earnings while managing leverage and cash discipline.`;
  }

  const fragments: string[] = [];
  if (rev && ni) {
    fragments.push(`${report.tickers[0]} currently reports ${rev} revenue and ${ni} net income on the latest annual filing.`);
  }
  if (om) {
    fragments.push(`Operating margin of ${om} indicates the present level of earnings conversion.`);
  }
  if (de) {
    fragments.push(`Debt-to-equity at ${de} is the key balance-sheet constraint to monitor going forward.`);
  }
  if (fragments.length === 0) {
    return `${report.tickers[0]} shows a mixed current profile; the main interpretation hinges on profitability durability, liquidity resilience, and cash-flow quality over the next filings.`;
  }
  return fragments.join(' ');
}

function composeExecutiveSecondaryLine(
  report: Report,
  byMetric: Map<string, MetricRow>,
  context?: AnalysisContext,
  reportModel: ReportModel | null = null,
): string {
  if (!context) return '';
  if (report.type === 'comparison') {
    const policy = reportModel?.companies[0]?.policy;
    const basis = reportModel?.comparisonBasis;
    const periods = (reportModel?.companies || []).map(company => company.snapshotLabel);
    const pairs = context.tickers.map((t, i) => `${t}: ${periods[i] || 'N/A'}`);
    const unique = new Set(periods.filter(Boolean));
    if ((basis?.effective_mode || policy?.comparisonBasisMode) === 'overlap_normalized' && basis?.note) {
      return basis.note;
    }
    if ((basis?.effective_mode || policy?.comparisonBasisMode) === 'overlap_normalized' && unique.size <= 1) {
      return `Peer figures are aligned to the same reported annual period (${pairs.join('; ')}).`;
    }
    if ((basis?.effective_mode || policy?.comparisonBasisMode) === 'latest_per_peer_screening') {
      return basis?.note || `Screening comparison mode is active: ${pairs.join('; ')}. These figures are not normalized to a shared annual period.`;
    }
    return basis?.note || `Peer figures reflect each company’s latest annual filing period (${pairs.join('; ')}), so fiscal year-ends are not fully synchronized.`;
  }

  const de = byMetric.get('Debt-to-Equity')?.current;
  const cr = byMetric.get('Current Ratio')?.current;
  const fcf = byMetric.get('Free Cash Flow')?.current;
  const parts: string[] = [];
  if (de && !isUnavailableDisplay(de)) parts.push(`leverage at ${de}`);
  if (cr && !isUnavailableDisplay(cr)) parts.push(`current ratio ${cr}`);
  if (fcf && !isUnavailableDisplay(fcf)) parts.push(`free cash flow ${fcf}`);
  if (parts.length === 0) return '';
  return `Current balance-sheet and cash profile: ${parts.join(', ')}.`;
}

function composeMetricImplicationBullets(
  byMetric: Map<string, MetricRow>,
  rules: Array<[string, string, string]>,
): string[] {
  const out: string[] = [];
  for (const [metric, label, implication] of rules) {
    const row = byMetric.get(metric);
    if (!row) continue;
    const current = normalizeDisplayCell(row.current);
    if (isUnavailableDisplay(current)) continue;
    const change = normalizeDisplayCell(row.change);
    const delta = !isUnavailableDisplay(change) ? ` (${change} vs prior)` : '';
    out.push(`${label} is ${current}${delta}; this ${implication}`);
  }
  return out;
}

function withSectionBackfill(primary: string[], fallback: string[], minCount: number): string[] {
  const out = [...primary];
  for (const item of fallback) {
    if (out.length >= minCount) break;
    out.push(item);
  }
  return out;
}

function deriveBulletsByKeyword(markdown: string, keywords: string[]): string[] {
  const fromBullets = sanitizeBullets(extractBullets(markdown));
  const byBullets = fromBullets.filter(b => matchesKeyword(b, keywords));
  if (byBullets.length > 0) return byBullets;

  const plain = stripMarkdown(markdown);
  const sentences = splitIntoSentences(plain)
    .map(sanitizeSentence)
    .filter(Boolean)
    .filter(s => matchesKeyword(s, keywords));
  return sentences.slice(0, 3);
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  const low = text.toLowerCase();
  return keywords.some(k => low.includes(k.toLowerCase()));
}

function summarizeSectionParagraph(markdown: string, maxWords: number): string {
  const plain = stripMarkdown(markdown);
  if (!plain) return '';
  const sentences = splitIntoSentences(plain)
    .map(sanitizeSentence)
    .filter(Boolean);
  if (sentences.length === 0) return '';
  const merged = sentences.slice(0, 3).join(' ');
  const colonCount = (merged.match(/:/g) || []).length;
  if (/^investment snapshot\b/i.test(merged) || /^peer snapshot\b/i.test(merged) || colonCount >= 4) {
    return '';
  }
  return clampWords(merged, maxWords);
}

function isSectionSummaryUsable(markdown: string): boolean {
  const plain = stripMarkdown(markdown).toLowerCase();
  if (!plain) return false;
  if (
    plain.includes('investment snapshot') ||
    plain.includes('peer snapshot') ||
    plain.includes('deterministic') ||
    plain.includes('validated')
  ) {
    return false;
  }
  return plain.length > 70;
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const masked = normalized.replace(/(\d)\.(\d)/g, '$1__DEC__$2');
  const parts = masked
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.replace(/__DEC__/g, '.').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [normalized];
}

function buildProseBlock(title: string, bullets: string[]): string {
  const safe = bullets.length > 0 ? bullets : ['No material signal available in this block for the current snapshot.'];
  const paragraph = safe.join(' ');
  return `
    <section class="exec-block">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(paragraph)}</p>
    </section>
  `;
}

function buildExecutiveStrip(byMetric: Map<string, MetricRow>): string {
  const picks: Array<[string, string]> = [
    ['Revenue', 'Revenue'],
    ['Net Income', 'Net Income'],
    ['Operating Margin', 'Operating Margin'],
    ['Free Cash Flow', 'Free Cash Flow'],
  ];
  const cards = picks
    .map(([metric, label]) => {
      const row = byMetric.get(metric);
      if (!row) return null;
      const current = normalizeDisplayCell(row.current);
      if (isUnavailableDisplay(current)) return null;
      return { label, value: current };
    })
    .filter((v): v is { label: string; value: string } => !!v)
    .slice(0, 4);

  if (cards.length === 0) return '';
  return `
    <section class="module executive-strip">
      ${cards.map(card => `
        <article class="mini-kpi">
          <h4>${escapeHTML(card.label)}</h4>
          <p>${escapeHTML(card.value)}</p>
        </article>
      `).join('\n')}
    </section>
  `;
}

function buildExecutiveScorecard(byMetric: Map<string, MetricRow>): string {
  const defs = [
    'Revenue',
    'Net Income',
    'Operating Margin',
    'Debt-to-Equity',
    'Current Ratio',
    'Free Cash Flow',
  ];
  const rows = defs
    .map(name => {
      const row = byMetric.get(name);
      if (!row) return null;
      const current = normalizeDisplayCell(row.current);
      if (isUnavailableDisplay(current)) return null;
      return [
        name,
        current,
        normalizeDisplayCell(row.prior),
        normalizeDisplayCell(row.change),
      ] as string[];
    })
    .filter((r): r is string[] => !!r);

  if (rows.length < 3) return '';
  const headers = ['Metric', 'Current', 'Prior', 'Change'];
  return `
    <section class="module executive-scorecard">
      <h3>Snapshot Scorecard</h3>
      ${renderTable(headers, rows)}
    </section>
  `;
}

interface VisualItem {
  kind: 'chart' | 'insight';
  title: string;
  caption: string;
  svg?: string;
  bullets?: string[];
}

function buildVisualPages(
  context?: AnalysisContext,
  periodLocks: Record<string, ChartPeriodLock> = {},
  reportModel: ReportModel | null = null,
): string[] {
  if (!context) return [];
  const chartSet = generateChartsWithLocks(context, periodLocks);
  const visuals: VisualItem[] = [];

  if (chartSet.revenueMarginChart) visuals.push({
    kind: 'chart',
    title: 'Revenue Growth & Margin Profile',
    caption: 'Revenue trend and margin structure across the most recent annual periods.',
    svg: chartSet.revenueMarginChart,
  });
  if (chartSet.fcfBridgeChart) visuals.push({
    kind: 'chart',
    title: 'Cash Flow Conversion',
    caption: 'Bridge from earnings to free cash flow to assess conversion quality.',
    svg: chartSet.fcfBridgeChart,
  });
  if (chartSet.growthDurabilityChart) visuals.push({
    kind: 'chart',
    title: 'Revenue Growth',
    caption: 'Year-over-year growth path and stability over the latest annual periods.',
    svg: chartSet.growthDurabilityChart,
  });
  if (chartSet.returnLeverageChart) visuals.push({
    kind: 'chart',
    title: 'Return vs Leverage',
    caption: 'Relative position of return profile against leverage intensity.',
    svg: chartSet.returnLeverageChart,
  });
  if (!chartSet.returnLeverageChart && chartSet.peerScorecardChart) visuals.push({
    kind: 'chart',
    title: 'Peer Positioning',
    caption: 'Peer scorecard across profitability, leverage, scale, and cash generation.',
    svg: chartSet.peerScorecardChart,
  });

  const clipped = visuals.slice(0, PDF_RENDER_RULES.visuals.maxChartsPerPage * PDF_RENDER_RULES.visuals.maxVisualPages);
  if (clipped.length % 2 === 1) {
    const insight = buildVisualInsightCard(context, reportModel);
    if (insight) clipped.push(insight);
  }

  const pages: string[] = [];
  for (let i = 0; i < clipped.length; i += PDF_RENDER_RULES.visuals.maxChartsPerPage) {
    const chunk = clipped.slice(i, i + PDF_RENDER_RULES.visuals.maxChartsPerPage);
    const title = i === 0 ? 'Visual Highlights I' : 'Visual Highlights II';
    pages.push(`
      <section class="report-page page-visual">
        <div class="page-header"><h2>${title}</h2></div>
        ${PERIOD_BANNER_SLOT}
        <div class="visual-grid ${chunk.length === 1 ? 'single' : ''}">
          ${chunk.map(card => {
            if (card.kind === 'insight') {
              return `
                <article class="visual-card visual-insight">
                  <h3>${escapeHTML(card.title)}</h3>
                  <p>${escapeHTML(card.caption)}</p>
                  <ul>${(card.bullets || []).map(b => `<li>${escapeHTML(b)}</li>`).join('\n')}</ul>
                </article>
              `;
            }
            return `
              <figure class="visual-card">
                <div class="visual-frame">${card.svg || ''}</div>
                <figcaption>
                  <h3>${escapeHTML(card.title)}</h3>
                  <p>${escapeHTML(card.caption)}</p>
                </figcaption>
              </figure>
            `;
          }).join('\n')}
        </div>
      </section>
    `);
  }
  return pages;
}

function buildVisualInsightCard(
  context: AnalysisContext,
  reportModel: ReportModel | null = null,
): VisualItem | null {
  const company = reportModel?.companies[0];
  if (!company) return null;
  const de = metricCell(company, 'Debt-to-Equity')?.current ?? null;
  const roe = metricCell(company, 'Return on Equity')?.current ?? null;
  const currentRatio = metricCell(company, 'Current Ratio')?.current ?? null;
  const ocf = metricCell(company, 'Operating Cash Flow')?.current ?? null;
  const bullets: string[] = [];

  if (roe !== null) bullets.push(`Return on equity is ${(roe * 100).toFixed(1)}%, indicating current capital productivity.`);
  if (de !== null) bullets.push(`Debt-to-equity stands at ${de.toFixed(2)}x, a direct read on leverage sensitivity.`);
  if (currentRatio !== null) bullets.push(`Current ratio is ${currentRatio.toFixed(2)}x, framing near-term liquidity coverage.`);
  if (ocf !== null) bullets.push(`Operating cash flow is ${formatCompactCurrency(ocf, { smallDecimals: 0, smartDecimals: true })}.`);
  if (bullets.length === 0) return null;

  return {
    kind: 'insight',
    title: 'Interpretation Snapshot',
    caption: 'Key interpretation anchors from the same annual data used in the charts.',
    bullets: clipBullets(bullets, 4),
  };
}

function buildDashboardPages(
  markdown: string,
  context?: AnalysisContext,
  metricRows: MetricRow[] = [],
  periodLocks: Record<string, ChartPeriodLock> = {},
  reportModel: ReportModel | null = null,
): string[] {
  const parsed = (reportModel
    ? dashboardGroupsFromReportModel(reportModel)
    : parseDashboardGroups(markdown))
    .filter(g => !/additional metrics/i.test(g.title) || g.rows.length >= 3)
    .map(compactDashboardColumns)
    .filter(g => g.rows.length > 0);
  const groups = splitLargeDashboardGroups(parsed, PDF_RENDER_RULES.tables.maxFrontRows);

  if (groups.length === 0) {
    return [`
      <section class="report-page page-dashboard">
        <div class="page-header"><h2>Key Metrics Dashboard</h2></div>
        ${PERIOD_BANNER_SLOT}
        <div class="module metrics-module"><p>No key metrics available.</p></div>
      </section>
    `];
  }

  const modules: LayoutModule[] = groups.map((group, idx) => ({
    id: `dashboard-group-${idx}`,
    html: renderTableGroup(group),
    units: 4 + Math.min(8, group.rows.length),
    primary: true,
    priority: 10 + idx,
  }));
  const expansionModules = buildDashboardExpansionModules(context, metricRows, periodLocks, reportModel);
  const packed = packDeterministicPages(modules, {
    pageCapacityUnits: 26,
    minFill: 0.75,
    minPrimaryModules: 2,
    expansionModules,
  });

  const pages: string[] = [];
  for (let i = 0; i < packed.length; i++) {
    const title = i === 0 ? 'Key Metrics Dashboard' : `Key Metrics Dashboard (Cont.)`;
    const moduleHtml = packed[i]!.modules.map(m => m.html).join('\n');
    const stackedLayout = shouldStackDashboardPage(packed[i]!.modules);
    pages.push(`
      <section class="report-page page-dashboard">
        <div class="page-header"><h2>${title}</h2></div>
        ${PERIOD_BANNER_SLOT}
        <div class="metrics-grid${stackedLayout ? ' stacked' : ''}">
          ${moduleHtml}
        </div>
      </section>
    `);
  }
  return pages;
}

function shouldStackDashboardPage(modules: LayoutModule[]): boolean {
  const primaryCount = modules.filter(module => module.primary !== false).length;
  const tableGroupCount = modules.filter(module => /table-group/.test(module.html)).length;
  return primaryCount <= 2 && tableGroupCount >= 2;
}

function dashboardGroupsFromReportModel(reportModel: ReportModel): DashboardGroup[] {
  if (reportModel.type === 'single') {
    const company = reportModel.companies[0];
    if (!company) return [];
    return company.dashboardGroups.map(group => ({
      title: group.title,
      headers: ['Metric', 'Current Value', 'Prior Period', 'Change (%)'],
      rows: group.rows.map(metric => [
        metric.label,
        metric.currentDisplay,
        metric.priorDisplay,
        metric.changeDisplay,
      ]),
    }));
  }

  const tickers = reportModel.companies.map(company => company.ticker);
  const merged = new Map<string, Map<string, string>>();
  for (const company of reportModel.companies) {
    for (const group of company.comparisonGroups) {
      let bucket = merged.get(group.title);
      if (!bucket) {
        bucket = new Map();
        merged.set(group.title, bucket);
      }
      for (const row of group.rows) {
        if (!bucket.has(row.label)) {
          bucket.set(row.label, row.label);
        }
      }
    }
  }

  return Array.from(merged.entries()).map(([title, rows]) => ({
    title,
    headers: ['Metric', ...tickers],
    rows: Array.from(rows.values())
      .sort((a, b) => a.localeCompare(b))
      .map(label => [
        label,
        ...reportModel.companies.map(company => company.metricsByLabel.get(label)?.currentDisplay || 'Unavailable'),
      ]),
  }));
}

function parseDashboardGroups(markdown: string): DashboardGroup[] {
  const lines = markdown.split('\n');
  const groups: DashboardGroup[] = [];
  let currentTitle: string | null = null;
  let tableLines: string[] = [];

  const flush = () => {
    if (!currentTitle || tableLines.length < 3) return;
    const parsed = parseMarkdownTable(tableLines);
    if (parsed.rows.length === 0) return;
    const clippedRows = parsed.rows.slice(0, PDF_RENDER_RULES.tables.maxFrontRows);
    groups.push({ title: currentTitle, headers: parsed.headers, rows: clippedRows });
  };

  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^###\s+(.+)$/);
    if (h) {
      flush();
      currentTitle = h[1]!.trim();
      tableLines = [];
      continue;
    }
    if (line.startsWith('|')) {
      tableLines.push(line);
    } else if (tableLines.length > 0 && line.length === 0) {
      // keep gap inside table block
      continue;
    }
  }
  flush();
  return groups;
}

function compactDashboardColumns(group: DashboardGroup): DashboardGroup {
  const priorIdx = group.headers.findIndex(h => /prior/i.test(h));
  const changeIdx = group.headers.findIndex(h => /change/i.test(h));
  const currentIdx = group.headers.findIndex(h => /current/i.test(h));
  if (currentIdx < 0 || priorIdx < 0 || changeIdx < 0) return group;

  const total = group.rows.length;
  if (total === 0) return group;
  const emptyPrior = group.rows.filter(r => isUnavailableDisplay(r[priorIdx] || '')).length;
  const emptyChange = group.rows.filter(r => isUnavailableDisplay(r[changeIdx] || '')).length;
  const sparse = emptyPrior / total >= 0.8 && emptyChange / total >= 0.8;
  if (!sparse) return group;

  const headers = [group.headers[0] || 'Metric', group.headers[currentIdx] || 'Current Value', 'Note'];
  const rows = group.rows.map(r => [
    r[0] || 'Metric',
    r[currentIdx] || 'Unavailable',
    'Latest annual snapshot',
  ]);
  return { title: group.title, headers, rows };
}

function splitLargeDashboardGroups(groups: DashboardGroup[], maxRows: number): DashboardGroup[] {
  const out: DashboardGroup[] = [];
  for (const group of groups) {
    if (group.rows.length <= maxRows) {
      out.push(group);
      continue;
    }
    const chunks = chunkWithMinTail(group.rows, maxRows, 3);
    for (let i = 0; i < chunks.length; i++) {
      out.push({
        title: chunks.length === 1 ? group.title : `${group.title} (${i + 1}/${chunks.length})`,
        headers: group.headers,
        rows: chunks[i]!,
      });
    }
  }
  return out;
}

function buildDashboardExpansionModules(
  context: AnalysisContext | undefined,
  metricRows: MetricRow[],
  periodLocks: Record<string, ChartPeriodLock> = {},
  reportModel: ReportModel | null = null,
): LayoutModule[] {
  const modules: LayoutModule[] = [];
  const comparisonBasis = buildComparisonBasisModule(reportModel);
  if (comparisonBasis) modules.push(comparisonBasis);
  const comparisonCoverage = buildComparisonCoverageModule(reportModel);
  if (comparisonCoverage) modules.push(comparisonCoverage);
  const secondary = buildSecondaryMetricsModule(reportModel);
  if (secondary) modules.push(secondary);
  const notes = buildMethodNotesModule(context);
  if (notes) modules.push(notes);
  return modules;
}

function buildComparisonBasisModule(reportModel: ReportModel | null): LayoutModule | null {
  if (!reportModel || reportModel.type !== 'comparison' || !reportModel.comparisonBasis) return null;
  const basis = reportModel.comparisonBasis;
  const bullets = [
    `${comparisonBasisLabel(basis.effective_mode)} is active.`,
    basis.note,
    ...Object.entries(basis.peer_periods)
      .slice(0, 3)
      .map(([ticker, binding]) => `${ticker}: current ${binding.current_period || 'Unavailable'}; prior ${binding.prior_period || 'Unavailable'}.`),
  ].filter(Boolean);

  return {
    id: 'comparison-basis-module',
    html: `
      <section class="module method-notes comparison-basis-module">
        <h3>Comparison Basis</h3>
        <ul>${clipBullets(bullets, 4).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      </section>
    `,
    units: 7,
    primary: false,
    priority: 30,
  };
}

function buildComparisonCoverageModule(reportModel: ReportModel | null): LayoutModule | null {
  if (!reportModel || reportModel.type !== 'comparison') return null;
  const bullets: string[] = [];

  for (const company of reportModel.companies.slice(0, 4)) {
    const unavailable = company.metrics
      .filter(metric => isUnavailableDisplay(metric.currentDisplay))
      .map(metric => metric.label);
    if (unavailable.length === 0) {
      bullets.push(`${company.ticker}: all surfaced peer-dashboard metrics are currently available on the locked basis.`);
      continue;
    }
    bullets.push(
      `${company.ticker}: ${unavailable.length} peer metrics remain unavailable on the locked basis (${unavailable.slice(0, 3).join(', ')}${unavailable.length > 3 ? ', ...' : ''}).`,
    );
  }

  if (bullets.length === 0) return null;
  return {
    id: 'comparison-coverage-module',
    html: `
      <section class="module method-notes comparison-coverage-module">
        <h3>Coverage Notes</h3>
        <ul>${clipBullets(bullets, 4).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      </section>
    `,
    units: 7,
    primary: false,
    priority: 35,
  };
}

function buildSecondaryMetricsModule(reportModel: ReportModel | null): LayoutModule | null {
  const company = reportModel?.companies[0];
  if (!company || reportModel?.type !== 'single') return null;

  const defs = [
    { label: 'Gross Profit', note: 'Reported income-statement line when available' },
    { label: 'Current Assets', note: 'Reported balance-sheet line' },
    { label: 'Current Liabilities', note: 'Reported balance-sheet line' },
    { label: 'Cash & Equivalents', note: 'Reported balance-sheet cash line' },
    { label: 'Long-Term Debt', note: 'Reported balance-sheet debt line' },
    { label: 'Short-Term Debt', note: 'Reported balance-sheet debt line' },
    { label: 'Shares Outstanding', note: 'Reported period-end shares' },
  ] as const;

  const rows: string[][] = defs
    .map(def => {
      const metric = metricCell(company, def.label);
      if (!metric || isUnavailableDisplay(metric.currentDisplay)) return null;
      return [def.label, metric.currentDisplay, metric.priorDisplay, def.note];
    })
    .filter((row): row is string[][][number] => !!row);

  if (rows.length < 3) return null;
  const headers = ['Metric', 'Current Value', 'Prior Period', 'Note'];
  return {
    id: 'dashboard-secondary-metrics',
    html: `
      <section class="table-group module tall">
        <h3>Secondary Metrics</h3>
        ${renderTable(headers, rows.slice(0, 8))}
      </section>
    `,
    units: 6 + Math.min(8, rows.length),
    primary: true,
    priority: 60,
  };
}

function buildMethodNotesModule(context?: AnalysisContext): LayoutModule | null {
  if (!context) return null;
  const bullets = [
    'Period lock is deterministic: headline, dashboard, and appendix are aligned to the same annual basis.',
    'Derived metrics are formula-based and only shown when required source inputs are present.',
    'Unavailable, policy-excluded, and QA-excluded fields come directly from canonical reason codes rather than template-side omissions.',
  ];
  return {
    id: 'dashboard-method-notes',
    html: `
      <section class="module method-notes">
        <h3>Method Notes</h3>
        <ul>${bullets.map(b => `<li>${escapeHTML(b)}</li>`).join('')}</ul>
      </section>
    `,
    units: 4,
    primary: false,
    priority: 80,
  };
}

function renderTableGroup(group: DashboardGroup): string {
  return `
    <section class="table-group module ${group.rows.length >= 7 ? 'tall' : ''}">
      <h3>${escapeHTML(group.title)}</h3>
      ${renderTable(group.headers, group.rows)}
    </section>
  `;
}

function renderTable(headers: string[], rows: string[][]): string {
  return `
    <table>
      <thead>
        <tr>${headers.map(h => `<th>${escapeHTML(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map(r => `<tr>${r.map(c => `<td>${escapeHTML(normalizeDisplayCell(c))}</td>`).join('')}</tr>`).join('\n')}
      </tbody>
    </table>
  `;
}

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } {
  const clean = lines.filter(Boolean);
  if (clean.length < 3) return { headers: [], rows: [] };
  const headers = splitMarkdownRow(clean[0]!);
  const rows = clean.slice(2).map(splitMarkdownRow);
  return { headers, rows };
}

function splitMarkdownRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => normalizeDisplayCell(cell.trim()));
}

function buildCommentaryPage(
  report: Report,
  sections: Record<string, ReportSection>,
  context: AnalysisContext | undefined,
  metricRows: MetricRow[],
  periodLocks: Record<string, ChartPeriodLock> = {},
  reportModel: ReportModel | null = null,
): string {
  const strengthsSrc = report.type === 'comparison'
    ? sections['relative_strengths']?.content || ''
    : sections['trend_analysis']?.content || '';
  const risksSrc = sections['risk_factors']?.content || '';
  const notesSrc = sections['analyst_notes']?.content || '';

  const sectionStandout = deriveCommentaryBullets(strengthsSrc, 3);
  const sectionWatch = deriveCommentaryBullets(risksSrc, 2, true);
  const sectionInterpretation = deriveCommentaryBullets(notesSrc, 3);

  const generated = context
    ? (report.type === 'comparison'
        ? buildComparisonCommentaryFallback(context, reportModel, periodLocks)
        : buildSingleCommentaryFallback(context, reportModel?.companies[0] || null, periodLocks))
    : { standout: [], watch: [], interpretation: [] };

  const standout = finalizeCommentaryBullets(generated.standout, sectionStandout, 3);
  const watch = finalizeCommentaryBullets(generated.watch, sectionWatch, 2, true);
  const interpretation = finalizeCommentaryBullets(generated.interpretation, sectionInterpretation, 3);

  return `
    <section class="report-page page-commentary">
      <div class="page-header"><h2>Commentary</h2></div>
      ${PERIOD_BANNER_SLOT}
      ${buildCommentaryBlock('What stands out', standout)}
      ${buildCommentaryBlock('Watch items', watch)}
      ${buildCommentaryBlock('Analyst interpretation', interpretation)}
      ${buildCommentaryChecklist(
        context,
        reportModel?.companies[0] ? metricRowsFromCompany(reportModel.companies[0]) : metricRows,
        reportModel,
      )}
    </section>
  `;
}

function finalizeCommentaryBullets(
  primary: string[],
  fallback: string[],
  target: number,
  strictWatch = false,
): string[] {
  const out = sanitizeBullets(primary)
    .filter(s => s.length >= 32)
    .filter(s => !/anomaly in|significant spike|σ|z-score/i.test(s));

  for (const line of sanitizeBullets(fallback)) {
    if (out.length >= target) break;
    if (line.length < 32) continue;
    if (strictWatch && !/risk|watch|leverage|liquidity|volatility|pressure|constraint|declin|debt/i.test(line)) continue;
    if (/anomaly in|significant spike|σ|z-score/i.test(line)) continue;
    out.push(line);
  }

  if (out.length >= target) return clipBullets(out, target);
  const fillers = strictWatch
    ? [
      'Recheck leverage, liquidity, and margin durability together before extending this snapshot forward.',
      'Validate next-period filing consistency before treating one-year changes as structural.',
    ]
    : [
      'The signal is strongest where profitability, funding profile, and cash conversion agree over multiple periods.',
      'Use this section as directional interpretation, then confirm with the appendix statement tables.',
      'The current snapshot is most credible when checked against filing-period consistency and ratio coherence.',
    ];
  for (const filler of fillers) {
    if (out.length >= target) break;
    out.push(filler);
  }
  return clipBullets(out, target);
}

function deriveCommentaryBullets(markdown: string, maxBullets: number, strictWatch = false): string[] {
  const explicit = sanitizeBullets(extractBullets(markdown));
  if (explicit.length > 0) {
    let filteredExplicit = strictWatch
      ? explicit.filter(s => /risk|watch|leverage|liquidity|volatility|pressure|constraint|declin|debt/i.test(s))
      : explicit;
    if (strictWatch) {
      filteredExplicit = filteredExplicit
        .filter(s => s.length <= 180)
        .filter(s => !/anomaly in|significant spike|σ|z-score/i.test(s));
    }
    if (filteredExplicit.length > 0) return clipBullets(filteredExplicit, maxBullets);
  }

  const plain = stripMarkdown(markdown);
  const sentences = splitIntoSentences(plain)
    .map(s => sanitizeSentence(s))
    .filter(Boolean);
  const filtered = strictWatch
    ? sentences.filter(s => /risk|watch|leverage|liquidity|volatility|pressure|constraint/i.test(s))
    : sentences;
  const cleanFiltered = strictWatch
    ? filtered.filter(s => s.length <= 180 && !/anomaly in|significant spike|σ|z-score/i.test(s))
    : filtered;
  const out = (cleanFiltered.length > 0 ? cleanFiltered : sentences).slice(0, maxBullets);
  return out.length > 0 ? out : ['No additional commentary was required beyond the core metrics in this snapshot.'];
}

function sanitizeBullets(items: string[]): string[] {
  return items
    .map(sanitizeSentence)
    .filter(Boolean)
    .filter((v, idx, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === idx);
}

function sanitizeSentence(input: string): string {
  let s = input
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^Watch Items\s*/i, '')
    .replace(/\b([A-Za-z][A-Za-z ]{1,30})\s+\1\b/gi, '$1')
    .replace(/\b(z-?score|sigma|std(?:dev)?|standard deviation)\b/gi, 'volatility')
    .replace(/\bmean\b/gi, 'historical average')
    .trim();
  s = s.replace(/^[;,\-–—\s]+/, '').replace(/\s+[;,\-–—]+$/, '').trim();
  if (s.length < 20) return '';
  if (!s) return '';
  if (!/[.!?]$/.test(s)) s = `${s}.`;
  return s;
}

function buildCommentaryBlock(title: string, bullets: string[]): string {
  const safe = bullets.length > 0
    ? bullets
    : ['No material narrative signal was available beyond the verified metrics in this run.'];
  return `
    <section class="module commentary-block">
      <h3>${escapeHTML(title)}</h3>
      <ul>${safe.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
    </section>
  `;
}

function buildCommentaryChecklist(
  context: AnalysisContext | undefined,
  metricRows: MetricRow[],
  reportModel: ReportModel | null = null,
): string {
  if (context?.type === 'comparison') {
    const basis = reportModel?.comparisonBasis;
    const checklist: string[] = [];
    if (basis?.note) checklist.push(basis.note);
    const peerPeriods = basis
      ? Object.entries(basis.peer_periods)
        .map(([ticker, binding]) => `${ticker}: ${binding.current_period || 'Unavailable'} current / ${binding.prior_period || 'Unavailable'} prior`)
      : [];
    if (peerPeriods.length > 0) checklist.push(`Locked peer periods: ${peerPeriods.join('; ')}.`);
    const unavailable = (reportModel?.companies || [])
      .map(company => ({
        ticker: company.ticker,
        count: company.metrics.filter(metric => isUnavailableDisplay(metric.currentDisplay)).length,
      }))
      .filter(item => item.count > 0);
    if (unavailable.length > 0) {
      checklist.push(`Current peer-metric gaps remain for ${unavailable.map(item => `${item.ticker} (${item.count})`).join(', ')}.`);
    }
    if (checklist.length === 0) return '';
    return `
      <section class="module checklist-block">
        <h3>Comparison Checklist</h3>
        <ul>${clipBullets(checklist, 4).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
      </section>
    `;
  }
  const checklist: string[] = [];
  const de = findMetric(metricRows, 'Debt-to-Equity');
  const current = findMetric(metricRows, 'Current Ratio');
  const fcf = findMetric(metricRows, 'Free Cash Flow');
  const revenue = findMetric(metricRows, 'Revenue');
  const ticker = context?.tickers?.[0] || 'the company';
  if (revenue) checklist.push(`Confirm whether ${ticker} can sustain revenue at ${revenue.current} through the next filing cycle.`);
  if (fcf) checklist.push(`Track free cash flow conversion versus earnings; current reference is ${fcf.current}.`);
  if (de && current) checklist.push(`Reassess leverage and liquidity together (${de.current} debt-to-equity, ${current.current} current ratio).`);
  if (checklist.length === 0) return '';
  return `
    <section class="module checklist-block">
      <h3>Next Filing Checklist</h3>
      <ul>${clipBullets(checklist, 3).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
    </section>
  `;
}

function buildSingleCommentaryFallback(
  context: AnalysisContext,
  company: CompanyReportModel | null,
  periodLocks: Record<string, ChartPeriodLock> = {},
): { standout: string[]; watch: string[]; interpretation: string[] } {
  const ticker = context.tickers[0]!;
  const metricRows = company ? metricRowsFromCompany(company) : [];
  const standout: string[] = [];
  const watch: string[] = [];
  const interpretation: string[] = [];

  const revenue = findMetric(metricRows, 'Revenue');
  const netIncome = findMetric(metricRows, 'Net Income');
  const opMargin = findMetric(metricRows, 'Operating Margin');
  const de = findMetric(metricRows, 'Debt-to-Equity');
  const currentRatio = findMetric(metricRows, 'Current Ratio');
  const fcf = findMetric(metricRows, 'Free Cash Flow');
  const netMargin = findMetric(metricRows, 'Net Margin');
  const lock = periodLocks[ticker] || { current: null, prior: null };
  const revTrend = getTrend(context, ticker, 'revenue');

  if (revenue) {
    const ch = normalizeDisplayCell(revenue.change);
    standout.push(!isUnavailableDisplay(ch)
      ? `Revenue is ${revenue.current}, with ${ch} growth versus the prior annual filing.`
      : `Revenue is ${revenue.current} on the latest annual filing.`);
  }
  if (netIncome) {
    const niChange = normalizeDisplayCell(netIncome.change);
    standout.push(!isUnavailableDisplay(niChange)
      ? `Net income is ${netIncome.current}, with ${niChange} change year over year.`
      : `Net income is ${netIncome.current}, confirming current earnings scale.`);
  }
  if (opMargin && netMargin) {
    const opNum = parseNumber(opMargin.current);
    const netNum = parseNumber(netMargin.current);
    const bothNegative = (opNum !== null && opNum < 0) && (netNum !== null && netNum < 0);
    const eitherNegative = (opNum !== null && opNum < 0) || (netNum !== null && netNum < 0);
    if (bothNegative) {
      standout.push(`Operating margin is ${opMargin.current} and net margin is ${netMargin.current}, indicating operating losses at both levels.`);
    } else if (eitherNegative) {
      standout.push(`Operating margin is ${opMargin.current} and net margin is ${netMargin.current}, reflecting mixed profitability across operating and bottom-line levels.`);
    } else {
      standout.push(`Operating margin is ${opMargin.current} and net margin is ${netMargin.current}, indicating current earnings conversion and bottom-line retention.`);
    }
  } else if (opMargin) {
    const opNum = parseNumber(opMargin.current);
    if (opNum !== null && opNum < 0) {
      standout.push(`Operating margin at ${opMargin.current} indicates operating losses in the latest period.`);
    } else {
      standout.push(`Operating margin at ${opMargin.current} supports operating conversion in the latest period.`);
    }
  }
  if (fcf) {
    const fcfNum = parseNumber(fcf.current);
    if (fcfNum !== null && fcfNum < 0) {
      standout.push(`Free cash flow is ${fcf.current}, indicating reliance on external financing.`);
    } else {
      standout.push(`Free cash flow is ${fcf.current}, supporting internal funding capacity and earnings quality.`);
    }
  }

  const deNum = de ? parseNumber(de.current) : null;
  if (de && deNum !== null && deNum > 2) watch.push(`Leverage is elevated at ${de.current}, which raises refinancing sensitivity.`);
  const crNum = currentRatio ? parseNumber(currentRatio.current) : null;
  if (currentRatio && crNum !== null && crNum < 1) watch.push(`Current ratio is ${currentRatio.current}, indicating tight near-term liquidity coverage.`);
  if (revTrend?.values.length) {
    const point = lock.current
      ? revTrend.values.find(v => v.period === lock.current) || revTrend.values[revTrend.values.length - 1]
      : revTrend.values[revTrend.values.length - 1];
    if (point?.yoy_growth !== null && point?.yoy_growth !== undefined) {
      const yoy = point.yoy_growth;
      if (Math.abs(yoy) > 0.35) {
        watch.push(`Revenue growth of ${(yoy * 100).toFixed(1)}% is unusually large and should be checked for base effects.`);
      }
    }
  }
  if (watch.length < 2 && de && currentRatio) {
    watch.push(`Monitor leverage and liquidity together: debt-to-equity is ${de.current} and current ratio is ${currentRatio.current}.`);
  }
  if (watch.length < 2) {
    watch.push('Validate next-period durability before extrapolating the latest one-year growth and margin profile.');
  }

  const niNum = netIncome ? parseNumber(netIncome.current) : null;
  const opMarginNum = opMargin ? parseNumber(opMargin.current) : null;
  const isProfitable = (niNum !== null && niNum > 0) || (opMarginNum !== null && opMarginNum > 0);

  if (isProfitable) {
    interpretation.push(`${ticker} currently combines scale and profitability, but the key decision point is whether margin and cash conversion stay consistent across the next filings.`);
  } else {
    interpretation.push(`${ticker} is not yet profitable, so the key decision point is the trajectory toward breakeven and whether cash runway supports continued operations.`);
  }
  if (de && currentRatio) {
    interpretation.push(`Balance-sheet posture is best read jointly: debt-to-equity at ${de.current} and current ratio at ${currentRatio.current}.`);
  }
  if (fcf) {
    const fcfNum = parseNumber(fcf.current);
    if (fcfNum !== null && fcfNum < 0) {
      interpretation.push(`Cash burn remains a central monitoring point, with free cash flow at ${fcf.current} in the latest annual period.`);
    } else {
      interpretation.push(`Cash generation remains a central validation point, with free cash flow at ${fcf.current} in the latest annual period.`);
    }
  }

  return { standout, watch, interpretation };
}

function buildComparisonCommentaryFallback(
  context: AnalysisContext,
  reportModel: ReportModel | null,
  periodLocks: Record<string, ChartPeriodLock> = {},
): { standout: string[]; watch: string[]; interpretation: string[] } {
  const standout: string[] = [];
  const watch: string[] = [];
  const interpretation: string[] = [];

  const companies = reportModel?.companies || [];
  if (companies.length >= 2) {
    const revenueRank = companies
      .map(company => ({
        ticker: company.ticker,
        revenue: company.metricsByLabel.get('Revenue')?.current ?? null,
      }))
      .filter(item => item.revenue !== null)
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
    if (revenueRank.length >= 2) {
      const leader = revenueRank[0]!;
      const lagger = revenueRank[1]!;
      standout.push(
        `${leader.ticker} leads on revenue scale (${formatCompactCurrency(leader.revenue!, { smallDecimals: 0, smartDecimals: true })} vs ${lagger.ticker} at ${formatCompactCurrency(lagger.revenue!, { smallDecimals: 0, smartDecimals: true })}).`,
      );
    }
    standout.push('Peer comparisons use each company’s locked annual filing period rather than a forced same-date restatement.');
  }

  for (const company of companies.slice(0, 4)) {
    const de = company.metricsByLabel.get('Debt-to-Equity')?.current ?? null;
    if (de !== null && de > 2) {
      watch.push(`${company.ticker} leverage is elevated at ${de.toFixed(2)}x debt-to-equity.`);
    }
  }
  if (watch.length === 0) watch.push('Fiscal-year timing and accounting mix should be normalized before drawing hard peer conclusions.');
  if (watch.length < 2) watch.push('Cross-company comparisons should be rechecked with aligned fiscal cutoffs when making valuation decisions.');

  interpretation.push('The useful read is relative quality by pillar: margin structure, leverage posture, and cash conversion.');
  interpretation.push('Use this comparison as a directional screen, then validate with aligned fiscal periods and segment-level details.');

  return { standout, watch, interpretation };
}

function buildAppendixPages(
  report: Report,
  context: AnalysisContext | undefined,
  sections: Record<string, ReportSection>,
  insights: Record<string, AnalysisInsights> = {},
  reportModel: ReportModel | null = null,
  canonicalPackage?: CanonicalReportPackage,
): string[] {
  if (!context) {
    const fallback = normalizeMissingDataMarkdown(sections['financial_statements']?.content || '*Financial statements unavailable.*');
    return [`
      <section class="report-page page-appendix">
        <div class="page-header"><h2>Appendix</h2></div>
        ${PERIOD_BANNER_SLOT}
        <div class="module appendix-module"><p>${escapeHTML(stripMarkdown(fallback))}</p></div>
      </section>
    `];
  }

  const model = reportModel || requireCanonicalReportPackage(canonicalPackage, 'buildAppendixPages').reportModel;
  const modules: AppendixModule[] = [];

  for (let tIdx = 0; tIdx < model.companies.length; tIdx++) {
    const company = model.companies[tIdx]!;
    const letterBase = String.fromCharCode(65 + Math.min(25, tIdx * 3));
    for (let sIdx = 0; sIdx < company.statementTables.length; sIdx++) {
      const table = company.statementTables[sIdx]!;
      const headers = ['Metric', ...table.periodLabels];
      const rows = table.rows.map(row => [row.label, ...row.displays]);
      const chunks = chunkWithMinTail(rows, PDF_RENDER_RULES.tables.maxAppendixRows, 6);
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const appendixLetter = String.fromCharCode(letterBase.charCodeAt(0) + sIdx);
        const suffix = chunks.length > 1 ? ` (Part ${cIdx + 1}/${chunks.length})` : '';
        modules.push({
          title: `Appendix ${appendixLetter} — ${company.ticker} ${table.title}${suffix}`,
          headers,
          rows: chunks[cIdx]!,
        });
      }
    }
  }

  if (modules.length === 0) {
    return [`
      <section class="report-page page-appendix">
        <div class="page-header"><h2>Appendix</h2></div>
        ${PERIOD_BANNER_SLOT}
        <div class="module appendix-module"><p>Financial statements unavailable for this report run.</p></div>
      </section>
    `];
  }

  const packModules: LayoutModule[] = modules.map((mod, idx) => ({
    id: `appendix-${idx}`,
    units: 4 + mod.rows.length,
    primary: true,
    priority: idx + 1,
    html: `
      <section class="appendix-section">
        <h3>${escapeHTML(mod.title)}</h3>
        ${renderTable(mod.headers, mod.rows)}
      </section>
    `,
  }));
  const appendixExpansionModules = model.companies.flatMap((company, idx) =>
    buildAppendixNoteModules(company, idx),
  );
  const packed = packDeterministicPages(packModules, {
    pageCapacityUnits: 40,
    minFill: 0.75,
    minPrimaryModules: 1,
    expansionModules: appendixExpansionModules,
  });

  return packed.map((bucket, idx) => `
    <section class="report-page page-appendix">
      <div class="page-header"><h2>${idx === 0 ? 'Appendix' : 'Appendix (Cont.)'}</h2></div>
      ${PERIOD_BANNER_SLOT}
      <div class="module appendix-module">
        ${bucket.modules.map(mod => mod.html).join('\n')}
      </div>
    </section>
  `);
}

function buildAppendixSupportBullets(company: CompanyReportModel): string[] {
  const bullets: string[] = [];

  if (company.snapshotPeriod || company.priorPeriod) {
    const periods = [company.snapshotLabel, company.priorLabel]
      .filter(label => label && label !== 'N/A')
      .join(' and ');
    if (periods) {
      bullets.push(`Locked annual appendix basis uses ${periods}.`);
    }
  }

  const basisNotes = company.metrics
    .map(metric => metric.basis)
    .filter((basis): basis is NonNullable<CanonicalMetricCell['basis']> => !!basis)
    .filter((basis, idx, arr) => (
      arr.findIndex(other =>
        other.displayName === basis.displayName
        && other.basis === basis.basis
        && other.disclosureText === basis.disclosureText
        && other.note === basis.note
      ) === idx
    ))
    .slice(0, 3)
    .map(basis => {
      const text = (basis.disclosureText || basis.note || basis.basis).replace(/[.\s]+$/g, '');
      return `${basis.displayName}: ${text}.`;
    });
  bullets.push(...basisNotes);

  const derivedRows = company.statementTables
    .flatMap(table => table.rows.map(row => row.label))
    .filter(label => /\((?:derived|reported\/reconciled)\)/i.test(label));
  if (derivedRows.length > 0) {
    const lead = derivedRows.slice(0, 3).map(label => label.replace(/\s+\((?:derived|reported\/reconciled)\)$/i, ''));
    const remainder = derivedRows.length - lead.length;
    bullets.push(
      `Derived or reconciled appendix rows include ${lead.join(', ')}${remainder > 0 ? `, and ${remainder} more` : ''}.`,
    );
  }

  const unavailableCells = company.statementTables.reduce((count, table) => (
    count + table.rows.reduce((rowCount, row) => (
      rowCount + row.displays.filter(display => display === 'N/A').length
    ), 0)
  ), 0);
  if (unavailableCells > 0) {
    bullets.push('N/A appears only where the locked filing basis did not report a value and no governed derivation was available.');
  }

  const hasCashFlowOutflows = company.statementTables.some(table => table.statementType === 'cash_flow');
  if (hasCashFlowOutflows) {
    bullets.push('Cash-flow outflows are normalized to negative values so appendix signs match the dashboard and narrative.');
  }

  if (company.alignedFiling?.form || company.alignedFiling?.filed) {
    bullets.push(
      `Primary filing anchor: ${company.alignedFiling?.form || 'annual filing'}${company.alignedFiling?.filed ? ` filed ${company.alignedFiling.filed}` : ''}.`,
    );
  }

  if (company.fxNote) {
    bullets.push(`FX note: ${company.fxNote}.`);
  }

  return clipBullets(bullets.filter(Boolean), 7);
}

function buildAppendixNoteModules(company: CompanyReportModel, priorityIndex: number): LayoutModule[] {
  const bullets = buildAppendixSupportBullets(company);
  if (bullets.length === 0) return [];

  const chunks = chunkWithMinTail(bullets, 3, 2);
  return chunks.map((chunkBullets, idx) => ({
    id: `appendix-notes-${company.ticker}-${idx + 1}`,
    units: 3 + chunkBullets.length,
    primary: false,
    priority: 500 + priorityIndex * 10 + idx,
    html: `
      <section class="appendix-section appendix-notes">
        <h3>${escapeHTML(idx === 0 ? `Appendix Notes — ${company.ticker}` : `Appendix Notes — ${company.ticker} (Cont.)`)}</h3>
        <ul>
          ${chunkBullets.map(bullet => `<li>${escapeHTML(bullet)}</li>`).join('\n')}
        </ul>
      </section>
    `,
  }));
}

function formatByUnit(n: number, unit?: string): string {
  if (!isFinite(n)) return 'N/A';
  if (unit === '%' || unit === 'pure') return n.toFixed(2);
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${n.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(n);
  return formatCompactCurrency(n, { smallDecimals: 0, smartDecimals: true });
}

function buildSourcesPage(
  context: AnalysisContext | undefined,
  sections: Record<string, ReportSection>,
  report: Report,
  reportModel: ReportModel | null = null,
  canonicalPackage?: CanonicalReportPackage,
): string {
  const sourceRows: Array<{
    ticker: string;
    cik: string;
    accession: string;
    form: string;
    filed: string;
    url: string;
  }> = [];
  if (context) {
    const model = reportModel || requireCanonicalReportPackage(canonicalPackage, 'buildSourcesPage').reportModel;
    for (const company of model.companies) {
      const cik = context.facts[company.ticker]?.cik || 'N/A';
      for (const filing of company.filingReferences.slice(0, 6)) {
        if (!filing.url) continue;
        sourceRows.push({
          ticker: company.ticker,
          cik,
          accession: filing.accessionNumber || 'N/A',
          form: filing.form || 'SEC filing',
          filed: filing.filed || 'N/A',
          url: filing.url,
        });
      }
    }
  }

  const fallback = extractBullets(sections['data_sources']?.content || '');
  const sourceTable = sourceRows.length > 0
    ? `
      <table class="sources-table">
        <thead>
          <tr><th>Ticker</th><th>CIK</th><th>Accession</th><th>Form</th><th>Filed</th><th>Primary Document</th></tr>
        </thead>
        <tbody>
          ${sourceRows.map(r => `
            <tr>
              <td>${escapeHTML(r.ticker)}</td>
              <td>${escapeHTML(r.cik)}</td>
              <td>${escapeHTML(r.accession)}</td>
              <td>${escapeHTML(r.form)}</td>
              <td>${escapeHTML(r.filed)}</td>
              <td class="source-url">${escapeHTML(r.url)}</td>
            </tr>
          `).join('\n')}
        </tbody>
      </table>
    `
    : `<ul>${fallback.slice(0, 8).map(line => `<li>${escapeHTML(line)}</li>`).join('\n')}</ul>`;

  const runDate = escapeHTML(new Date(report.generated_at).toISOString().slice(0, 10));
  const retrievalDate = escapeHTML(new Date().toISOString().slice(0, 10));
  const comparisonMethodNote = report.type === 'comparison'
    ? (report.comparison_basis?.note
      || 'Comparisons reflect each issuer’s latest annual filing period unless otherwise noted.')
    : 'Standalone metrics are locked to the selected annual current/prior basis for the issuer.';

  return `
    <section class="report-page page-sources">
      <div class="page-header"><h2>Data Sources & Notes</h2></div>
      <div class="module sources-module">
        ${sourceTable}
      </div>
      <div class="module methodology-module">
        <h3>Method Notes</h3>
        <ul>
          <li>Financial values are sourced from SEC EDGAR filings and normalized into statement-level metrics.</li>
          <li>${escapeHTML(comparisonMethodNote)}</li>
          <li>Narrative text is descriptive only and does not alter deterministic calculations.</li>
        </ul>
        <p>Report date: ${runDate}. Retrieval date: ${retrievalDate}.</p>
        <p>Disclaimer: For research use only; not investment advice.</p>
      </div>
    </section>
  `;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function findMetric(rows: MetricRow[], metric: string): MetricRow | null {
  return rows.find(r => r.metric === metric) || null;
}

function parseNumber(display: string): number | null {
  const normalized = display.replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '').trim();
  const suffix = normalized.slice(-1).toUpperCase();
  const base = parseFloat(normalized);
  if (!isFinite(base)) return null;
  if (suffix === 'B') return base * 1e9;
  if (suffix === 'M') return base * 1e6;
  if (suffix === 'K') return base * 1e3;
  if (display.includes('x')) return base;
  return base;
}

function getTrend(context: AnalysisContext, ticker: string, metric: string) {
  return (context.trends[ticker] || []).find(t => t.metric === metric) || null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function chunkWithMinTail<T>(arr: T[], size: number, minTail: number): T[][] {
  if (arr.length <= size) return [arr.slice()];

  const chunkCount = Math.ceil(arr.length / size);
  const baseSize = Math.floor(arr.length / chunkCount);
  if (baseSize < minTail) {
    return chunk(arr, size);
  }

  const remainder = arr.length % chunkCount;
  const out: T[][] = [];
  let index = 0;
  for (let i = 0; i < chunkCount; i++) {
    const nextSize = baseSize + (i < remainder ? 1 : 0);
    out.push(arr.slice(index, index + nextSize));
    index += nextSize;
  }
  return out;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
