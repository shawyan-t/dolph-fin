import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AuditArtifactManifest,
  Report,
} from '@shawyan/shared';
import type { AnalysisContext } from '@shawyan/shared';
import type { AnalysisInsights } from './analyzer.js';
import type { DeterministicQAResult } from './deterministic-qa.js';
import type { ReportModel } from './report-model.js';
import type { ChartSet } from './charts.js';
import { serializePreparedChartDataset } from './charts.js';

interface AuditArtifactInput {
  report: Report;
  context: AnalysisContext;
  insights: Record<string, AnalysisInsights>;
  reportModel: ReportModel;
  charts?: ChartSet | null;
  qa: DeterministicQAResult;
  outputDir: string;
  pdfPath?: string | null;
}

export async function writeAuditArtifacts(input: AuditArtifactInput): Promise<AuditArtifactManifest> {
  const timestamp = new Date(input.report.generated_at)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const slug = input.report.tickers.join('-');
  const artifactDir = resolve(input.outputDir, `${slug}-${timestamp}-audit`);
  await mkdir(artifactDir, { recursive: true });

  const files: Record<string, string> = {};

  // 1. QA result
  await writeJson(
    artifactDir,
    'qa-result.json',
    {
      status: input.qa.pass ? 'pass' : 'fail',
      pass: input.qa.pass,
      failures: input.qa.failures,
      mappingFixes: input.qa.mappingFixes,
      recomputedMetrics: input.qa.recomputedMetrics,
      periodBasis: input.qa.periodBasis,
    },
    files,
  );

  // 2. Source manifest
  await writeJson(
    artifactDir,
    'source-manifest.json',
    {
      sources: input.report.sources,
      provenance: input.report.provenance || {},
      filings: Object.fromEntries(
        input.reportModel.companies.map(company => [company.ticker, company.filingReferences]),
      ),
    },
    files,
  );

  // 3. Canonical ledger
  await writeJson(
    artifactDir,
    'canonical-ledger.json',
    Object.fromEntries(
      input.reportModel.companies.map(company => [
        company.ticker,
        Object.fromEntries(
          Array.from(company.canonicalPeriodMap.entries()).map(([period, values]) => [period, values]),
        ),
      ]),
    ),
    files,
  );

  // 4. Sealed report model
  await writeJson(
    artifactDir,
    'report-model.json',
    input.reportModel,
    files,
  );

  // 5. Rendered sections
  await writeJson(
    artifactDir,
    'sections.json',
    input.report.sections,
    files,
  );

  // 6. Structured narrative payload
  await writeJson(
    artifactDir,
    'narrative.json',
    input.report.narrative || null,
    files,
  );

  // 7. Chart rendering diagnostics
  if (input.charts) {
    const datasetDir = resolve(artifactDir, 'chart-datasets');
    await mkdir(datasetDir, { recursive: true });
    for (const item of input.charts.items) {
      const datasetFile = `${sanitizeFileName(item.key)}.csv`;
      const datasetPath = resolve(datasetDir, datasetFile);
      await writeFile(datasetPath, serializePreparedChartDataset(item.dataset), 'utf8');
      files[`chart-datasets/${datasetFile}`] = datasetPath;
    }
    await writeJson(
      artifactDir,
      'chart-rendering.json',
      input.charts.items.map(item => ({
        key: item.key,
        title: item.title,
        datasetShape: item.dataset.shape,
        datasetHeaders: item.dataset.headers,
        datasetPreviewRows: item.dataset.rows.slice(0, 5),
        renderStatus: item.renderStatus,
        assetType: item.asset?.assetType || null,
        mimeType: item.asset?.mimeType || null,
        fallbackUsed: item.fallbackUsed,
        datawrapperChartId: item.datawrapperChartId,
        exportDiagnostics: item.exportDiagnostics,
      })),
      files,
    );
  }

  return {
    directory: artifactDir,
    generated_at: input.report.generated_at,
    files,
  };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]/gi, '_');
}

async function writeJson(
  dir: string,
  name: string,
  data: unknown,
  files: Record<string, string>,
): Promise<void> {
  const path = resolve(dir, name);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  files[name] = path;
}
