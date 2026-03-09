/**
 * Premium PDF Exporter.
 *
 * Flow:
 * 1) Build deterministic page templates from report/context
 * 2) Apply themed HTML/CSS layout system
 * 3) Render with Puppeteer to PDF
 */

import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import type { Report, AnalysisContext } from '@dolph/shared';
import { buildReportHTML } from './exporter-template.js';
import { buildPdfPages, PERIOD_BANNER_SLOT } from './pdf-page-templates.js';
import { PDF_THEME } from './pdf-theme.js';
import { runDeterministicQAGates, writeQAFailureReport } from './deterministic-qa.js';
import { writeAuditArtifacts } from './audit-artifacts.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';
import { defaultReportsDir } from './report-paths.js';

export async function generatePDF(
  report: Report,
  outputDir?: string,
  context?: AnalysisContext,
  canonicalPackage?: CanonicalReportPackage,
): Promise<string> {
  let finalReport = report;
  const dir = outputDir || defaultReportsDir();
  await mkdir(dir, { recursive: true });

  const timestamp = new Date(finalReport.generated_at)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const tickerSlug = finalReport.tickers.join('-');
  const filename = `${tickerSlug}-${timestamp}.pdf`;
  const outputPath = resolve(dir, filename);
  // Fail-closed behavior requires that no stale PDF remains at the target path
  // when validation blocks rendering.
  await rm(outputPath, { force: true });

  const policy = finalReport.policy || context?.policy;
  const pkg = context ? requireCanonicalReportPackage(canonicalPackage, 'generatePDF') : undefined;
  const preRenderQA = context && pkg
    ? runDeterministicQAGates(finalReport, context, pkg)
    : {
      pass: false,
      failures: [{
        gate: 'data.period_coherence' as const,
        severity: 'error' as const,
        source: 'exporter',
        message: 'Analysis context is required for fail-closed deterministic QA.',
      }],
      periodBasis: {},
      mappingFixes: [],
      recomputedMetrics: {},
    };

  if (!preRenderQA.pass) {
    const qaPath = await writeQAFailureReport(finalReport, preRenderQA, dir);
    throw new Error(`PDF generation blocked by deterministic QA gates. Failure report: ${qaPath}`);
  }

  const periodBanner = buildPeriodBanner(finalReport, preRenderQA.periodBasis);
  if (!periodBanner.ok) {
    const combined = {
      ...preRenderQA,
      pass: false,
      failures: [
        ...preRenderQA.failures,
        {
          gate: 'data.period_coherence' as const,
          severity: 'error' as const,
          source: 'period_banner',
          message: periodBanner.error,
        },
      ],
    };
    const qaPath = await writeQAFailureReport(finalReport, combined, dir);
    throw new Error(`PDF generation blocked by deterministic QA gates. Failure report: ${qaPath}`);
  }

  const requiredPackage = requireCanonicalReportPackage(pkg, 'generatePDF');
  const { bodyHTML } = buildPdfPages(finalReport, requiredPackage);
  const expectedBannerCount = countNonCoverSourcesPages(bodyHTML);
  const slotCount = countToken(bodyHTML, PERIOD_BANNER_SLOT);
  if (slotCount !== expectedBannerCount) {
    const combined = {
      ...preRenderQA,
      pass: false,
      failures: [
        ...preRenderQA.failures,
        {
          gate: 'data.period_coherence' as const,
          severity: 'error' as const,
          source: 'period_banner',
          message: `Period banner slots mismatch (${slotCount} found; ${expectedBannerCount} expected).`,
        },
      ],
    };
    const qaPath = await writeQAFailureReport(finalReport, combined, dir);
    throw new Error(`PDF generation blocked by deterministic QA gates. Failure report: ${qaPath}`);
  }
  const fullHTML = buildReportHTML(finalReport, bodyHTML.split(PERIOD_BANNER_SLOT).join(periodBanner.html));

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

    // Truncation check — warn but don't block
    const truncations = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const issues: string[] = [];
      const critical = Array.from(doc.querySelectorAll('.kpi-label, .kpi-value, h1, h2, h3'));
      critical.forEach((el: any) => {
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          issues.push(`Truncation: "${(el.textContent || '').trim().slice(0, 80)}"`);
        }
      });
      return issues;
    });
    if (truncations.length > 0) {
      console.warn(`[dolph] Layout warnings: ${truncations.slice(0, 3).join(' | ')}`);
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
          <span>Dolph Research — ${escapeHTML(finalReport.tickers.join(', '))}</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `,
    });

    if (context && policy?.persistAuditArtifacts && pkg) {
      finalReport.audit = await writeAuditArtifacts({
        report: finalReport,
        context,
        insights: requiredPackage.insights,
        reportModel: requiredPackage.reportModel,
        qa: preRenderQA,
        outputDir: dir,
        pdfPath: outputPath,
      });
    }
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

function buildPeriodBanner(
  report: Report,
  periodBasis: Record<string, { current: string | null; prior: string | null; note?: string }>,
): { ok: true; html: string } | { ok: false; error: string } {
  const missingCurrent = report.tickers.filter(t => !periodBasis[t]?.current);
  if (missingCurrent.length > 0) {
    return {
      ok: false,
      error: `Period missing for ${missingCurrent.join(', ')}.`,
    };
  }

  const pairText = report.tickers.map(ticker => {
    const basis = periodBasis[ticker]!;
    const current = basis.current || 'N/A';
    const prior = basis.prior || 'N/A';
    return `<span class=\"period-chip\"><strong>${escapeHTML(ticker)}</strong> — Current period: ${escapeHTML(current)} | Prior period: ${escapeHTML(prior)}</span>`;
  }).join('');
  const note = report.tickers
    .map(t => periodBasis[t]?.note)
    .filter((n): n is string => !!n)
    .slice(0, 1)
    .map(n => `<span class=\"period-note\">${escapeHTML(n)}</span>`)
    .join('');

  return {
    ok: true,
    html: `<div class=\"module period-banner\"><div class=\"period-banner-row\">${pairText}</div>${note}</div>`,
  };
}

function countToken(input: string, token: string): number {
  if (!token) return 0;
  let count = 0;
  let idx = input.indexOf(token);
  while (idx !== -1) {
    count++;
    idx = input.indexOf(token, idx + token.length);
  }
  return count;
}

function countNonCoverSourcesPages(bodyHTML: string): number {
  const matches = Array.from(bodyHTML.matchAll(/<section class="report-page\s+([^"]*)"/g));
  return matches.filter((m: RegExpMatchArray) => {
    const classes = (m[1] || '').split(/\s+/);
    return !classes.includes('page-cover') && !classes.includes('page-sources');
  }).length;
}

export const __test = {
  buildPeriodBanner,
  countToken,
  countNonCoverSourcesPages,
};
