/**
 * PDF Exporter — converts a Report to a professionally formatted PDF.
 *
 * Flow: Report sections → Markdown → HTML (marked) → PDF (Puppeteer)
 */

import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import puppeteer from 'puppeteer';
import { marked } from 'marked';
import type { Report } from '@filinglens/shared';
import { buildReportHTML } from './exporter-template.js';

/**
 * Generate a PDF report and save it to disk.
 * Returns the absolute path to the generated file.
 */
export async function generatePDF(
  report: Report,
  outputDir?: string,
): Promise<string> {
  const dir = outputDir || resolve(process.cwd(), 'reports');
  await mkdir(dir, { recursive: true });

  const dateStr = new Date(report.generated_at)
    .toISOString()
    .split('T')[0]!;
  const tickerSlug = report.tickers.join('-');
  const filename = `${tickerSlug}-${dateStr}.pdf`;
  const outputPath = resolve(dir, filename);

  // Convert each section from Markdown to HTML
  const sectionsHTML = report.sections
    .map((section) => {
      const contentHTML = marked.parse(section.content, { async: false }) as string;
      return `<div class="section"><h2>${escapeHTML(section.title)}</h2>${contentHTML}</div>`;
    })
    .join('\n');

  // Build full HTML document
  const fullHTML = buildReportHTML(report, sectionsHTML);

  // Launch Puppeteer and render to PDF
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'networkidle0' });

    // Post-process: add color classes to positive/negative values in table cells
    await page.evaluate(`
      document.querySelectorAll('td').forEach(function(td) {
        var text = td.textContent || '';
        if (/^-?\\d/.test(text) && text.includes('%')) {
          if (text.startsWith('-')) {
            td.classList.add('negative');
          } else if (parseFloat(text) > 0) {
            td.classList.add('positive');
          }
        }
      });
    `);

    await page.pdf({
      path: outputPath,
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        bottom: '0.75in',
        left: '0.6in',
        right: '0.6in',
      },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width: 100%; text-align: center; font-size: 8px; color: #999; font-family: Arial, sans-serif;">
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          <span style="margin-left: 20px;">FilingLens — ${escapeHTML(report.tickers.join(', '))}</span>
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
    .replace(/"/g, '&quot;');
}
