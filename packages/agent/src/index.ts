/**
 * FilingLens Agent — Programmatic entry point.
 *
 * Use this for non-interactive usage (API routes, imports).
 * For the interactive CLI with menu, use cli.ts instead.
 *
 * Usage:
 *   import { runAnalysis } from '@filinglens/agent';
 */

export { runPipeline } from './pipeline.js';
export { createLLMProvider, getLLMConfig } from './llm/provider.js';
export { generatePDF } from './exporter.js';
export type { PipelineConfig, PipelineCallbacks, PipelineResult } from './types.js';
