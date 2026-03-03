#!/usr/bin/env node

/**
 * FilingLens — Unified CLI entry point.
 *
 * Flow: Bootup animation → Interactive menu → Execute → Loop
 */

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// Load .env from project root (2 levels up from packages/agent/)
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });

import { select, input } from '@inquirer/prompts';
import { runBootup } from '@filinglens/bootup';
import { runPipeline } from './pipeline.js';
import { createLLMProvider, getLLMConfig } from './llm/provider.js';
import { generatePDF } from './exporter.js';
import { searchFilings } from '@filinglens/mcp-sec-server/tools/search-filings.js';
import type { PipelineConfig, PipelineCallbacks } from './types.js';
import type { Report } from '@filinglens/shared';

// ── ANSI helpers ──────────────────────────────────────────────

const BOLD = '\x1B[1m';
const DIM = '\x1B[90m';
const RESET = '\x1B[0m';
const GREEN = '\x1B[32m';
const RED = '\x1B[31m';
const CYAN = '\x1B[36m';
const YELLOW = '\x1B[33m';
const BLUE = '\x1B[34m';

const ICONS = {
  running: `${YELLOW}⟳${RESET}`,
  complete: `${GREEN}✓${RESET}`,
  error: `${RED}✗${RESET}`,
};

// ── Menu header ──────────────────────────────────────────────

function printMenuHeader(): void {
  console.log('');
  console.log(`${BLUE}┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${BLUE}│${RESET}  ${BOLD}FilingLens${RESET} v0.1.0                       ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}  ${DIM}AI-powered SEC filing analysis${RESET}           ${BLUE}│${RESET}`);
  console.log(`${BLUE}├─────────────────────────────────────────┤${RESET}`);
  console.log(`${BLUE}│${RESET}                                         ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   1. Analyze a Company                  ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   2. Compare Companies                  ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   3. Search SEC Filings                 ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   4. Settings                           ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   5. Exit                               ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}                                         ${BLUE}│${RESET}`);
  console.log(`${BLUE}└─────────────────────────────────────────┘${RESET}`);
  console.log('');
}

// ── Build pipeline callbacks ────────────────────────────────

function buildCallbacks(outputFormat: 'terminal' | 'pdf' | 'both'): PipelineCallbacks {
  return {
    onStep(step, status, detail) {
      const icon = ICONS[status];
      const detailStr = detail ? ` ${DIM}(${detail})${RESET}` : '';
      console.log(`  ${icon} ${step}${detailStr}`);
    },
    onPartialReport(sectionId) {
      console.log(`  ${CYAN}📄${RESET} Generated: ${sectionId}`);
    },
    async onComplete(report: Report) {
      // Terminal output
      if (outputFormat === 'terminal' || outputFormat === 'both') {
        printReportToTerminal(report);
      }

      // PDF output
      if (outputFormat === 'pdf' || outputFormat === 'both') {
        console.log('');
        console.log(`  ${YELLOW}⟳${RESET} Generating PDF...`);
        try {
          const pdfPath = await generatePDF(report);
          console.log(`  ${GREEN}✓${RESET} PDF saved: ${BOLD}${pdfPath}${RESET}`);
        } catch (err) {
          console.error(`  ${RED}✗${RESET} PDF generation failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    },
    onError(error: string) {
      console.error(`${RED}Error: ${error}${RESET}`);
    },
  };
}

function printReportToTerminal(report: Report): void {
  console.log('');
  console.log(`${GREEN}═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}Analysis complete for ${report.tickers.join(', ')}${RESET}`);
  console.log(`  LLM calls: ${report.metadata.llm_calls}`);
  console.log(`  Duration: ${(report.metadata.total_duration_ms / 1000).toFixed(1)}s`);
  console.log(`  Data points: ${report.metadata.data_points_used}`);
  console.log(`  Validation: ${report.validation.pass ? '✓ PASSED' : '⚠ ISSUES'}`);
  console.log(`${GREEN}═══════════════════════════════════════${RESET}`);
  console.log('');

  for (const section of report.sections) {
    console.log(`## ${section.title}`);
    console.log('');
    console.log(section.content);
    console.log('');
  }
}

// ── Menu actions ─────────────────────────────────────────────

async function promptOutputFormat(): Promise<'terminal' | 'pdf' | 'both'> {
  return select({
    message: 'Output format:',
    choices: [
      { name: 'Terminal', value: 'terminal' as const },
      { name: 'PDF', value: 'pdf' as const },
      { name: 'Both', value: 'both' as const },
    ],
  });
}

async function handleAnalyze(): Promise<void> {
  const ticker = await input({
    message: 'Enter ticker symbol:',
    validate: (v) => (/^[A-Za-z]{1,5}$/.test(v.trim()) ? true : 'Enter a valid ticker (1-5 letters)'),
  });

  const outputFormat = await promptOutputFormat();

  const config: PipelineConfig = {
    tickers: [ticker.trim().toUpperCase()],
    type: 'single',
    maxRetries: parseInt(process.env['FILINGLENS_MAX_RETRIES'] || '2', 10),
    maxValidationLoops: parseInt(process.env['FILINGLENS_MAX_VALIDATION_LOOPS'] || '2', 10),
    outputFormat,
  };

  console.log('');
  console.log(`${BOLD}Analyzing ${config.tickers[0]}...${RESET}`);
  console.log('');

  const llmConfig = getLLMConfig();
  const llm = createLLMProvider(llmConfig);
  console.log(`  ${DIM}Provider: ${llmConfig.provider} (${llmConfig.model})${RESET}`);
  console.log('');

  await runPipeline(config, llm, buildCallbacks(outputFormat));
}

async function handleCompare(): Promise<void> {
  const tickerInput = await input({
    message: 'Enter tickers (comma-separated, 2-5):',
    validate: (v) => {
      const tickers = v.split(',').map(t => t.trim()).filter(Boolean);
      if (tickers.length < 2) return 'Enter at least 2 tickers';
      if (tickers.length > 5) return 'Maximum 5 tickers';
      if (!tickers.every(t => /^[A-Za-z]{1,5}$/.test(t))) return 'Invalid ticker format';
      return true;
    },
  });

  const tickers = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const outputFormat = await promptOutputFormat();

  const config: PipelineConfig = {
    tickers,
    type: 'comparison',
    maxRetries: parseInt(process.env['FILINGLENS_MAX_RETRIES'] || '2', 10),
    maxValidationLoops: parseInt(process.env['FILINGLENS_MAX_VALIDATION_LOOPS'] || '2', 10),
    outputFormat,
  };

  console.log('');
  console.log(`${BOLD}Comparing ${tickers.join(' vs ')}...${RESET}`);
  console.log('');

  const llmConfig = getLLMConfig();
  const llm = createLLMProvider(llmConfig);
  console.log(`  ${DIM}Provider: ${llmConfig.provider} (${llmConfig.model})${RESET}`);
  console.log('');

  await runPipeline(config, llm, buildCallbacks(outputFormat));
}

async function handleSearch(): Promise<void> {
  const query = await input({
    message: 'Search query:',
    validate: (v) => (v.trim().length > 0 ? true : 'Enter a search term'),
  });

  const ticker = await input({
    message: 'Filter by ticker (optional, press Enter to skip):',
  });

  const dateRange = await select({
    message: 'Date range:',
    choices: [
      { name: 'Last year', value: 'last_year' },
      { name: 'Last 3 years', value: 'last_3_years' },
      { name: 'All time', value: 'all_time' },
    ],
  });

  const now = new Date();
  let dateFrom: string;
  switch (dateRange) {
    case 'last_year':
      dateFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
        .toISOString().split('T')[0]!;
      break;
    case 'last_3_years':
      dateFrom = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
        .toISOString().split('T')[0]!;
      break;
    default:
      dateFrom = '2000-01-01';
  }

  console.log('');
  console.log(`  ${YELLOW}⟳${RESET} Searching SEC filings...`);

  try {
    const results = await searchFilings({
      query: query.trim(),
      ticker: ticker.trim() || undefined,
      date_from: dateFrom,
      date_to: now.toISOString().split('T')[0]!,
      limit: 15,
    });

    if (results.length === 0) {
      console.log(`  ${DIM}No results found.${RESET}`);
      return;
    }

    console.log(`  ${GREEN}✓${RESET} Found ${results.length} results`);
    console.log('');

    // Format as table
    console.log(`  ${'Company'.padEnd(25)} ${'Type'.padEnd(8)} ${'Date'.padEnd(12)} Snippet`);
    console.log(`  ${'─'.repeat(25)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(40)}`);

    for (const r of results) {
      const company = (r.company_name || 'Unknown').slice(0, 24).padEnd(25);
      const type = r.filing_type.padEnd(8);
      const date = r.date_filed.padEnd(12);
      const snippet = (r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 50);
      console.log(`  ${company} ${type} ${date} ${DIM}${snippet}${RESET}`);
    }
  } catch (err) {
    console.error(`  ${RED}✗${RESET} Search failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
}

async function handleSettings(): Promise<void> {
  const envPath = resolve(import.meta.dirname, '../../../.env');
  let envContent = '';
  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    envContent = '';
  }

  // Parse current values
  const getValue = (key: string): string => {
    const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1]!.replace(/^['"]|['"]$/g, '') : '';
  };

  const provider = getValue('FILINGLENS_LLM_PROVIDER') || 'openai';
  const model = getValue('FILINGLENS_LLM_MODEL') || 'gpt-4o-mini';
  const userAgent = getValue('FILINGLENS_SEC_USER_AGENT') || '';

  console.log('');
  console.log(`  ${BOLD}Current Settings${RESET}`);
  console.log(`  ${DIM}──────────────────────────────────${RESET}`);
  console.log(`  Provider:   ${CYAN}${provider}${RESET}`);
  console.log(`  Model:      ${CYAN}${model}${RESET}`);
  console.log(`  User-Agent: ${CYAN}${userAgent || '(not set)'}${RESET}`);
  console.log('');

  const action = await select({
    message: 'What would you like to change?',
    choices: [
      { name: 'LLM Provider', value: 'provider' },
      { name: 'Model', value: 'model' },
      { name: 'SEC User-Agent', value: 'user_agent' },
      { name: 'Back to menu', value: 'back' },
    ],
  });

  if (action === 'back') return;

  let key: string;
  let newValue: string;

  switch (action) {
    case 'provider': {
      key = 'FILINGLENS_LLM_PROVIDER';
      newValue = await select({
        message: 'Select provider:',
        choices: [
          { name: 'OpenAI (gpt-4o-mini, ~$0.003/analysis)', value: 'openai' },
          { name: 'Gemini (free tier)', value: 'gemini' },
          { name: 'Groq (free tier)', value: 'groq' },
        ],
      });
      break;
    }
    case 'model': {
      key = 'FILINGLENS_LLM_MODEL';
      newValue = await input({
        message: 'Enter model name:',
        default: model,
      });
      break;
    }
    case 'user_agent': {
      key = 'FILINGLENS_SEC_USER_AGENT';
      newValue = await input({
        message: 'Enter SEC User-Agent (e.g., "CompanyName email@example.com"):',
        default: userAgent,
      });
      break;
    }
    default:
      return;
  }

  // Update .env file
  const envLine = `${key}=${newValue}`;
  if (envContent.includes(`${key}=`)) {
    envContent = envContent.replace(new RegExp(`^${key}=.*$`, 'm'), envLine);
  } else {
    envContent += `\n${envLine}\n`;
  }

  await writeFile(envPath, envContent, 'utf-8');
  console.log(`  ${GREEN}✓${RESET} Updated ${key} → ${CYAN}${newValue}${RESET}`);

  // Reload env
  dotenv.config({ path: envPath, override: true });
  console.log(`  ${DIM}(Changes take effect immediately)${RESET}`);
  console.log('');
}

// ── Main loop ────────────────────────────────────────────────

async function main(): Promise<void> {
  // Play bootup animation
  try {
    await runBootup();
  } catch {
    // Animation failure is non-fatal — continue to menu
  }

  // Main menu loop
  let running = true;
  while (running) {
    printMenuHeader();

    const choice = await select({
      message: 'What would you like to do?',
      choices: [
        { name: '📊  Analyze a Company', value: 'analyze' },
        { name: '📈  Compare Companies', value: 'compare' },
        { name: '🔍  Search SEC Filings', value: 'search' },
        { name: '⚙️   Settings', value: 'settings' },
        { name: '👋  Exit', value: 'exit' },
      ],
    });

    try {
      switch (choice) {
        case 'analyze':
          await handleAnalyze();
          break;
        case 'compare':
          await handleCompare();
          break;
        case 'search':
          await handleSearch();
          break;
        case 'settings':
          await handleSettings();
          break;
        case 'exit':
          running = false;
          break;
      }
    } catch (err) {
      // Handle Ctrl+C during prompts gracefully
      if (err instanceof Error && err.message.includes('User force closed')) {
        running = false;
      } else {
        console.error(`${RED}Error: ${err instanceof Error ? err.message : err}${RESET}`);
      }
    }
  }

  console.log('');
  console.log(`${DIM}Goodbye!${RESET}`);
  console.log('');
}

main().catch((err) => {
  console.error(`${RED}Fatal error: ${err instanceof Error ? err.message : err}${RESET}`);
  process.exit(1);
});
