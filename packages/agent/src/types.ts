/**
 * Agent-specific types that extend shared types.
 */

import type { AnalysisContext, Report, SSEEvent } from '@dolph/shared';

export interface PipelineConfig {
  tickers: string[];
  type: 'single' | 'comparison';
  maxRetries: number;
  maxValidationLoops: number;
  tone?: string;
  outputFormat?: 'terminal' | 'pdf' | 'both';
  /**
   * Snapshot mode: pin the report to an as-of date (YYYY-MM-DD).
   * When set, the report uses deterministic IDs and temperature=0,
   * enabling reproducible outputs for the same tickers + date.
   */
  snapshotDate?: string;
}

export interface PipelineCallbacks {
  onStep?: (step: string, status: 'running' | 'complete' | 'error', detail?: string) => void;
  onPartialReport?: (sectionId: string, content: string) => void;
  onComplete?: (report: Report, context?: AnalysisContext) => void | Promise<void>;
  onError?: (error: string) => void;
}

export interface PipelineResult {
  report: Report;
  context: AnalysisContext;
  llmCallsCount: number;
  totalDurationMs: number;
}
