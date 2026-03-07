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
const STRICT_LAYOUT_QA_ENV = process.env['DOLPH_STRICT_LAYOUT_QA'] === '1';

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
  const strictLayoutQA = policy?.strictLayoutQA ?? STRICT_LAYOUT_QA_ENV;
  const pkg = context ? requireCanonicalReportPackage(canonicalPackage, 'generatePDF') : undefined;
  const preRenderQA = context && pkg
    ? runDeterministicQAGates(finalReport, context, pkg)
    : {
      pass: false,
      failures: [{
        gate: 'data.period_coherence' as const,
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
          source: 'period_banner',
          message: periodBanner.error,
        },
      ],
    };
    const qaPath = await writeQAFailureReport(finalReport, combined, dir);
    throw new Error(`PDF generation blocked by deterministic QA gates. Failure report: ${qaPath}`);
  }

  const { bodyHTML } = buildPdfPages(finalReport, context, pkg || undefined);
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

    const qaIssues = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const issues: Array<{ gate: string; message: string }> = [];
      const pageEls = Array.from(doc.querySelectorAll('.report-page'));

      pageEls.forEach((pageEl: any, idx: number) => {
        const text = (pageEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 50) {
          issues.push({ gate: 'layout.trailing_pages', message: `Page ${idx + 1}: near-empty content block.` });
        }

        const pageRect = pageEl.getBoundingClientRect();
        const isCover = pageEl.classList.contains('page-cover');
        const isSources = pageEl.classList.contains('page-sources');
        if (!isCover && !isSources) {
          const banners = Array.from(pageEl.querySelectorAll('.period-banner')) as any[];
          if (banners.length !== 1) {
            issues.push({
              gate: 'data.period_coherence',
              message: `Page ${idx + 1}: expected exactly one PeriodBanner, found ${banners.length}.`,
            });
          } else {
            const bannerText = ((banners[0] as any)?.textContent || '').replace(/\\s+/g, ' ').trim();
            if (!/Current period:/i.test(bannerText) || !/Prior period:/i.test(bannerText)) {
              issues.push({
                gate: 'data.period_coherence',
                message: `Page ${idx + 1}: PeriodBanner missing current/prior labels.`,
              });
            }
          }

          const isAppendix = pageEl.classList.contains('page-appendix');
          if (!isAppendix) {
            const primary = pageEl.querySelectorAll('.visual-card, .table-group, .commentary-block, .exec-block, .executive-copy, .executive-scorecard, .executive-strip, .derived-strip, .method-notes');
            if (primary.length < 2) {
              issues.push({
                gate: 'layout.split_modules',
                message: `Page ${idx + 1}: fewer than 2 primary modules (${primary.length}).`,
              });
            }
          }

          const blocks = Array.from(pageEl.querySelectorAll('.page-header, .period-banner, .module, .table-group, .visual-card, .commentary-block, .appendix-module, .appendix-section, table'));
          if (blocks.length > 0) {
            let minTop = Infinity;
            let maxBottom = 0;
            blocks.forEach((el: any) => {
              const r = el.getBoundingClientRect();
              if (r.height < 2) return;
              minTop = Math.min(minTop, r.top);
              maxBottom = Math.max(maxBottom, r.bottom);
            });
            if (minTop < Infinity && maxBottom > minTop && pageRect.height > 0) {
              const fill = (maxBottom - minTop) / pageRect.height;
              if (fill < 0.749) {
                issues.push({
                  gate: 'layout.dead_area',
                  message: `Page ${idx + 1}: content fill ratio ${(fill * 100).toFixed(1)}% is below 75%.`,
                });
              }
            }
          }
        }
      });

      const critical = Array.from(doc.querySelectorAll('.cover-thesis, .kpi-label, .kpi-value, .kpi-note, h1, h2, h3'));
      critical.forEach((el: any) => {
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          issues.push({
            gate: 'layout.truncation',
            message: `Truncation detected in "${(el.textContent || '').trim().slice(0, 80)}".`,
          });
        }
        if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
          issues.push({
            gate: 'layout.truncation',
            message: `Vertical overflow detected in "${(el.textContent || '').trim().slice(0, 80)}".`,
          });
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
        if (remaining < 70) {
          issues.push({
            gate: 'layout.orphan_headers',
            message: `Orphan heading risk near page bottom: "${(h.textContent || '').trim()}".`,
          });
        }
      });

      Array.from(doc.querySelectorAll('.page-dashboard table')).forEach((table: any, idx: number) => {
        const rows = table.querySelectorAll('tbody tr').length;
        if (rows > 8) {
          issues.push({
            gate: 'layout.split_modules',
            message: `Dashboard table ${idx + 1} exceeds 8-row limit (${rows}).`,
          });
        }
      });
      Array.from(doc.querySelectorAll('.page-appendix table')).forEach((table: any, idx: number) => {
        const rows = table.querySelectorAll('tbody tr').length;
        if (rows > 14) {
          issues.push({
            gate: 'layout.split_modules',
            message: `Appendix table ${idx + 1} exceeds 14-row limit (${rows}).`,
          });
        }
      });

      Array.from(doc.querySelectorAll('.metrics-module h3')).forEach((h3: any) => {
        const title = (h3.textContent || '').trim();
        if (!/additional metrics/i.test(title)) return;
        const nextTable = h3.nextElementSibling;
        if (!nextTable || nextTable.tagName !== 'TABLE') {
          issues.push({
            gate: 'layout.split_modules',
            message: 'Additional Metrics heading missing attached table.',
          });
          return;
        }
        const rows = nextTable.querySelectorAll('tbody tr').length;
        if (rows < 3) {
          issues.push({
            gate: 'layout.split_modules',
            message: `Additional Metrics has fewer than 3 rows (${rows}).`,
          });
        }
      });

      return issues;
    });

    const blockingIssues = qaIssues.filter((issue: any) => {
      const gate = String(issue.gate || '');
      if (gate.startsWith('layout.')) return strictLayoutQA;
      return true;
    });

    if (blockingIssues.length > 0) {
      const combined = {
        ...preRenderQA,
        pass: false,
        failures: [
          ...preRenderQA.failures,
          ...blockingIssues.map((issue: any) => ({
            gate: issue.gate as any,
            source: 'layout',
            message: issue.message as string,
          })),
        ],
      };
      const qaPath = await writeQAFailureReport(finalReport, combined, dir);
      throw new Error(
        `PDF generation blocked by layout QA. Failure report: ${qaPath}. ` +
        `First issues: ${blockingIssues.slice(0, 4).map((i: any) => i.message).join(' | ')}`,
      );
    } else if (qaIssues.length > 0) {
      // Non-strict mode: keep layout diagnostics visible without blocking content-correct reports.
      const first = qaIssues.slice(0, 3).map((i: any) => i.message).join(' | ');
      console.warn(`[dolph] Layout QA warnings (non-blocking): ${first}`);
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
        insights: pkg.insights,
        reportModel: pkg.reportModel,
        qa: preRenderQA,
        outputDir: dir,
        pdfPath: outputPath,
        layoutIssues: qaIssues.map((issue: any) => ({ gate: String(issue.gate || ''), message: String(issue.message || '') })),
        narrativePayload: finalReport.narrative,
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
