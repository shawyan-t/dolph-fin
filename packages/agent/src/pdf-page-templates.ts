import type { Report, ReportSection } from '@dolph/shared';
import {
  formatCompactCurrency,
  formatCompactShares,
} from '@dolph/shared';
import {
  PDF_RENDER_RULES,
  clipBullets,
  isUnavailableDisplay,
  normalizeDisplayCell,
  stripMarkdown,
} from './pdf-render-rules.js';
import {
  type CompanyReportModel,
  type ReportModel,
} from './report-model.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';
import { buildCanonicalSourceRows } from './sources-builder.js';

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
  canonicalPackage: CanonicalReportPackage,
): PdfPageBuildResult {
  const { reportModel, charts } = requireCanonicalReportPackage(
    canonicalPackage,
    'buildPdfPages',
  );
  const sections = indexSections(report.sections);
  const primaryCompany = reportModel.companies[0] || null;
  const metricRows = primaryCompany ? metricRowsFromCompany(primaryCompany) : [];
  const pages: string[] = [];

  pages.push(buildFrontPage(report, sections, metricRows, reportModel));
  pages.push(...buildVisualPages(report, charts, reportModel));
  pages.push(...buildDashboardPages(report, reportModel));
  pages.push(buildCommentaryPage(report, metricRows, reportModel));
  pages.push(...buildAppendixPages(report, canonicalPackage));
  pages.push(buildSourcesPage(report, canonicalPackage));

  return { bodyHTML: pages.filter(Boolean).join('\n') };
}

function renderPageHeader(
  title: string,
  kicker: string,
  identifier: string,
): string {
  return `
    <div class="page-header">
      <div class="page-header-top">
        <div class="page-kicker">${escapeHTML(kicker)}</div>
        <div class="page-header-meta">${escapeHTML(identifier)}</div>
      </div>
      <h2>${escapeHTML(title)}</h2>
    </div>
  `;
}

function indexSections(sections: ReportSection[]): Record<string, ReportSection> {
  const map: Record<string, ReportSection> = {};
  for (const section of sections) map[section.id] = section;
  return map;
}

function buildFrontPage(
  report: Report,
  sections: Record<string, ReportSection>,
  metricRows: MetricRow[],
  reportModel: ReportModel | null = null,
): string {
  const companyTitle = report.type === 'single'
    ? (reportModel?.companies[0]?.companyName || report.tickers[0] || 'N/A')
    : report.tickers.join(' vs ');
  const subtitle = report.type === 'comparison' ? 'Peer Comparison Brief' : 'Equity Research Note';
  const executiveSection = sections['executive_summary']?.content || '';
  const executiveBody = isSectionSummaryUsable(executiveSection)
    ? renderNarrativeParagraphs(executiveSection.trim(), 4)
    : '<p class="thesis">The report summarizes the current annual financial profile using the same filing-backed metrics shown throughout the note.</p>';
  const metricStrip = report.type === 'comparison' && reportModel?.type === 'comparison'
    ? buildComparisonMetricStrip(reportModel)
    : buildSingleMetricStrip(metricRows);
  const scorecard = report.type === 'comparison'
    ? buildComparisonExecutiveScorecard(reportModel)
    : buildExecutiveScorecard(new Map(metricRows.map(r => [r.metric, r])));
  const metadata = buildFrontMetadataLine(report, reportModel);

  return `
    <section class="report-page page-front">
      <div class="front-title-block">
        <div class="front-brand-row">
          <div class="cover-brand">Dolph Research</div>
          <div class="front-subtitle">${escapeHTML(subtitle)}</div>
        </div>
        <h1>${escapeHTML(companyTitle)}</h1>
        <div class="front-metadata-line">${metadata}</div>
      </div>
      ${PERIOD_BANNER_SLOT}
      <div class="front-summary">
        ${renderPageHeader(
          'Executive Summary',
          'Executive Summary',
          report.type === 'comparison'
            ? report.tickers.join(' vs ')
            : (reportModel?.companies[0]?.companyName || report.tickers[0] || 'N/A'),
        )}
        <div class="module executive-copy">
          ${executiveBody}
        </div>
      </div>
      ${metricStrip}
      <div class="module executive-scorecard">
        <h3>Snapshot Scorecard</h3>
        ${scorecard}
      </div>
    </section>
  `;
}

function buildFrontMetadataLine(
  report: Report,
  reportModel: ReportModel | null,
): string {
  const bits = [
    report.type === 'comparison' ? 'Comparison' : 'Standalone',
    formatDate(report.generated_at),
  ];
  if (report.type === 'comparison' && report.comparison_basis?.note) {
    bits.push(report.comparison_basis.note);
  } else if (reportModel?.companies[0]?.periodNote) {
    bits.push(reportModel.companies[0].periodNote);
  }
  return bits.map(bit => `<span>${escapeHTML(bit)}</span>`).join('');
}

function buildSingleMetricStrip(metricRows: MetricRow[]): string {
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

  return `
    <section class="module metric-strip">
      ${cards.map(kpi => `
        <article class="metric-strip-item">
          <div class="metric-strip-label">${escapeHTML(kpi.metric)}</div>
          <div class="metric-strip-value">${escapeHTML(normalizeDisplayCell(kpi.current))}</div>
          <div class="metric-strip-note">${escapeHTML(formatKpiNote(kpi))}</div>
        </article>
      `).join('\n')}
    </section>
  `;
}

function buildComparisonMetricStrip(reportModel: ReportModel): string {
  const metrics = ['Revenue', 'Net Income', 'Free Cash Flow', 'Debt-to-Equity'];
  return `
    <section class="module metric-strip">
      ${metrics.map(label => {
    const lines = reportModel.companies.map(company => {
      const value = company.metricsByLabel.get(label)?.currentDisplay
        || company.allMetricsByLabel.get(label)?.currentDisplay
        || 'Not reported';
      return { ticker: company.ticker, value: normalizeDisplayCell(value) };
    });
    return `
      <article class="metric-strip-item">
        <div class="metric-strip-label">${escapeHTML(label)}</div>
        <div class="metric-strip-compare">
          ${lines.map(line => `
            <div class="metric-strip-compare-line">
              <span>${escapeHTML(line.ticker)}</span>
              <strong>${escapeHTML(line.value)}</strong>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }).join('\n')}
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

function metricRowsFromCompany(company: CompanyReportModel): MetricRow[] {
  return company.metrics.map(metric => ({
    metric: metric.label,
    current: metric.currentDisplay,
    prior: metric.priorDisplay,
    change: metric.changeDisplay,
  }));
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
      const cells = reportModel.companies.map(company =>
        company.metricsByLabel.get(label)?.currentDisplay
        || company.allMetricsByLabel.get(label)?.currentDisplay
        || 'Not reported');
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

  if (rows.length < 3) return '<p>No scorecard metrics available.</p>';
  const headers = ['Metric', 'Current', 'Prior', 'Change'];
  return renderTable(headers, rows);
}

interface VisualItem {
  kind: 'chart';
  title: string;
  caption: string;
  svg?: string;
}

function buildVisualPages(
  report: Report,
  chartSet: CanonicalReportPackage['charts'],
  reportModel: ReportModel,
): string[] {
  const identifier = report.type === 'comparison'
    ? report.tickers.join(' vs ')
    : (reportModel.companies[0]?.companyName || report.tickers[0] || 'N/A');
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

  if (visuals.length === 0) return [];

  return [`
    <section class="report-page page-visual">
      ${renderPageHeader('Visual Highlights', 'Charts', identifier)}
      ${PERIOD_BANNER_SLOT}
      <div class="visual-grid ${visuals.length === 1 ? 'single' : ''}">
        ${visuals.map(card => `
          <figure class="visual-card">
            <div class="visual-frame">${card.svg || ''}</div>
            <figcaption>
              <h3>${escapeHTML(card.title)}</h3>
              <p>${escapeHTML(card.caption)}</p>
            </figcaption>
          </figure>
        `).join('\n')}
      </div>
    </section>
  `];
}

function buildDashboardPages(
  report: Report,
  reportModel: ReportModel,
): string[] {
  const identifier = report.type === 'comparison'
    ? report.tickers.join(' vs ')
    : (reportModel.companies[0]?.companyName || report.tickers[0] || 'N/A');
  const parsed = dashboardGroupsFromReportModel(reportModel)
    .filter(g => g.rows.length > 0);
  const groups = splitLargeDashboardGroups(parsed, PDF_RENDER_RULES.tables.maxFrontRows);

  if (groups.length === 0) {
    return [`
      <section class="report-page page-dashboard">
        ${renderPageHeader('Key Metrics Dashboard', 'Dashboard', identifier)}
        ${PERIOD_BANNER_SLOT}
        <div class="module metrics-module"><p>No key metrics available.</p></div>
      </section>
    `];
  }

  // Simple pagination: ~3 groups per page
  const perPage = 3;
  const pages: string[] = [];
  for (let i = 0; i < groups.length; i += perPage) {
    const chunk = groups.slice(i, i + perPage);
    const title = i === 0 ? 'Key Metrics Dashboard' : `Key Metrics Dashboard (Cont.)`;
    pages.push(`
      <section class="report-page page-dashboard">
        ${renderPageHeader(title, 'Dashboard', identifier)}
        ${PERIOD_BANNER_SLOT}
        <div class="metrics-grid stacked">
          ${chunk.map(group => renderTableGroup(group)).join('\n')}
        </div>
      </section>
    `);
  }
  return pages;
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
  return reportModel.comparisonRowGroups.map(group => ({
    title: group.title,
    headers: ['Metric', ...tickers],
    rows: group.rowLabels.map(label => [
      label,
      ...reportModel.companies.map(company =>
        company.metricsByLabel.get(label)?.currentDisplay
        || company.allMetricsByLabel.get(label)?.currentDisplay
        || 'Not reported'),
    ]),
  }));
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

function buildCommentaryPage(
  report: Report,
  metricRows: MetricRow[],
  reportModel: ReportModel | null = null,
): string {
  const standout = commentaryParagraphsFromReport(
    report,
    report.type === 'comparison' ? 'relative_strengths' : 'trend_analysis',
    2,
  );
  const watch = commentaryParagraphsFromReport(report, 'risk_factors', 2, true);
  const interpretation = commentaryParagraphsFromReport(report, 'analyst_notes', 2);

  const blocks = [
    buildCommentaryBlock('What stands out', standout),
    buildCommentaryBlock('Watch items', watch),
    buildCommentaryBlock('Analyst interpretation', interpretation),
  ].filter(Boolean).join('\n');

  return `
    <section class="report-page page-commentary">
      ${renderPageHeader(
        'Commentary',
        'Analysis',
        report.type === 'comparison'
          ? report.tickers.join(' vs ')
          : (reportModel?.companies[0]?.companyName || report.tickers[0] || 'N/A'),
      )}
      ${PERIOD_BANNER_SLOT}
      ${blocks}
      ${buildCommentaryChecklist(
        report,
        reportModel?.companies[0] ? metricRowsFromCompany(reportModel.companies[0]) : metricRows,
        reportModel,
      )}
    </section>
  `;
}

function commentaryParagraphsFromReport(
  report: Report,
  sectionId: string,
  maxParagraphs: number,
  strictWatch = false,
): string[] {
  const structured = report.narrative?.sections.find(section => section.id === sectionId);
  const candidateParagraphs = structured?.paragraphs?.map(paragraph => paragraph.text)
    || sectionTextParagraphs(report.sections.find(section => section.id === sectionId)?.content || '');
  const paragraphs = sanitizeParagraphs(candidateParagraphs.map(normalizeNarrativeParagraph))
    .filter(s => s.length >= 24)
    .filter(s => !/anomaly in|significant spike|σ|z-score/i.test(s));
  const filtered = strictWatch
    ? paragraphs.filter(s => /risk|watch|leverage|liquidity|volatility|pressure|constraint|declin|debt|cash burn|coverage/i.test(s))
    : paragraphs;
  const selected = (filtered.length > 0 ? filtered : paragraphs).slice(0, maxParagraphs);
  return selected;
}

function normalizeNarrativeParagraph(text: string): string {
  return text
    .replace(/^[-*]\s+/, '')
    .replace(/^\*\*([^*]+)\*\*:\s*/, '$1: ')
    .replace(/^#{1,4}\s+/, '')
    .trim();
}

function sanitizeParagraphs(items: string[]): string[] {
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

function sectionTextParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

function buildCommentaryBlock(title: string, paragraphs: string[]): string {
  if (paragraphs.length === 0) return '';
  return `
    <section class="module commentary-block">
      <h3>${escapeHTML(title)}</h3>
      ${paragraphs.map(item => `<p>${escapeHTML(item)}</p>`).join('')}
    </section>
  `;
}

function buildCommentaryChecklist(
  report: Report,
  metricRows: MetricRow[],
  reportModel: ReportModel | null = null,
): string {
  if (report.type === 'comparison') {
    const basis = reportModel?.comparisonBasis;
    const notes: string[] = [];
    if (basis?.note) notes.push(basis.note);
    const peerPeriods = basis
      ? Object.entries(basis.peer_periods)
        .map(([ticker, binding]) => `${ticker}: ${binding.current_period || 'N/A'} current / ${binding.prior_period || 'N/A'} prior`)
      : [];
    if (peerPeriods.length > 0) notes.push(`Peer reporting periods used in this note: ${peerPeriods.join('; ')}.`);
    const unavailable = (reportModel?.companies || [])
      .map(company => ({
        ticker: company.ticker,
        count: company.metrics.filter(metric => isUnavailableDisplay(metric.currentDisplay)).length,
      }))
      .filter(item => item.count > 0);
    if (unavailable.length > 0) {
      notes.push(`Certain peer metrics remain absent where the underlying filings do not disclose them on a comparable basis.`);
    }
    if (notes.length === 0) return '';
    return `
      <section class="module checklist-block">
        <h3>Comparison Notes</h3>
        ${clipBullets(notes, 3).map(item => `<p>${escapeHTML(item)}</p>`).join('')}
      </section>
    `;
  }
  return '';
}

function buildAppendixPages(
  report: Report,
  canonicalPackage: CanonicalReportPackage,
): string[] {
  const { context, reportModel: model } = requireCanonicalReportPackage(canonicalPackage, 'buildAppendixPages');
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
        ${renderPageHeader(
          'Appendix',
          'Appendix',
          report.type === 'comparison'
            ? report.tickers.join(' vs ')
            : (model.companies[0]?.companyName || report.tickers[0] || 'N/A'),
        )}
        ${PERIOD_BANNER_SLOT}
        <div class="module appendix-module"><p>Financial statements unavailable for this report run.</p></div>
      </section>
    `];
  }

  // Simple pagination: ~2 statement tables per page
  const perPage = 2;
  const pages: string[] = [];
  for (let i = 0; i < modules.length; i += perPage) {
    const chunk = modules.slice(i, i + perPage);
    const title = i === 0 ? 'Appendix' : 'Appendix (Cont.)';
    pages.push(`
      <section class="report-page page-appendix">
        ${renderPageHeader(
          title,
          'Appendix',
          report.type === 'comparison'
            ? report.tickers.join(' vs ')
            : (model.companies[0]?.companyName || report.tickers[0] || 'N/A'),
        )}
        ${PERIOD_BANNER_SLOT}
        ${chunk.map(mod => `
          <section class="appendix-section">
            <h3>${escapeHTML(mod.title)}</h3>
            ${renderTable(mod.headers, mod.rows)}
          </section>
        `).join('\n')}
      </section>
    `);
  }
  return pages;
}

function formatByUnit(n: number, unit?: string): string {
  if (!isFinite(n)) return 'N/A';
  if (unit === '%' || unit === 'pure') return n.toFixed(2);
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${n.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(n);
  return formatCompactCurrency(n, { smallDecimals: 0, smartDecimals: true });
}

function buildSourcesPage(
  report: Report,
  canonicalPackage: CanonicalReportPackage,
): string {
  const pkg = requireCanonicalReportPackage(canonicalPackage, 'buildSourcesPage');
  const sourceRows = buildCanonicalSourceRows(canonicalPackage);
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
    : '<p>No filing references were captured for this run.</p>';

  const runDate = escapeHTML(report.generated_at.slice(0, 10));
  const comparisonMethodNote = report.type === 'comparison'
    ? (report.comparison_basis?.note
      || 'Comparisons reflect each issuer’s latest annual filing period unless otherwise noted.')
    : 'Standalone metrics use the selected current and prior annual periods for the issuer.';
  const exclusions = pkg.context.comparison_exclusions || [];
  const exclusionNote = exclusions.length > 0
    ? `<p>Excluded issuers: ${escapeHTML(exclusions.map(item => `${item.ticker} — ${item.reason}`).join(' | '))}</p>`
    : '';

  return `
    <section class="report-page page-sources">
      ${renderPageHeader(
        'Data Sources & Notes',
        'Sources',
        report.type === 'comparison'
          ? report.tickers.join(' vs ')
          : (pkg.reportModel.companies[0]?.companyName || report.tickers[0] || 'N/A'),
      )}
      <div class="module sources-module">
        ${sourceTable}
      </div>
      <div class="module methodology-module">
        <h3>Method Notes</h3>
        <p>Financial values are sourced from SEC EDGAR filings and normalized into statement-level metrics.</p>
        <p>${escapeHTML(comparisonMethodNote)}</p>
        <p>The narrative summarizes the filing-backed figures shown elsewhere in the report and does not alter the calculations.</p>
        <p class="source-note">Report date: ${runDate}.</p>
        ${exclusionNote}
        <p class="source-note">Disclaimer: For research use only; not investment advice.</p>
      </div>
    </section>
  `;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
