/**
 * Premium PDF Exporter.
 *
 * Flow:
 * 1) Build deterministic page templates from report/context
 * 2) Apply themed HTML/CSS layout system
 * 3) Render with Puppeteer to PDF
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import type { Report, AnalysisContext } from '@dolph/shared';
import { buildReportHTML } from './exporter-template.js';
import { buildPdfPages } from './pdf-page-templates.js';
import { PDF_THEME } from './pdf-theme.js';

export async function generatePDF(
  report: Report,
  outputDir?: string,
  context?: AnalysisContext,
): Promise<string> {
  const dir = outputDir || resolve(process.cwd(), 'reports');
  await mkdir(dir, { recursive: true });

  const timestamp = new Date(report.generated_at)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const tickerSlug = report.tickers.join('-');
  const filename = `${tickerSlug}-${timestamp}.pdf`;
  const outputPath = resolve(dir, filename);

  const { bodyHTML } = buildPdfPages(report, context);
  const fullHTML = buildReportHTML(report, bodyHTML);

  const platformDefaultChrome = process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined;
  const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'] || platformDefaultChrome;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'networkidle0' });

    await page.evaluate(`
      document.querySelectorAll('td').forEach(function(td) {
        var text = (td.textContent || '').trim();
        if (td.cellIndex === 0 || !text) return;
        var num = parseFloat(text.replace(/[^\\d.\\-]/g, ''));
        if (isNaN(num)) return;
        if (text.includes('%') || text.includes('x')) {
          if (num < 0 || text.startsWith('-')) td.classList.add('negative');
          else if (num > 0) td.classList.add('positive');
        }
      });
    `);

    const qaIssues = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const issues: string[] = [];
      const pageEls = Array.from(doc.querySelectorAll('.report-page'));

      pageEls.forEach((pageEl: any, idx: number) => {
        const text = (pageEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 50) issues.push(`Page ${idx + 1}: near-empty content block.`);
      });

      const critical = Array.from(doc.querySelectorAll('.cover-thesis, .kpi-label, .kpi-value, .kpi-note, h1, h2, h3'));
      critical.forEach((el: any) => {
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          issues.push(`Truncation detected in "${(el.textContent || '').trim().slice(0, 80)}".`);
        }
        if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
          issues.push(`Vertical overflow detected in "${(el.textContent || '').trim().slice(0, 80)}".`);
        }
      });

      const allHeadings = Array.from(doc.querySelectorAll(
        '.report-page > .page-header h2, .report-page .table-group > h3, .report-page .appendix-section > h3, .report-page .commentary-block > h3',
      ));
      allHeadings.forEach((h: any) => {
        const pageEl = h.closest('.report-page');
        if (!pageEl) return;
        const hRect = h.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();
        const remaining = pageRect.bottom - hRect.bottom;
        if (remaining < 70) issues.push(`Orphan heading risk near page bottom: "${(h.textContent || '').trim()}".`);
      });

      Array.from(doc.querySelectorAll('.page-dashboard table')).forEach((table: any, idx: number) => {
        const rows = table.querySelectorAll('tbody tr').length;
        if (rows > 8) issues.push(`Dashboard table ${idx + 1} exceeds 8-row limit (${rows}).`);
      });
      Array.from(doc.querySelectorAll('.page-appendix table')).forEach((table: any, idx: number) => {
        const rows = table.querySelectorAll('tbody tr').length;
        if (rows > 14) issues.push(`Appendix table ${idx + 1} exceeds 14-row limit (${rows}).`);
      });

      Array.from(doc.querySelectorAll('.metrics-module h3')).forEach((h3: any) => {
        const title = (h3.textContent || '').trim();
        if (!/additional metrics/i.test(title)) return;
        const nextTable = h3.nextElementSibling;
        if (!nextTable || nextTable.tagName !== 'TABLE') {
          issues.push('Additional Metrics heading missing attached table.');
          return;
        }
        const rows = nextTable.querySelectorAll('tbody tr').length;
        if (rows < 3) issues.push(`Additional Metrics has fewer than 3 rows (${rows}).`);
      });

      return issues;
    });

    if (qaIssues.length > 0) {
      throw new Error(`PDF layout QA failed: ${qaIssues.slice(0, 8).join(' | ')}`);
    }

    await page.pdf({
      path: outputPath,
      format: PDF_THEME.page.size,
      printBackground: true,
      margin: PDF_THEME.page.margin,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;padding:0 24px;font-size:8px;color:${PDF_THEME.colors.mutedText};font-family:${PDF_THEME.fonts.body};display:flex;justify-content:space-between;">
          <span>Dolph Research — ${escapeHTML(report.tickers.join(', '))}</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `,
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
