import type { Report } from '@shawyan/shared';
import type {
  ChartAssetType,
  ChartRenderDiagnostic,
  ChartRenderStatus,
  ChartSet,
  PreparedChartItem,
  RenderedChartAsset,
} from './charts.js';
import { serializePreparedChartDataset } from './charts.js';

const DATAWRAPPER_API_BASE = 'https://api.datawrapper.de/v3';

interface DatawrapperChart {
  id: string;
  title?: string;
}

interface ChartExportConfig {
  preferredFormat: ChartAssetType;
  allowPngFallback: boolean;
}

class DatawrapperApiError extends Error {
  status: number;
  endpoint: string;
  body: string;

  constructor(endpoint: string, status: number, body: string) {
    super(`Datawrapper API error (${status}) at ${endpoint}`);
    this.name = 'DatawrapperApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

export async function renderChartSetWithDatawrapper(
  chartSet: ChartSet,
  report: Report,
): Promise<ChartSet> {
  const apiKey = process.env['DATAWRAPPER_API_KEY']?.trim();
  if (!apiKey) return chartSet;

  const config = getChartExportConfig();
  const folderId = await ensureFolder(apiKey, buildFolderName(report)).catch(() => null);
  const items: PreparedChartItem[] = [];

  for (const item of chartSet.items) {
    const rendered = await renderPreparedChart(apiKey, item, folderId, config);
    items.push(rendered);
    if (rendered.renderStatus === 'failed') {
      console.warn(
        `[dolph] Datawrapper chart render failed: ${rendered.title} (${rendered.exportDiagnostics.map(diag => `${diag.stage}${diag.exportFormat ? `:${diag.exportFormat}` : ''}:${diag.httpStatus ?? 'n/a'}`).join(', ')})`,
      );
    } else if (rendered.fallbackUsed) {
      console.warn(`[dolph] Datawrapper chart rendered via PNG fallback: ${rendered.title}`);
    }
  }

  return { items };
}

async function renderPreparedChart(
  apiKey: string,
  item: PreparedChartItem,
  folderId: string | null,
  config: ChartExportConfig,
): Promise<PreparedChartItem> {
  const diagnostics: ChartRenderDiagnostic[] = [];
  let chartId: string | null = null;

  try {
    const chart = await createChart(apiKey, item, folderId);
    chartId = chart.id;
    diagnostics.push(successDiagnostic(item, chartId, 'create', null, '/charts'));
  } catch (error) {
    return finalizeFailedItem(item, chartId, diagnostics, stageDiagnostic(item, chartId, 'create', null, '/charts', error, false));
  }

  try {
    await uploadChartData(apiKey, chartId, serializePreparedChartDataset(item.dataset));
    diagnostics.push(successDiagnostic(item, chartId, 'upload', null, `/charts/${chartId}/data`));
  } catch (error) {
    return finalizeFailedItem(item, chartId, diagnostics, stageDiagnostic(item, chartId, 'upload', null, `/charts/${chartId}/data`, error, false));
  }

  try {
    await updateChartMetadata(apiKey, chartId, item);
    diagnostics.push(successDiagnostic(item, chartId, 'metadata', null, `/charts/${chartId}`));
  } catch (error) {
    diagnostics.push(stageDiagnostic(item, chartId, 'metadata', null, `/charts/${chartId}`, error, false));
  }

  try {
    await publishChart(apiKey, chartId);
    diagnostics.push(successDiagnostic(item, chartId, 'publish', null, `/charts/${chartId}/publish`));
  } catch (error) {
    return finalizeFailedItem(item, chartId, diagnostics, stageDiagnostic(item, chartId, 'publish', null, `/charts/${chartId}/publish`, error, false));
  }

  const exportOrder = buildExportOrder(config);
  for (const format of exportOrder) {
    const fallbackTriggered = format !== config.preferredFormat;
    const endpoint = buildExportPath(chartId, item, format);
    try {
      const asset = format === 'svg'
        ? await exportChartSvg(apiKey, endpoint)
        : await exportChartPng(apiKey, endpoint);
      diagnostics.push({
        chartId,
        chartTitle: item.title,
        stage: 'export',
        exportFormat: format,
        endpoint,
        httpStatus: 200,
        ok: true,
        message: `${format.toUpperCase()} export succeeded.`,
        fallbackTriggered,
        finalAssetType: asset.assetType,
        finalRenderResult: 'rendered',
      });
      return {
        ...item,
        datawrapperChartId: chartId,
        asset,
        renderStatus: 'rendered',
        exportDiagnostics: diagnostics,
        fallbackUsed: fallbackTriggered,
      };
    } catch (error) {
      const diagnostic = stageDiagnostic(item, chartId, 'export', format, endpoint, error, fallbackTriggered);
      diagnostics.push(diagnostic);
      if (!shouldAttemptFallback(config, format, diagnostic)) {
        break;
      }
    }
  }

  return finalizeFailedItem(item, chartId, diagnostics);
}

function buildExportOrder(config: ChartExportConfig): ChartAssetType[] {
  const order: ChartAssetType[] = [config.preferredFormat];
  if (config.allowPngFallback && config.preferredFormat !== 'png') {
    order.push('png');
  }
  if (config.preferredFormat === 'png' && !order.includes('svg')) {
    order.push('svg');
  }
  return order;
}

function shouldAttemptFallback(
  config: ChartExportConfig,
  attemptedFormat: ChartAssetType,
  diagnostic: ChartRenderDiagnostic,
): boolean {
  if (!config.allowPngFallback) return false;
  if (attemptedFormat !== 'svg') return false;
  return diagnostic.httpStatus === 401
    || diagnostic.httpStatus === 403
    || diagnostic.httpStatus === 404
    || diagnostic.stage === 'export';
}

function getChartExportConfig(): ChartExportConfig {
  const preferredRaw = (process.env['DOLPH_CHART_EXPORT_PREFERRED'] || 'svg').trim().toLowerCase();
  const preferredFormat: ChartAssetType = preferredRaw === 'png' ? 'png' : 'svg';
  const allowPngFallback = (process.env['DOLPH_CHART_ALLOW_PNG_FALLBACK'] || 'true').trim().toLowerCase() !== 'false';
  return { preferredFormat, allowPngFallback };
}

function finalizeFailedItem(
  item: PreparedChartItem,
  chartId: string | null,
  diagnostics: ChartRenderDiagnostic[],
  additionalDiagnostic?: ChartRenderDiagnostic,
): PreparedChartItem {
  const exportDiagnostics = additionalDiagnostic ? [...diagnostics, additionalDiagnostic] : diagnostics;
  return {
    ...item,
    datawrapperChartId: chartId,
    asset: null,
    renderStatus: 'failed',
    exportDiagnostics,
    fallbackUsed: exportDiagnostics.some(diag => diag.fallbackTriggered),
  };
}

function successDiagnostic(
  item: PreparedChartItem,
  chartId: string | null,
  stage: ChartRenderDiagnostic['stage'],
  exportFormat: ChartAssetType | null,
  endpoint: string,
): ChartRenderDiagnostic {
  return {
    chartId,
    chartTitle: item.title,
    stage,
    exportFormat,
    endpoint,
    httpStatus: 200,
    ok: true,
    message: `${stage} succeeded.`,
    fallbackTriggered: false,
    finalAssetType: null,
    finalRenderResult: 'pending',
  };
}

function stageDiagnostic(
  item: PreparedChartItem,
  chartId: string | null,
  stage: ChartRenderDiagnostic['stage'],
  exportFormat: ChartAssetType | null,
  endpoint: string,
  error: unknown,
  fallbackTriggered: boolean,
): ChartRenderDiagnostic {
  if (error instanceof DatawrapperApiError) {
    return {
      chartId,
      chartTitle: item.title,
      stage,
      exportFormat,
      endpoint: error.endpoint,
      httpStatus: error.status,
      ok: false,
      message: error.body || error.message,
      fallbackTriggered,
      finalAssetType: null,
      finalRenderResult: 'failed',
    };
  }

  return {
    chartId,
    chartTitle: item.title,
    stage,
    exportFormat,
    endpoint,
    httpStatus: null,
    ok: false,
    message: error instanceof Error ? error.message : 'Unknown Datawrapper error.',
    fallbackTriggered,
    finalAssetType: null,
    finalRenderResult: 'failed',
  };
}

async function createChart(
  apiKey: string,
  item: PreparedChartItem,
  folderId: string | null,
): Promise<DatawrapperChart> {
  const body: Record<string, unknown> = {
    title: item.title,
    type: item.visualization,
  };
  if (folderId) body['folderId'] = folderId;
  return requestJson<DatawrapperChart>(apiKey, '/charts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function uploadChartData(apiKey: string, chartId: string, csv: string): Promise<void> {
  await requestText(apiKey, `/charts/${chartId}/data`, {
    method: 'PUT',
    body: csv,
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  });
}

async function updateChartMetadata(apiKey: string, chartId: string, item: PreparedChartItem): Promise<void> {
  const decimals = Math.max(0, Math.min(2, item.format?.decimals ?? 0));
  const numberFormat = decimals === 0 ? ',.0f' : `,.${decimals}f`;
  const baseMetadata = {
    describe: {
      'source-name': 'SEC EDGAR Filings',
      'source-url': '',
      intro: '',
      byline: 'Dolph Research',
      'number-format': numberFormat,
      'number-append': item.format?.append || '',
      'number-prepend': item.format?.prepend || '',
    },
    annotate: {
      notes: '',
    },
  };
  const metadata = mergeMetadata(baseMetadata, item.metadataPatch || {});
  await requestJson(apiKey, `/charts/${chartId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      metadata,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function publishChart(apiKey: string, chartId: string): Promise<void> {
  await requestJson(apiKey, `/charts/${chartId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

async function exportChartSvg(apiKey: string, endpoint: string): Promise<RenderedChartAsset> {
  const svg = await requestText(apiKey, endpoint, {
    method: 'GET',
  });
  return {
    assetType: 'svg',
    mimeType: 'image/svg+xml',
    content: typeof svg === 'string' ? svg : '',
  };
}

async function exportChartPng(apiKey: string, endpoint: string): Promise<RenderedChartAsset> {
  const bytes = await requestBytes(apiKey, endpoint, {
    method: 'GET',
  });
  const base64 = Buffer.from(bytes).toString('base64');
  return {
    assetType: 'png',
    mimeType: 'image/png',
    content: `data:image/png;base64,${base64}`,
  };
}

async function ensureFolder(apiKey: string, name: string): Promise<string | null> {
  const response = await requestJson<{ id?: string }>(apiKey, '/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  return response.id || null;
}

function buildFolderName(report: Report): string {
  const date = report.generated_at.slice(0, 10);
  const scope = report.type === 'comparison' ? 'comparisons' : 'standalone';
  return `Dolph/${scope}/${date}/${report.tickers.join('-')}`;
}

function buildExportPath(chartId: string, item: PreparedChartItem, format: ChartAssetType): string {
  const params = new URLSearchParams();
  if (item.plainExport) params.set('plain', 'true');
  params.set('unit', 'px');
  params.set('width', String(item.exportWidth));
  params.set('height', String(item.exportHeight));
  const query = params.toString();
  return `/charts/${chartId}/export/${format}${query ? `?${query}` : ''}`;
}

function mergeMetadata(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = mergeMetadata(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function requestJson<T = any>(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${DATAWRAPPER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new DatawrapperApiError(path, response.status, body);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

async function requestText(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<string> {
  const response = await fetch(`${DATAWRAPPER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new DatawrapperApiError(path, response.status, body);
  }
  return response.text();
}

async function requestBytes(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<Uint8Array> {
  const response = await fetch(`${DATAWRAPPER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new DatawrapperApiError(path, response.status, body);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
