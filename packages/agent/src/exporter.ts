/**
 * PDF Exporter — converts a Report to a professionally formatted PDF.
 *
 * Flow: Report sections → Markdown → HTML (marked) → PDF (Puppeteer)
 *
 * With structured LLM output, section content no longer contains
 * duplicate headings or section ID artifacts. The exporter is simpler.
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { marked } from 'marked';
import type { Report, AnalysisContext } from '@dolph/shared';
import { buildReportHTML } from './exporter-template.js';
import { generateCharts } from './charts.js';

/**
 * Generate a PDF report and save it to disk.
 * Returns the absolute path to the generated file.
 */
export async function generatePDF(
  report: Report,
  outputDir?: string,
  context?: AnalysisContext,
): Promise<string> {
  const dir = outputDir || resolve(process.cwd(), 'reports');
  await mkdir(dir, { recursive: true });

  // Include time component to prevent same-day overwrites
  const timestamp = new Date(report.generated_at)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19); // YYYY-MM-DDTHH-MM-SS
  const tickerSlug = report.tickers.join('-');
  const filename = `${tickerSlug}-${timestamp}.pdf`;
  const outputPath = resolve(dir, filename);

  // Generate charts from context data (deterministic SVGs)
  let chartsHTML = '';
  if (context) {
    const charts = generateCharts(context);
    const chartParts: string[] = [];

    if (charts.revenueMarginChart) chartParts.push(charts.revenueMarginChart);
    if (charts.fcfBridgeChart) chartParts.push(charts.fcfBridgeChart);
    if (charts.growthDurabilityChart) chartParts.push(charts.growthDurabilityChart);
    if (charts.peerScorecardChart) chartParts.push(charts.peerScorecardChart);
    if (charts.returnLeverageChart) chartParts.push(charts.returnLeverageChart);

    if (chartParts.length > 0) {
      chartsHTML = `<div class="section charts-section"><h2>Visual Analysis</h2><div class="charts-grid">${chartParts.join('\n')}</div></div>`;
    }
  }

  // Convert each section from Markdown to HTML
  const sectionParts: string[] = [];
  for (const section of report.sections) {
    const contentHTML = marked.parse(section.content, { async: false }) as string;
    sectionParts.push(`<div class="section"><h2>${escapeHTML(section.title)}</h2>${contentHTML}</div>`);

    // Insert charts after Executive Summary
    if (section.id === 'executive_summary' && chartsHTML) {
      sectionParts.push(chartsHTML);
      chartsHTML = '';
    }
  }

  // If charts weren't inserted, add them at the start
  if (chartsHTML) {
    sectionParts.unshift(chartsHTML);
  }

  const sectionsHTML = sectionParts.join('\n');
  const fullHTML = buildReportHTML(report, sectionsHTML);

  // Launch Puppeteer and render to PDF.
  // --no-sandbox is required for many CI/container environments and macOS.
  // This is safe here because we only render locally-generated HTML (no external content).
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'networkidle0' });

    // Post-process: color only percentage-change cells (not absolute dollar values)
    await page.evaluate(`
      document.querySelectorAll('td').forEach(function(td) {
        var text = (td.textContent || '').trim();
        if (!text.includes('%')) return;
        if (td.cellIndex === 0) return;
        var num = parseFloat(text.replace(/[^\\d.\\-]/g, ''));
        if (isNaN(num) || num === 0) return;
        if (text.startsWith('-') || num < 0) {
          td.classList.add('negative');
        } else {
          td.classList.add('positive');
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
          <span style="margin-left: 20px;">Dolph — ${escapeHTML(report.tickers.join(', '))}</span>
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
