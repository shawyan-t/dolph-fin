#!/usr/bin/env node

/**
 * FilingLens Agent — CLI entry point.
 *
 * Usage:
 *   pnpm --filter agent start AAPL
 *   pnpm --filter agent start AAPL MSFT --compare
 */

import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load .env from project root (2 levels up from packages/agent/)
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
import { runPipeline } from './pipeline.js';
import { createLLMProvider, getLLMConfig } from './llm/provider.js';
import type { PipelineConfig, PipelineCallbacks } from './types.js';
import type { Report } from '@filinglens/shared';

// ── Parse CLI args ────────────────────────────────────────────

const args = process.argv.slice(2);
const isCompare = args.includes('--compare') || args.includes('-c');
const tickers = args.filter(a => !a.startsWith('-')).map(t => t.toUpperCase());

if (tickers.length === 0) {
  console.log(`
  FilingLens — AI-powered SEC filing analyzer

  Usage:
    filinglens AAPL                    Analyze a single company
    filinglens AAPL MSFT --compare     Compare multiple companies

  Environment:
    FILINGLENS_LLM_PROVIDER            openai | gemini | groq (default: openai)
    FILINGLENS_OPENAI_API_KEY          Your API key
    FILINGLENS_SEC_USER_AGENT          Required for SEC EDGAR access
  `);
  process.exit(0);
}

const type = isCompare || tickers.length > 1 ? 'comparison' : 'single';

// ── Setup ─────────────────────────────────────────────────────

const maxRetries = parseInt(process.env['FILINGLENS_MAX_RETRIES'] || '2', 10);
const maxValidationLoops = parseInt(process.env['FILINGLENS_MAX_VALIDATION_LOOPS'] || '2', 10);

const config: PipelineConfig = {
  tickers,
  type: type as 'single' | 'comparison',
  maxRetries,
  maxValidationLoops,
};

// ── Progress output ───────────────────────────────────────────

const ICONS = {
  running: '\x1B[33m⟳\x1B[0m',
  complete: '\x1B[32m✓\x1B[0m',
  error: '\x1B[31m✗\x1B[0m',
};

const callbacks: PipelineCallbacks = {
  onStep(step, status, detail) {
    const icon = ICONS[status];
    const detailStr = detail ? ` \x1B[90m(${detail})\x1B[0m` : '';
    console.log(`  ${icon} ${step}${detailStr}`);
  },
  onPartialReport(sectionId, _content) {
    console.log(`  \x1B[36m📄\x1B[0m Generated: ${sectionId}`);
  },
  onComplete(report: Report) {
    console.log('');
    console.log('\x1B[32m═══════════════════════════════════════\x1B[0m');
    console.log(`\x1B[1mAnalysis complete for ${report.tickers.join(', ')}\x1B[0m`);
    console.log(`  LLM calls: ${report.metadata.llm_calls}`);
    console.log(`  Duration: ${(report.metadata.total_duration_ms / 1000).toFixed(1)}s`);
    console.log(`  Data points: ${report.metadata.data_points_used}`);
    console.log(`  Validation: ${report.validation.pass ? '✓ PASSED' : '⚠ ISSUES'}`);
    console.log('\x1B[32m═══════════════════════════════════════\x1B[0m');
    console.log('');

    // Output the full report
    for (const section of report.sections) {
      console.log(`## ${section.title}`);
      console.log('');
      console.log(section.content);
      console.log('');
    }
  },
  onError(error: string) {
    console.error(`\x1B[31mError: ${error}\x1B[0m`);
  },
};

// ── Run ───────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(`\x1B[1mFilingLens\x1B[0m — Analyzing ${tickers.join(', ')} (${type})`);
  console.log('');

  try {
    const llmConfig = getLLMConfig();
    const llm = createLLMProvider(llmConfig);
    console.log(`  \x1B[90mProvider: ${llmConfig.provider} (${llmConfig.model})\x1B[0m`);
    console.log('');

    await runPipeline(config, llm, callbacks);
  } catch (err) {
    console.error('');
    console.error(`\x1B[31mFatal error: ${err instanceof Error ? err.message : err}\x1B[0m`);
    process.exit(1);
  }
}

main();
