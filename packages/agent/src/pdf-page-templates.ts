import type { AnalysisContext, FinancialStatement, Report, ReportSection } from '@dolph/shared';
import { getMappingByName, getMappingsForStatement, formatCompactCurrency } from '@dolph/shared';
import {
  PDF_RENDER_RULES,
  clampWords,
  clipBullets,
  extractBullets,
  normalizeDisplayCell,
  normalizeMissingDataMarkdown,
  parseMetricRows,
  stripMarkdown,
} from './pdf-render-rules.js';
import { generateCharts } from './charts.js';

export interface PdfPageBuildResult {
  bodyHTML: string;
}

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

export function buildPdfPages(report: Report, context?: AnalysisContext): PdfPageBuildResult {
  const sections = indexSections(report.sections);
  const keyMetricsMarkdown = normalizeMissingDataMarkdown(sections['key_metrics']?.content || '');
  const metricRows = parseMetricRows(keyMetricsMarkdown);
  const pages: string[] = [];

  pages.push(buildCoverPage(report, sections, metricRows));
  pages.push(buildExecutivePage(report, sections, metricRows, context));
  pages.push(...buildVisualPages(context));
  pages.push(...buildDashboardPages(keyMetricsMarkdown));
  pages.push(buildCommentaryPage(report, sections, context, metricRows));
  pages.push(...buildAppendixPages(report, context, sections));
  pages.push(buildSourcesPage(context, sections, report));

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
    const row = metricRows.find(r => r.metric === metric && normalizeDisplayCell(r.current) !== 'N/A');
    if (!row) continue;
    cards.push(row);
    if (cards.length >= PDF_RENDER_RULES.cover.maxKpis) break;
  }

  const thesis = composeCoverThesis(report, metricRows);
  const glance = composeCoverBullets(metricRows, sections);

  return `
    <section class="report-page page-cover">
      <div class="cover-top">
        <div class="cover-brand">Dolph Research</div>
        <div class="cover-family">${escapeHTML(report.type === 'comparison' ? 'Peer Comparison Brief' : 'Equity Research Note')}</div>
        <div class="cover-date">${escapeHTML(formatDate(report.generated_at))}</div>
      </div>
      <div class="cover-hero">
        <h1>${escapeHTML(report.tickers.join(' vs '))}</h1>
        <p class="cover-thesis">${escapeHTML(thesis)}</p>
      </div>
      <div class="cover-kpis">
        ${cards.map(kpi => `
          <article class="kpi-card">
            <div class="kpi-label">${escapeHTML(kpi.metric)}</div>
            <div class="kpi-value">${escapeHTML(normalizeDisplayCell(kpi.current))}</div>
            <div class="kpi-note">${escapeHTML(formatKpiNote(kpi))}</div>
          </article>
        `).join('\n')}
      </div>
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
  if (change !== 'N/A') return change;
  const prior = normalizeDisplayCell(kpi.prior);
  if (prior !== 'N/A') return `Prior: ${prior}`;
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
): string[] {
  const out: string[] = [];
  const revenue = rows.find(r => r.metric === 'Revenue');
  const netIncome = rows.find(r => r.metric === 'Net Income');
  const de = rows.find(r => r.metric === 'Debt-to-Equity');
  const current = rows.find(r => r.metric === 'Current Ratio');
  const fcf = rows.find(r => r.metric === 'Free Cash Flow');
  const opMargin = rows.find(r => r.metric === 'Operating Margin');

  if (revenue && normalizeDisplayCell(revenue.current) !== 'N/A') {
    const ch = normalizeDisplayCell(revenue.change);
    out.push(ch !== 'N/A'
      ? `Revenue is ${revenue.current} with ${ch} change versus the prior period.`
      : `Revenue is currently ${revenue.current} on the latest annual filing.`);
  }
  if (netIncome && normalizeDisplayCell(netIncome.current) !== 'N/A') {
    out.push(`Net income is ${netIncome.current}, indicating current earnings scale.`);
  }
  if (de && current && normalizeDisplayCell(de.current) !== 'N/A') {
    out.push(`Balance sheet reads at ${de.current} debt-to-equity and ${normalizeDisplayCell(current.current)} current ratio.`);
  } else if (opMargin) {
    out.push(`Operating margin is ${normalizeDisplayCell(opMargin.current)}, supporting the current profitability profile.`);
  }
  if (fcf && normalizeDisplayCell(fcf.current) !== 'N/A') {
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

function buildExecutivePage(
  report: Report,
  sections: Record<string, ReportSection>,
  metricRows: MetricRow[],
  context?: AnalysisContext,
): string {
  const byMetric = new Map(metricRows.map(r => [r.metric, r]));
  const executiveSection = sections['executive_summary']?.content || '';
  const sectionSummary = isSectionSummaryUsable(executiveSection)
    ? summarizeSectionParagraph(executiveSection, 110)
    : '';
  const thesis = clampWords(
    sectionSummary || composeExecutiveThesis(report, byMetric),
    PDF_RENDER_RULES.executive.maxWords,
  );
  const secondary = composeExecutiveSecondaryLine(report, byMetric, context);

  const profitability = clipBullets(withSectionBackfill(composeMetricImplicationBullets(byMetric, [
    ['Operating Margin', 'Operating margin', 'defines current earnings conversion on sales.'],
    ['Net Margin', 'Net margin', 'captures current bottom-line efficiency.'],
    ['Return on Equity', 'Return on equity', 'indicates shareholder-capital productivity.'],
  ]), deriveBulletsByKeyword(sections['trend_analysis']?.content || '', ['margin', 'return', 'profit']), 2), PDF_RENDER_RULES.executive.maxBulletsPerBlock);

  const balance = clipBullets(withSectionBackfill(composeMetricImplicationBullets(byMetric, [
    ['Debt-to-Equity', 'Debt-to-equity', 'frames leverage sensitivity and refinancing exposure.'],
    ['Current Ratio', 'Current ratio', 'measures near-term liquidity headroom.'],
    ['Quick Ratio', 'Quick ratio', 'shows liquidity strength without inventory support.'],
  ]), deriveBulletsByKeyword(sections['risk_factors']?.content || '', ['liquidity', 'leverage', 'debt']), 2), PDF_RENDER_RULES.executive.maxBulletsPerBlock);

  const cash = clipBullets(withSectionBackfill(composeMetricImplicationBullets(byMetric, [
    ['Free Cash Flow', 'Free cash flow', 'tests earnings quality and funding flexibility.'],
    ['Operating Cash Flow', 'Operating cash flow', 'shows internal cash generation capacity.'],
    ['Capital Expenditures', 'Capital expenditures', 'signals reinvestment intensity and cash demand.'],
  ]), deriveBulletsByKeyword(sections['analyst_notes']?.content || '', ['cash', 'capex', 'fund']), 2), PDF_RENDER_RULES.executive.maxBulletsPerBlock);

  const watch = sanitizeBullets(extractBullets(sections['risk_factors']?.content || ''));
  if (cash.length < 2 && watch.length > 0) cash.push(watch[0]!);

  return `
    <section class="report-page page-executive">
      <div class="page-header"><h2>Executive Summary</h2></div>
      <div class="module executive-copy">
        <p class="thesis">${escapeHTML(thesis)}</p>
        ${secondary ? `<p class="thesis-secondary">${escapeHTML(secondary)}</p>` : ''}
      </div>
      <div class="exec-grid">
        ${buildBulletBlock('Profitability', profitability)}
        ${buildBulletBlock('Balance Sheet & Liquidity', balance)}
        ${buildBulletBlock('Cash Flow & Risk', cash)}
      </div>
      ${buildExecutiveStrip(byMetric)}
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
): string {
  if (!context) return '';
  if (report.type === 'comparison') {
    const periods = context.tickers.map(t => formatPeriodLabel(latestTrendPeriod(context, t, 'revenue') || ''));
    const pairs = context.tickers.map((t, i) => `${t}: ${periods[i] || 'N/A'}`);
    return `Peer figures reflect each company’s latest annual filing period (${pairs.join('; ')}), so fiscal year-ends are not always synchronized.`;
  }

  const de = byMetric.get('Debt-to-Equity')?.current;
  const cr = byMetric.get('Current Ratio')?.current;
  const fcf = byMetric.get('Free Cash Flow')?.current;
  const parts: string[] = [];
  if (de && normalizeDisplayCell(de) !== 'N/A') parts.push(`leverage at ${de}`);
  if (cr && normalizeDisplayCell(cr) !== 'N/A') parts.push(`current ratio ${cr}`);
  if (fcf && normalizeDisplayCell(fcf) !== 'N/A') parts.push(`free cash flow ${fcf}`);
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
    if (current === 'N/A') continue;
    const change = normalizeDisplayCell(row.change);
    const delta = change !== 'N/A' ? ` (${change} vs prior)` : '';
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

function buildBulletBlock(title: string, bullets: string[]): string {
  const safe = bullets.length > 0 ? bullets : ['No material signal available in this block for the current snapshot.'];
  return `
    <section class="exec-block">
      <h3>${escapeHTML(title)}</h3>
      <ul>
        ${safe.map(item => `<li>${escapeHTML(item)}</li>`).join('\n')}
      </ul>
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
      if (current === 'N/A') return null;
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

interface VisualItem {
  kind: 'chart' | 'insight';
  title: string;
  caption: string;
  svg?: string;
  bullets?: string[];
}

function buildVisualPages(context?: AnalysisContext): string[] {
  if (!context) return [];
  const chartSet = generateCharts(context);
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
    const insight = buildVisualInsightCard(context);
    if (insight) clipped.push(insight);
  }

  const pages: string[] = [];
  for (let i = 0; i < clipped.length; i += PDF_RENDER_RULES.visuals.maxChartsPerPage) {
    const chunk = clipped.slice(i, i + PDF_RENDER_RULES.visuals.maxChartsPerPage);
    const title = i === 0 ? 'Visual Highlights I' : 'Visual Highlights II';
    pages.push(`
      <section class="report-page page-visual">
        <div class="page-header"><h2>${title}</h2></div>
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

function buildVisualInsightCard(context: AnalysisContext): VisualItem | null {
  const ticker = context.tickers[0];
  if (!ticker) return null;
  const de = getRatioValue(context, ticker, 'de');
  const roe = getRatioValue(context, ticker, 'roe');
  const currentRatio = getRatioValue(context, ticker, 'current_ratio');
  const fcf = getLatestTrendValueForTicker(context, ticker, 'operating_cash_flow');
  const bullets: string[] = [];

  if (roe !== null) bullets.push(`Return on equity is ${(roe * 100).toFixed(1)}%, indicating current capital productivity.`);
  if (de !== null) bullets.push(`Debt-to-equity stands at ${de.toFixed(2)}x, a direct read on leverage sensitivity.`);
  if (currentRatio !== null) bullets.push(`Current ratio is ${currentRatio.toFixed(2)}x, framing near-term liquidity coverage.`);
  if (fcf !== null) bullets.push(`Operating cash flow is ${formatCompactCurrency(fcf, { smallDecimals: 0, compactDecimals: 1 })}.`);
  if (bullets.length === 0) return null;

  return {
    kind: 'insight',
    title: 'Interpretation Snapshot',
    caption: 'Key interpretation anchors from the same annual data used in the charts.',
    bullets: clipBullets(bullets, 4),
  };
}

function buildDashboardPages(markdown: string): string[] {
  const parsed = parseDashboardGroups(markdown)
    .filter(g => !/additional metrics/i.test(g.title) || g.rows.length >= 3)
    .map(compactDashboardColumns)
    .filter(g => g.rows.length > 0);
  const groups = splitLargeDashboardGroups(parsed, PDF_RENDER_RULES.tables.maxFrontRows);

  if (groups.length === 0) {
    return [`
      <section class="report-page page-dashboard">
        <div class="page-header"><h2>Key Metrics Dashboard</h2></div>
        <div class="module metrics-module"><p>No key metrics available.</p></div>
      </section>
    `];
  }

  const pages: string[] = [];
  const pageGroups = packDashboardGroups(groups, 4);
  for (let i = 0; i < pageGroups.length; i++) {
    const title = i === 0 ? 'Key Metrics Dashboard' : `Key Metrics Dashboard (Cont.)`;
    pages.push(`
      <section class="report-page page-dashboard">
        <div class="page-header"><h2>${title}</h2></div>
        <div class="metrics-grid">
          ${pageGroups[i]!.map(g => renderTableGroup(g)).join('\n')}
        </div>
      </section>
    `);
  }
  return pages;
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
  const emptyPrior = group.rows.filter(r => normalizeDisplayCell(r[priorIdx] || '') === 'N/A').length;
  const emptyChange = group.rows.filter(r => normalizeDisplayCell(r[changeIdx] || '') === 'N/A').length;
  const sparse = emptyPrior / total >= 0.8 && emptyChange / total >= 0.8;
  if (!sparse) return group;

  const headers = [group.headers[0] || 'Metric', group.headers[currentIdx] || 'Current Value', 'Note'];
  const rows = group.rows.map(r => [
    r[0] || 'Metric',
    r[currentIdx] || 'N/A',
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

function packDashboardGroups(groups: DashboardGroup[], pageUnitBudget: number): DashboardGroup[][] {
  const pages: DashboardGroup[][] = [];
  let current: DashboardGroup[] = [];
  let usedUnits = 0;
  for (const group of groups) {
    const units = group.rows.length >= 7 ? 2 : 1;
    if (current.length > 0 && (usedUnits + units > pageUnitBudget || current.length >= 4)) {
      pages.push(current);
      current = [];
      usedUnits = 0;
    }
    current.push(group);
    usedUnits += units;
  }
  if (current.length > 0) pages.push(current);
  return pages;
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
        ? buildComparisonCommentaryFallback(context, metricRows)
        : buildSingleCommentaryFallback(context, metricRows))
    : { standout: [], watch: [], interpretation: [] };

  const standout = finalizeCommentaryBullets(generated.standout, sectionStandout, 3);
  const watch = finalizeCommentaryBullets(generated.watch, sectionWatch, 2, true);
  const interpretation = finalizeCommentaryBullets(generated.interpretation, sectionInterpretation, 3);

  return `
    <section class="report-page page-commentary">
      <div class="page-header"><h2>Commentary</h2></div>
      ${buildCommentaryBlock('What stands out', standout)}
      ${buildCommentaryBlock('Watch items', watch)}
      ${buildCommentaryBlock('Analyst interpretation', interpretation)}
      ${buildCommentaryChecklist(context, metricRows)}
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
): string {
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
  metricRows: MetricRow[],
): { standout: string[]; watch: string[]; interpretation: string[] } {
  const ticker = context.tickers[0]!;
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
  const revTrend = getTrend(context, ticker, 'revenue');

  if (revenue) {
    const ch = normalizeDisplayCell(revenue.change);
    standout.push(ch !== 'N/A'
      ? `Revenue is ${revenue.current}, with ${ch} growth versus the prior annual filing.`
      : `Revenue is ${revenue.current} on the latest annual filing.`);
  }
  if (netIncome) {
    const niChange = normalizeDisplayCell(netIncome.change);
    standout.push(niChange !== 'N/A'
      ? `Net income is ${netIncome.current}, with ${niChange} change year over year.`
      : `Net income is ${netIncome.current}, confirming current earnings scale.`);
  }
  if (opMargin && netMargin) {
    standout.push(`Operating margin is ${opMargin.current} and net margin is ${netMargin.current}, indicating current earnings conversion and bottom-line retention.`);
  } else if (opMargin) {
    standout.push(`Operating margin at ${opMargin.current} supports strong operating conversion in the latest period.`);
  }
  if (fcf) standout.push(`Free cash flow is ${fcf.current}, supporting internal funding capacity and earnings quality.`);

  const deNum = de ? parseNumber(de.current) : null;
  if (de && deNum !== null && deNum > 2) watch.push(`Leverage is elevated at ${de.current}, which raises refinancing sensitivity.`);
  const crNum = currentRatio ? parseNumber(currentRatio.current) : null;
  if (currentRatio && crNum !== null && crNum < 1) watch.push(`Current ratio is ${currentRatio.current}, indicating tight near-term liquidity coverage.`);
  if (revTrend?.values.length && revTrend.values[revTrend.values.length - 1]?.yoy_growth !== null) {
    const yoy = revTrend.values[revTrend.values.length - 1]!.yoy_growth!;
    if (Math.abs(yoy) > 0.35) {
      watch.push(`Revenue growth of ${(yoy * 100).toFixed(1)}% is unusually large and should be checked for base effects.`);
    }
  }
  if (watch.length < 2 && de && currentRatio) {
    watch.push(`Monitor leverage and liquidity together: debt-to-equity is ${de.current} and current ratio is ${currentRatio.current}.`);
  }
  if (watch.length < 2) {
    watch.push('Validate next-period durability before extrapolating the latest one-year growth and margin profile.');
  }

  interpretation.push(`${ticker} currently combines scale and profitability, but the key decision point is whether margin and cash conversion stay consistent across the next filings.`);
  if (de && currentRatio) {
    interpretation.push(`Balance-sheet posture is best read jointly: debt-to-equity at ${de.current} and current ratio at ${currentRatio.current}.`);
  }
  if (fcf) {
    interpretation.push(`Cash generation remains a central validation point, with free cash flow at ${fcf.current} in the latest annual period.`);
  }

  return { standout, watch, interpretation };
}

function buildComparisonCommentaryFallback(
  context: AnalysisContext,
  metricRows: MetricRow[],
): { standout: string[]; watch: string[]; interpretation: string[] } {
  const standout: string[] = [];
  const watch: string[] = [];
  const interpretation: string[] = [];

  const revenueRow = metricRows.find(r => r.metric === 'Revenue');
  if (context.tickers.length >= 2) {
    const t0 = context.tickers[0]!;
    const t1 = context.tickers[1]!;
    const rev0 = getLatestTrendValueForTicker(context, t0, 'revenue');
    const rev1 = getLatestTrendValueForTicker(context, t1, 'revenue');
    if (rev0 !== null && rev1 !== null) {
      const leader = rev0 >= rev1 ? t0 : t1;
      const lagger = rev0 >= rev1 ? t1 : t0;
      const leadVal = formatCompactCurrency(Math.max(rev0, rev1), { smallDecimals: 0, compactDecimals: 1 });
      const lagVal = formatCompactCurrency(Math.min(rev0, rev1), { smallDecimals: 0, compactDecimals: 1 });
      standout.push(`${leader} leads on revenue scale (${leadVal} vs ${lagger} at ${lagVal}).`);
    }
  }
  if (revenueRow) {
    standout.push(`Peer comparisons reflect each company’s latest annual filing period rather than a forced same-date snapshot.`);
  }

  for (const ticker of context.tickers.slice(0, 2)) {
    const de = getRatioValue(context, ticker, 'de');
    if (de !== null && de > 2) {
      watch.push(`${ticker} leverage is elevated at ${de.toFixed(2)}x debt-to-equity.`);
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
): string[] {
  if (!context) {
    const fallback = normalizeMissingDataMarkdown(sections['financial_statements']?.content || '*Financial statements unavailable.*');
    return [`
      <section class="report-page page-appendix">
        <div class="page-header"><h2>Appendix</h2></div>
        <div class="module appendix-module"><p>${escapeHTML(stripMarkdown(fallback))}</p></div>
      </section>
    `];
  }

  const modules: AppendixModule[] = [];
  const statementOrder: Array<{ type: FinancialStatement['statement_type']; label: string }> = [
    { type: 'income', label: 'Income Statement' },
    { type: 'balance_sheet', label: 'Balance Sheet' },
    { type: 'cash_flow', label: 'Cash Flow Statement' },
  ];

  for (let tIdx = 0; tIdx < report.tickers.length; tIdx++) {
    const ticker = report.tickers[tIdx]!;
    const letterBase = String.fromCharCode(65 + Math.min(25, tIdx * 3));
    const statements = context.statements[ticker] || [];
    for (let sIdx = 0; sIdx < statementOrder.length; sIdx++) {
      const def = statementOrder[sIdx]!;
      const statement = statements.find(s => s.statement_type === def.type);
      if (!statement || statement.periods.length === 0) continue;

      const { headers, rows } = statementToTable(statement);
      const chunks = chunkWithMinTail(rows, PDF_RENDER_RULES.tables.maxAppendixRows, 6);
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const appendixLetter = String.fromCharCode(letterBase.charCodeAt(0) + sIdx);
        const suffix = chunks.length > 1 ? ` (Part ${cIdx + 1}/${chunks.length})` : '';
        modules.push({
          title: `Appendix ${appendixLetter} — ${ticker} ${def.label}${suffix}`,
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
        <div class="module appendix-module"><p>Financial statements unavailable for this report run.</p></div>
      </section>
    `];
  }

  // Deterministic page packing by row budget to avoid orphan headers and split modules.
  const pageBuckets: AppendixModule[][] = [];
  let current: AppendixModule[] = [];
  let currentUnits = 0;
  const pageCapacity = 28;
  for (const mod of modules) {
    const units = 4 + mod.rows.length;
    if (current.length > 0 && currentUnits + units > pageCapacity) {
      pageBuckets.push(current);
      current = [];
      currentUnits = 0;
    }
    current.push(mod);
    currentUnits += units;
  }
  if (current.length > 0) pageBuckets.push(current);

  return pageBuckets.map((bucket, idx) => `
    <section class="report-page page-appendix">
      <div class="page-header"><h2>${idx === 0 ? 'Appendix' : 'Appendix (Cont.)'}</h2></div>
      <div class="module appendix-module">
        ${bucket.map(mod => `
          <section class="appendix-section">
            <h3>${escapeHTML(mod.title)}</h3>
            ${renderTable(mod.headers, mod.rows)}
          </section>
        `).join('\n')}
      </div>
    </section>
  `);
}

function statementToTable(statement: FinancialStatement): { headers: string[]; rows: string[][] } {
  const periods = statement.periods.slice(0, 3);
  const headers = ['Metric', ...periods.map(p => formatPeriodLabel(p.period))];

  const allMetrics = new Set<string>();
  for (const p of periods) {
    for (const key of Object.keys(p.data)) allMetrics.add(key);
  }
  const mappingOrder = new Map(getMappingsForStatement(statement.statement_type).map((m, i) => [m.standardName, i] as const));
  const metrics = Array.from(allMetrics).sort((a, b) => {
    const ai = mappingOrder.has(a) ? mappingOrder.get(a)! : 999;
    const bi = mappingOrder.has(b) ? mappingOrder.get(b)! : 999;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });

  const rows = metrics.map(metric => {
    const mapping = getMappingByName(metric);
    const display = mapping?.displayName || toTitle(metric);
    const vals = periods.map(p => {
      const n = p.data[metric];
      if (n === undefined || n === null) return 'N/A';
      return formatByUnit(n, mapping?.unit);
    });
    return [display, ...vals];
  });

  return { headers, rows };
}

function formatByUnit(n: number, unit?: string): string {
  if (!isFinite(n)) return 'N/A';
  if (unit === '%' || unit === 'pure') return n.toFixed(2);
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${n.toFixed(2)}`;
  if (unit === 'shares') return `${(n / 1e9).toFixed(2)}B`;
  return formatUsdInBillions(n);
}

function formatUsdInBillions(n: number): string {
  const sign = n < 0 ? '-' : '';
  const b = Math.abs(n) / 1e9;
  if (b >= 100) return `${sign}$${b.toFixed(0)}B`;
  if (b >= 10) return `${sign}$${b.toFixed(1)}B`;
  return `${sign}$${b.toFixed(2)}B`;
}

function toTitle(metric: string): string {
  return metric.split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}

function formatPeriodLabel(period: string): string {
  const date = new Date(period);
  if (isNaN(date.getTime())) return period;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (m >= 10) return `FY${y}`;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  return `FY${y} (${names[m - 1] || 'Sep'})`;
}

function buildSourcesPage(
  context: AnalysisContext | undefined,
  sections: Record<string, ReportSection>,
  report: Report,
): string {
  const sourceRows: Array<{ ticker: string; form: string; filed: string; url: string }> = [];
  if (context) {
    for (const ticker of context.tickers) {
      const filings = context.filings[ticker] || [];
      const picked = filings.slice(0, 6);
      for (const filing of picked) {
        sourceRows.push({
          ticker,
          form: filing.filing_type,
          filed: filing.date_filed,
          url: filing.primary_document_url,
        });
      }
    }
  }

  const fallback = extractBullets(sections['data_sources']?.content || '');
  const sourceTable = sourceRows.length > 0
    ? `
      <table class="sources-table">
        <thead>
          <tr><th>Ticker</th><th>Form</th><th>Filed</th><th>Primary Document</th></tr>
        </thead>
        <tbody>
          ${sourceRows.map(r => `
            <tr>
              <td>${escapeHTML(r.ticker)}</td>
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
          <li>Comparisons reflect each issuer’s latest annual filing period unless otherwise noted.</li>
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

function latestTrendPeriod(context: AnalysisContext, ticker: string, metric: string): string | null {
  const trend = getTrend(context, ticker, metric);
  if (!trend || trend.values.length === 0) return null;
  return trend.values[trend.values.length - 1]?.period || null;
}

function getLatestTrendValueForTicker(context: AnalysisContext, ticker: string, metric: string): number | null {
  const trend = getTrend(context, ticker, metric);
  if (!trend || trend.values.length === 0) return null;
  const latest = trend.values[trend.values.length - 1];
  if (!latest || !isFinite(latest.value)) return null;
  return latest.value;
}

function getRatioValue(context: AnalysisContext, ticker: string, ratioName: string): number | null {
  const ratio = (context.ratios[ticker] || []).find(r => r.name === ratioName);
  if (!ratio || !isFinite(ratio.value)) return null;
  return ratio.value;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function chunkWithMinTail<T>(arr: T[], size: number, minTail: number): T[][] {
  const chunks = chunk(arr, size);
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1]!;
  const prev = chunks[chunks.length - 2]!;
  if (last.length >= minTail) return chunks;

  const needed = minTail - last.length;
  const movable = Math.max(0, prev.length + last.length - size);
  const take = Math.min(needed, movable);
  if (take <= 0) return chunks;

  const moved = prev.splice(prev.length - take, take);
  chunks[chunks.length - 1] = [...moved, ...last];
  return chunks;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
