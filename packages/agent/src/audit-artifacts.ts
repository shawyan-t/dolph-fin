import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type {
  AuditArtifactManifest,
  Report,
  StructuredNarrativePayload,
} from '@dolph/shared';
import type { AnalysisContext } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import type { DeterministicQAResult } from './deterministic-qa.js';
import type { ReportModel } from './report-model.js';

interface AuditArtifactInput {
  report: Report;
  context: AnalysisContext;
  insights: Record<string, AnalysisInsights>;
  reportModel: ReportModel;
  qa: DeterministicQAResult;
  outputDir: string;
  pdfPath?: string | null;
  layoutIssues: Array<{ gate: string; message: string }>;
  narrativePayload?: StructuredNarrativePayload;
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
  const narrative = input.narrativePayload || input.report.narrative;
  if (!narrative) {
    throw new Error('Successful audit artifacts require a structured narrative payload with fact bindings.');
  }

  await writeJson(
    artifactDir,
    'policy-manifest.json',
    {
      policy: input.report.policy || input.context.policy || null,
      report_id: input.report.id,
      tickers: input.report.tickers,
      generated_at: input.report.generated_at,
    },
    files,
  );
  await writeJson(
    artifactDir,
    'period-basis-manifest.json',
    Object.fromEntries(
      input.reportModel.companies.map(company => [
        company.ticker,
        {
          current: company.snapshotPeriod,
          prior: company.priorPeriod,
          note: company.periodNote,
          comparison_basis_mode: company.policy.comparisonBasisMode,
        },
      ]),
    ),
    files,
  );
  await writeJson(
    artifactDir,
    'report-model.json',
    serializeReportModel(input.reportModel),
    files,
  );
  await writeJson(
    artifactDir,
    'canonical-ledger.json',
    serializeLedger(input.reportModel),
    files,
  );
  await writeJson(
    artifactDir,
    'metric-availability.json',
    serializeMetricAvailability(input.reportModel),
    files,
  );
  await writeJson(
    artifactDir,
    'derived-metrics-manifest.json',
    serializeDerivedMetrics(input.reportModel),
    files,
  );
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
  await writeJson(
    artifactDir,
    'comparison-basis-manifest.json',
    {
      report_type: input.report.type,
      requested_basis_mode: input.report.comparison_basis?.requested_mode
        || input.report.policy?.requestedComparisonBasisMode
        || input.context.policy?.requestedComparisonBasisMode
        || null,
      effective_basis_mode: input.report.comparison_basis?.effective_mode
        || input.report.policy?.comparisonBasisMode
        || input.context.policy?.comparisonBasisMode
        || null,
      resolution: input.report.comparison_basis || input.context.comparison_basis || null,
      companies: input.reportModel.companies.map(company => ({
        ticker: company.ticker,
        snapshot_period: company.snapshotPeriod,
        prior_period: company.priorPeriod,
        note: company.periodNote,
      })),
    },
    files,
  );
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
  await writeJson(
    artifactDir,
    'narrative-payload.json',
    narrative,
    files,
  );
  await writeJson(
    artifactDir,
    'narrative-validation.json',
    {
      pass: input.qa.failures.filter(failure => failure.gate.startsWith('narrative.')).length === 0,
      failures: input.qa.failures.filter(failure => failure.gate.startsWith('narrative.')),
    },
    files,
  );
  await writeJson(
    artifactDir,
    'warnings-manifest.json',
    {
      warnings: input.report.validation.issues.filter(issue => issue.severity === 'warning'),
      mappingFixes: input.qa.mappingFixes,
    },
    files,
  );
  await writeJson(
    artifactDir,
    'layout-qa-report.json',
    {
      status: input.pdfPath ? 'completed' : 'not_run',
      strict: input.report.policy?.strictLayoutQA ?? input.context.policy?.strictLayoutQA ?? false,
      issues: input.pdfPath ? input.layoutIssues : null,
    },
    files,
  );
  await writeJson(
    artifactDir,
    'render-manifest.json',
    {
      pdf: input.pdfPath ? basename(input.pdfPath) : null,
      absolute_pdf_path: input.pdfPath || null,
      pdf_rendered: !!input.pdfPath,
      generated_at: new Date().toISOString(),
    },
    files,
  );
  await writeJson(
    artifactDir,
    'report-metadata.json',
    {
      id: input.report.id,
      type: input.report.type,
      tickers: input.report.tickers,
      generated_at: input.report.generated_at,
      metadata: input.report.metadata,
    },
    files,
  );

  validateAuditFiles(files);

  return {
    directory: artifactDir,
    generated_at: new Date().toISOString(),
    files,
  };
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

function serializeReportModel(model: ReportModel) {
  return {
    type: model.type,
    comparisonBasis: model.comparisonBasis,
    companies: model.companies.map(company => ({
      ticker: company.ticker,
      companyName: company.companyName,
      snapshotPeriod: company.snapshotPeriod,
      priorPeriod: company.priorPeriod,
      periodNote: company.periodNote,
      snapshotLabel: company.snapshotLabel,
      priorLabel: company.priorLabel,
      filingReferences: company.filingReferences,
      alignedFiling: company.alignedFiling,
      dashboardGroups: company.dashboardGroups,
      comparisonGroups: company.comparisonGroups,
      statementTables: company.statementTables,
    })),
  };
}

function serializeLedger(model: ReportModel) {
  return Object.fromEntries(
    model.companies.map(company => [
      company.ticker,
      Object.fromEntries(
        Array.from(company.canonicalPeriodMap.entries()).map(([period, values]) => [period, values]),
      ),
    ]),
  );
}

function serializeMetricAvailability(model: ReportModel) {
  return Object.fromEntries(
    model.companies.map(company => [
      company.ticker,
      company.metrics.map(metric => ({
        key: metric.key,
        label: metric.label,
        current: metric.currentDisplay,
        prior: metric.priorDisplay,
        change: metric.changeDisplay,
        availability: metric.availability,
        basis: metric.basis || null,
        note: metric.note || null,
      })),
    ]),
  );
}

function serializeDerivedMetrics(model: ReportModel) {
  return Object.fromEntries(
    model.companies.map(company => [
      company.ticker,
      company.metrics
        .filter(metric => metric.availability.current === 'derived' || metric.availability.prior === 'derived')
        .map(metric => ({
          key: metric.key,
          label: metric.label,
          current: metric.currentDisplay,
          prior: metric.priorDisplay,
          basis: metric.basis || null,
          note: metric.note || null,
        })),
    ]),
  );
}

function validateAuditFiles(files: Record<string, string>): void {
  const required = [
    'policy-manifest.json',
    'period-basis-manifest.json',
    'report-model.json',
    'canonical-ledger.json',
    'metric-availability.json',
    'derived-metrics-manifest.json',
    'source-manifest.json',
    'comparison-basis-manifest.json',
    'qa-result.json',
    'narrative-payload.json',
    'narrative-validation.json',
    'warnings-manifest.json',
    'layout-qa-report.json',
    'render-manifest.json',
    'report-metadata.json',
  ];
  const missing = required.filter(name => !files[name]);
  if (missing.length > 0) {
    throw new Error(`Audit artifact package is incomplete. Missing: ${missing.join(', ')}`);
  }
}
