/**
 * Premium PDF Exporter.
 *
 * Flow:
 * 1) Build deterministic page templates from report/context
 * 2) Apply themed HTML/CSS layout system
 * 3) Render with Puppeteer to PDF
 */

import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Report, AnalysisContext } from '@shawyan/shared';
import { buildReportHTML } from './exporter-template.js';
import { buildPdfPages, PERIOD_BANNER_SLOT } from './pdf-page-templates.js';
import { PDF_THEME } from './pdf-theme.js';
import { runDeterministicQAGates, writeQAFailureReport } from './deterministic-qa.js';
import { writeAuditArtifacts } from './audit-artifacts.js';
import { requireCanonicalReportPackage, type CanonicalReportPackage } from './canonical-report-package.js';
import { renderChartSetWithDatawrapper } from './datawrapper.js';

function defaultReportsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
}

const require = createRequire(import.meta.url);
const DEFAULT_CHROMIUM_PACK_VERSION = '143.0.4';

function defaultLaunchArgs(): string[] {
  return ['--no-sandbox', '--disable-setuid-sandbox'];
}

function defaultChromiumPackUrl(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `https://github.com/Sparticuz/chromium/releases/download/v${DEFAULT_CHROMIUM_PACK_VERSION}/chromium-v${DEFAULT_CHROMIUM_PACK_VERSION}-pack.${arch}.tar`;
}

async function resolveChromiumExecutablePath(): Promise<string> {
  const configuredPackUrl = process.env['DOLPH_CHROMIUM_PACK_URL']?.trim();
  const candidateBinDirs: string[] = [];

  try {
    const pkgJsonPath = require.resolve('@sparticuz/chromium/package.json');
    candidateBinDirs.push(resolve(dirname(pkgJsonPath), 'bin'));
  } catch {
    // Fallback candidates below.
  }

  candidateBinDirs.push(
    resolve(process.cwd(), 'node_modules/@sparticuz/chromium/bin'),
    resolve(process.cwd(), '../../node_modules/@sparticuz/chromium/bin'),
    '/var/task/node_modules/@sparticuz/chromium/bin',
  );

  for (const binDir of [...new Set(candidateBinDirs)]) {
    try {
      await access(binDir);
      return await chromium.executablePath(binDir);
    } catch {
      // Try next candidate.
    }
  }

  return await chromium.executablePath(configuredPackUrl || defaultChromiumPackUrl());
}

async function resolveBrowserExecutablePath(): Promise<{ executablePath?: string; args: string[] }> {
  const configuredPath = process.env['PUPPETEER_EXECUTABLE_PATH']?.trim();
  if (configuredPath) {
    return { executablePath: configuredPath, args: defaultLaunchArgs() };
  }

  // Vercel/serverless Linux does not expose a system Chrome binary.
  if (process.platform === 'linux') {
    const executablePath = await resolveChromiumExecutablePath();
    const mergedArgs = [...new Set([...chromium.args, ...defaultLaunchArgs()])];
    return { executablePath, args: mergedArgs };
  }

  const macChromePath = process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined;
  return { executablePath: macChromePath, args: defaultLaunchArgs() };
}

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
  const isLimitedReport = finalReport.metadata.report_state === 'limited_coverage'
    || finalReport.metadata.report_state === 'unsupported_coverage';
  const pkg = context && !isLimitedReport
    ? requireCanonicalReportPackage(canonicalPackage, 'generatePDF')
    : undefined;

  let fullHTML: string;
  let preRenderQA:
    | ReturnType<typeof runDeterministicQAGates>
    | null = null;
  let renderedCharts = pkg?.charts;

  if (context && pkg) {
    preRenderQA = runDeterministicQAGates(finalReport, context, pkg);

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
    renderedCharts = hasResolvedChartAssets(requiredPackage.charts)
      ? requiredPackage.charts
      : await renderChartSetWithDatawrapper(requiredPackage.charts, finalReport);
    const { bodyHTML } = buildPdfPages(finalReport, {
      ...requiredPackage,
      charts: renderedCharts,
    });
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
    fullHTML = buildReportHTML(finalReport, bodyHTML.split(PERIOD_BANNER_SLOT).join(periodBanner.html));
  } else {
    fullHTML = buildReportHTML(finalReport, buildLimitedBodyHTML(finalReport));
  }

  const { executablePath, args } = await resolveBrowserExecutablePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args,
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

    if (context && policy?.persistAuditArtifacts && pkg && preRenderQA) {
      finalReport.audit = await writeAuditArtifacts({
        report: finalReport,
        context,
        insights: pkg.insights,
        reportModel: pkg.reportModel,
        charts: renderedCharts,
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

function hasResolvedChartAssets(chartSet: CanonicalReportPackage['charts'] | undefined): boolean {
  if (!chartSet?.items?.length) return false;
  return chartSet.items.every((item) => item.renderStatus !== 'pending');
}

function buildLimitedBodyHTML(report: Report): string {
  const pages: string[] = [];
  pages.push(`
    <section class="report-page page-cover">
      <div class="cover-top">
        <div class="cover-brand">Dolph Research</div>
        <div class="cover-family">${escapeHTML(report.type === 'comparison' ? 'Coverage Result' : 'Coverage Result')}</div>
        <div class="cover-date">${escapeHTML(formatDate(report.generated_at))}</div>
      </div>
      <div class="cover-hero">
        <h1>${escapeHTML(report.tickers.join(report.type === 'comparison' ? ' vs ' : ''))}</h1>
      </div>
      <div class="cover-thesis">This result provides a clean reader-facing explanation when a full annual financial note cannot be published through the current SEC/XBRL path.</div>
    </section>
  `);

  for (const section of report.sections) {
    pages.push(`
      <section class="report-page">
        <div class="page-header"><h2>${escapeHTML(section.title)}</h2></div>
        <div class="module">${renderLimitedSection(section.content)}</div>
      </section>
    `);
  }

  return pages.join('\n');
}

function renderLimitedSection(content: string): string {
  const blocks = content.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.every(line => line.startsWith('- '))) {
      return `<ul>${lines.map(line => `<li>${escapeHTML(cleanLimitedText(line.slice(2)))}</li>`).join('')}</ul>`;
    }
    return lines.map(line => `<p>${escapeHTML(cleanLimitedText(line))}</p>`).join('');
  }).join('\n');
}

function cleanLimitedText(value: string): string {
  return value.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 — $2');
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
