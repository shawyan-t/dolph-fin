/**
 * Dolph Agent — Programmatic entry point.
 *
 * Use this for non-interactive usage (API routes, imports).
 * For the interactive CLI with menu, use cli.ts instead.
 *
 * Usage:
 *   import { runAnalysis } from '@dolph/agent';
 */

export { runPipeline } from './pipeline.js';
export { createLLMProvider, getLLMConfig } from './llm/provider.js';
export { generatePDF } from './exporter.js';
export { generateCharts } from './charts.js';
export { buildFinancialStatementsSection } from './statements-builder.js';
export { buildKeyMetricsSection } from './metrics-builder.js';
export { buildDCFAssumptions, runDCFModel, generateDCFPackage } from './dcf-builder.js';
export type { PipelineConfig, PipelineCallbacks, PipelineResult } from './types.js';
export type { DCFAssumptions, DCFOutput } from './dcf-builder.js';
