/**
 * Agent-specific types that extend shared types.
 */

import type { AnalysisContext, Report, ReportingPolicy, SSEEvent } from '@shawyan/shared';
import type { CanonicalReportPackage } from './canonical-report-package.js';

export interface PipelineConfig {
  tickers: string[];
  type: 'single' | 'comparison';
  maxRetries: number;
  maxValidationLoops: number;
  tone?: string;
  /** Narrative generation mode: LLM prose or deterministic code-generated prose */
  narrativeMode?: 'llm' | 'deterministic';
  outputFormat?: 'terminal' | 'pdf' | 'both';
  /**
   * Snapshot mode: pin the report to an as-of date (YYYY-MM-DD).
   * When set, the report uses deterministic IDs and temperature=0,
   * enabling reproducible outputs for the same tickers + date.
   */
  snapshotDate?: string;
  /** Optional abort signal for cancellation (web disconnect, user cancel, etc.) */
  abortSignal?: AbortSignal;
  /** Explicit reporting-governance policy overrides. */
  policy?: Partial<ReportingPolicy>;
  /** Optional audit artifact directory; defaults to report output directory when PDF export runs. */
  auditOutputDir?: string;
}

export interface PipelineCallbacks {
  onStep?: (step: string, status: 'running' | 'complete' | 'error', detail?: string) => void;
  onPartialReport?: (sectionId: string, content: string) => void;
  onComplete?: (report: Report, context?: AnalysisContext, canonicalPackage?: CanonicalReportPackage) => void | Promise<void>;
  onError?: (error: string) => void;
}

export interface PipelineResult {
  report: Report;
  context: AnalysisContext;
  canonicalPackage?: CanonicalReportPackage;
  llmCallsCount: number;
  totalDurationMs: number;
}
