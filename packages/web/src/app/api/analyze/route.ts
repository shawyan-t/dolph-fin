import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { loadAnalysisRecord, saveAnalysisRecord } from '@/lib/history-store';
import { registerArtifact } from '@/lib/artifact-store';
import type { Report } from '@dolph/shared';
import type { CanonicalReportPackage } from '@dolph/agent/dist/canonical-report-package.js';
import type { AnalysisContext } from '@dolph/shared';
import type { ChartSet } from '@dolph/agent/dist/charts.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.DOLPH_WEB_RATE_LIMIT_MAX || '10', 10);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

interface DownloadArtifact {
  token: string;
  filename: string;
}

interface FinalReportPayload extends Report {
  artifacts?: {
    pdf?: DownloadArtifact | null;
    csv?: DownloadArtifact | null;
  };
  charts?: RenderedChartPayload[];
}

interface RenderedChartPayload {
  key: string;
  title: string;
  caption: string;
  assetType: 'svg' | 'png';
  mimeType: string;
  content: string;
}

async function getPipelineModule() {
  return import('@dolph/agent/pipeline');
}

async function getExporterModule() {
  return import('@dolph/agent/dist/exporter.js');
}

async function getCsvExporterModule() {
  return import('@dolph/agent/dist/exporter-csv.js');
}

async function getReportPathsModule() {
  return import('@dolph/agent/dist/report-paths.js');
}

async function getResolverModule() {
  return import('@dolph/mcp-sec-server/resolver');
}

async function getDatawrapperModule() {
  return import('@dolph/agent/dist/datawrapper.js');
}

async function loadDolphEnv() {
  await applyEnvFile(resolve(process.cwd(), '.env'), false);
  await applyEnvFile(resolve(homedir(), '.dolph/.env'), true);
}

async function applyEnvFile(filePath: string, override: boolean) {
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!override && process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  } catch {
    // Missing env file is fine.
  }
}

const AnalyzeRequestSchema = z.object({
  analysis_id: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/).optional(),
  tickers: z.array(z.string().min(1).max(120)).min(1).max(5),
  type: z.enum(['single', 'comparison']),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  narrative_mode: z.enum(['llm', 'deterministic']).optional(),
  output_format: z.enum(['terminal', 'pdf', 'both']).optional(),
});

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = rateLimitStore.get(ip);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

function cleanupRateLimitStore(): void {
  const now = Date.now();
  rateLimitStore.forEach((entry, ip) => {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  });
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function preparePdfRuntimeEnv() {
  void loadDolphEnv();
  process.env['WS_NO_BUFFER_UTIL'] = '1';
  process.env['WS_NO_UTF_8_VALIDATE'] = '1';
}

function serializeRenderedCharts(chartSet?: ChartSet): RenderedChartPayload[] {
  if (!chartSet?.items?.length) return [];
  return chartSet.items
    .filter((item) => item.renderStatus === 'rendered' && item.asset)
    .map((item) => ({
      key: item.key,
      title: item.title,
      caption: item.caption,
      assetType: item.asset!.assetType,
      mimeType: item.asset!.mimeType,
      content: item.asset!.content,
    }));
}

async function buildArtifacts(args: {
  report: Report;
  context?: AnalysisContext;
  canonicalPackage?: CanonicalReportPackage;
  outputFormat: 'terminal' | 'pdf' | 'both';
  sendStep: (step: string, status: 'running' | 'complete' | 'error', detail?: string) => void;
}): Promise<FinalReportPayload['artifacts']> {
  const { report, context, canonicalPackage, outputFormat, sendStep } = args;
  const { defaultReportsDir } = await getReportPathsModule();
  const reportsDir = defaultReportsDir();
  const artifacts: NonNullable<FinalReportPayload['artifacts']> = {};

  if (outputFormat === 'pdf' || outputFormat === 'both') {
    try {
      sendStep('Preparing PDF', 'running');
      preparePdfRuntimeEnv();
      const { generatePDF } = await getExporterModule();
      const pdfPath = await generatePDF(report, reportsDir, context, canonicalPackage);
      artifacts.pdf = await registerArtifact(pdfPath, basename(pdfPath), 'application/pdf');
      sendStep('Preparing PDF', 'complete', basename(pdfPath));
    } catch (error) {
      sendStep('Preparing PDF', 'error', error instanceof Error ? error.message : 'PDF generation failed');
      artifacts.pdf = null;
    }
  }

  if (context && canonicalPackage) {
    try {
      sendStep('Preparing CSV export', 'running');
      const { exportCSV } = await getCsvExporterModule();
      const csv = await exportCSV(report, context, canonicalPackage.reportModel, reportsDir);
      artifacts.csv = await registerArtifact(csv.combinedPath, basename(csv.combinedPath), 'text/csv; charset=utf-8');
      sendStep('Preparing CSV export', 'complete', basename(csv.combinedPath));
    } catch (error) {
      sendStep('Preparing CSV export', 'error', error instanceof Error ? error.message : 'CSV export failed');
      artifacts.csv = null;
    }
  }

  return artifacts;
}

async function resolveTickers(rawTickers: string[]) {
  const resolvedTickers: string[] = [];
  const { resolveTickerWithConfidence } = await getResolverModule();
  for (const raw of rawTickers) {
    const resolved = await resolveTickerWithConfidence(raw);
    if (!resolved) {
      return {
        error: new Response(JSON.stringify({ error: `Could not resolve ticker \"${raw}\"` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }

    if (resolved.confidence < 0.7) {
      return {
        error: new Response(JSON.stringify({
          error: `Ticker \"${raw}\" is ambiguous`,
          best_match: resolved.ticker,
          alternatives: resolved.alternatives.map(option => option.ticker),
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }

    resolvedTickers.push(resolved.ticker);
  }

  return { tickers: resolvedTickers };
}

export async function POST(request: NextRequest) {
  await loadDolphEnv();
  cleanupRateLimitStore();

  const apiKey = process.env.DOLPH_WEB_API_KEY;
  if (apiKey) {
    const provided = request.headers.get('x-api-key');
    if (!provided || provided !== apiKey) {
      return unauthorized('Unauthorized');
    }
  }

  const allowedOrigin = process.env.DOLPH_WEB_ALLOWED_ORIGIN;
  const origin = request.headers.get('origin');
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({
      error: 'Invalid request',
      details: parsed.error.issues.map(issue => issue.message),
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { analysis_id, tickers: rawTickers, type, snapshot_date, narrative_mode, output_format } = parsed.data;
  const resolution = await resolveTickers(rawTickers);
  if ('error' in resolution) return resolution.error;
  const tickers = resolution.tickers;

  const existingRecord = analysis_id ? await loadAnalysisRecord(analysis_id) : null;
  const matchesExisting = existingRecord
    && existingRecord.type === type
    && existingRecord.snapshot_date === snapshot_date
    && existingRecord.tickers.length === tickers.length
    && existingRecord.tickers.every((ticker, index) => ticker === tickers[index]);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let disconnected = false;
      const pipelineAbortController = new AbortController();
      request.signal.addEventListener('abort', () => {
        disconnected = true;
        pipelineAbortController.abort();
      });

      const send = (eventType: string, data: unknown) => {
        if (disconnected) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: eventType, data })}\n\n`));
      };

      const sendStep = (step: string, status: 'running' | 'complete' | 'error', detail?: string) => {
        send('step', { step, status, detail });
      };

      try {
        if (matchesExisting && existingRecord) {
          sendStep('Loading analysis history', 'complete', 'Loaded saved analysis');
          send('final_report', existingRecord.report);
          controller.close();
          return;
        }

        const { runPipeline } = await getPipelineModule();
        await runPipeline(
          {
            tickers,
            type,
            maxRetries: 2,
            maxValidationLoops: 2,
            snapshotDate: snapshot_date,
            narrativeMode: narrative_mode || 'deterministic',
            outputFormat: output_format || 'terminal',
            abortSignal: pipelineAbortController.signal,
          },
          undefined,
          {
            onStep(step, status, detail) {
              sendStep(step, status, detail);
            },
            onPartialReport(sectionId, content) {
              send('partial_report', { section: sectionId, content });
            },
            async onComplete(report, context, canonicalPackage) {
              let packageForArtifacts = canonicalPackage;
              let renderedCharts = canonicalPackage?.charts;

              if (canonicalPackage && report.metadata?.report_state === 'full') {
                try {
                  sendStep('Rendering charts', 'running');
                  const { renderChartSetWithDatawrapper } = await getDatawrapperModule();
                  renderedCharts = await renderChartSetWithDatawrapper(canonicalPackage.charts, report);
                  packageForArtifacts = {
                    ...canonicalPackage,
                    charts: renderedCharts,
                  };
                  const renderedCount = renderedCharts.items.filter((item) => item.renderStatus === 'rendered').length;
                  sendStep('Rendering charts', 'complete', `${renderedCount} chart(s) prepared`);
                } catch {
                  renderedCharts = canonicalPackage.charts;
                  sendStep('Rendering charts', 'error', 'Chart rendering failed');
                }
              }

              const artifacts = await buildArtifacts({
                report,
                context,
                canonicalPackage: packageForArtifacts,
                outputFormat: output_format || 'terminal',
                sendStep,
              });

              const finalPayload: FinalReportPayload = {
                ...report,
                artifacts,
                charts: serializeRenderedCharts(renderedCharts),
              };

              send('final_report', finalPayload);

              if (analysis_id) {
                try {
                  await saveAnalysisRecord({
                    id: analysis_id,
                    created_at: existingRecord?.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    tickers,
                    type,
                    snapshot_date,
                    report,
                  });
                } catch {
                  // Non-fatal for web delivery.
                }
              }
            },
            onError(error) {
              send('error', { message: error });
            },
          },
        );
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : 'Analysis failed' });
      } finally {
        if (!disconnected) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, { headers: buildHeaders() });
}
