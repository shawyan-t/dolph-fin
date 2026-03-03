/**
 * Agent-specific types that extend shared types.
 */

import type { AnalysisContext, Report, SSEEvent } from '@filinglens/shared';

export interface PipelineConfig {
  tickers: string[];
  type: 'single' | 'comparison';
  maxRetries: number;
  maxValidationLoops: number;
  tone?: string;
  outputFormat?: 'terminal' | 'pdf' | 'both';
}

export interface PipelineCallbacks {
  onStep?: (step: string, status: 'running' | 'complete' | 'error', detail?: string) => void;
  onPartialReport?: (sectionId: string, content: string) => void;
  onComplete?: (report: Report) => void | Promise<void>;
  onError?: (error: string) => void;
}

export interface PipelineResult {
  report: Report;
  context: AnalysisContext;
  llmCallsCount: number;
  totalDurationMs: number;
}
