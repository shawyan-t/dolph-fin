#!/usr/bin/env node

/**
 * Dolph — Unified CLI entry point.
 *
 * Flow: Bootup animation → Interactive menu → Execute → Loop
 */

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Load .env from project root (2 levels up from packages/agent/)
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });

import { select, input } from '@inquirer/prompts';
import { runBootup } from '@dolph/bootup';
import { runPipeline } from './pipeline.js';
import { createLLMProvider, getLLMConfig } from './llm/provider.js';
import { generatePDF } from './exporter.js';
import { generateDCFPackage } from './dcf-builder.js';
import { searchFilings } from '@dolph/mcp-sec-server/tools/search-filings.js';
import { getFilingContent } from '@dolph/mcp-sec-server/tools/get-filing-content.js';
import { resolveTickerWithConfidence } from '@dolph/mcp-sec-server/edgar/cik-lookup.js';
import type { PipelineConfig, PipelineCallbacks } from './types.js';
import type { Report, AnalysisContext } from '@dolph/shared';

// ── ANSI helpers ──────────────────────────────────────────────

const BOLD = '\x1B[1m';
const DIM = '\x1B[90m';
const RESET = '\x1B[0m';
const GREEN = '\x1B[32m';
const RED = '\x1B[31m';
const CYAN = '\x1B[36m';
const YELLOW = '\x1B[33m';
const BLUE = '\x1B[94m';

let activeAbortController: AbortController | null = null;

function getNarrativeModeFromEnv(): 'llm' | 'deterministic' {
  const envMode = (process.env['DOLPH_NARRATIVE_MODE'] || '').trim().toLowerCase();
  if (envMode === 'deterministic' || envMode === 'llm') {
    return envMode;
  }
  // Auto mode: use LLM when credentials are present, deterministic otherwise.
  const hasOpenAI = !!(process.env['DOLPH_OPENAI_API_KEY'] || process.env['OPENAI_API_KEY']);
  const hasGemini = !!(process.env['DOLPH_GEMINI_API_KEY'] || process.env['GEMINI_API_KEY']);
  const hasGroq = !!(process.env['DOLPH_GROQ_API_KEY'] || process.env['GROQ_API_KEY']);
  return hasOpenAI || hasGemini || hasGroq ? 'llm' : 'deterministic';
}

/** Ensure terminal is in a clean state on exit */
function cleanupTerminal(): void {
  // Show cursor, reset all attributes, clear any alternate screen buffer
  process.stdout.write('\x1B[?25h\x1B[0m');
  // Ensure stdin is unref'd so Node can exit cleanly
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.unref();
}

/**
 * Resolve a ticker with confidence scoring and disambiguation.
 * High confidence (>= 0.9): auto-accept with confirmation message.
 * Lower confidence: interactive disambiguation prompt.
 * No match: throw with suggestion.
 */
async function resolveAndConfirm(rawTicker: string): Promise<string> {
  const result = await resolveTickerWithConfidence(rawTicker.trim());

  if (!result) {
    throw new Error(
      `Could not resolve "${rawTicker}" to any SEC entity. ` +
      'Try the official exchange ticker symbol.',
    );
  }

  // High confidence: auto-accept, print confirmation if ticker changed
  if (result.confidence >= 0.9) {
    if (result.ticker !== rawTicker.toUpperCase().trim()) {
      console.log(`  ${DIM}Resolved: ${rawTicker} → ${CYAN}${result.ticker}${RESET} ${DIM}(${result.name})${RESET}`);
    }
    return result.ticker;
  }

  // Medium confidence with alternatives: disambiguation prompt
  if (result.alternatives.length > 0) {
    const choices = [
      { name: `${result.ticker} — ${result.name} (${(result.confidence * 100).toFixed(0)}%)`, value: result.ticker },
      ...result.alternatives.map(alt => ({
        name: `${alt.ticker} — ${alt.name} (${(alt.confidence * 100).toFixed(0)}%)`,
        value: alt.ticker,
      })),
      { name: 'Cancel', value: '' },
    ];

    const chosen = await select({
      message: `"${rawTicker}" is ambiguous. Did you mean:`,
      choices,
    });

    if (!chosen) {
      throw new Error('Ticker resolution cancelled.');
    }
    return chosen;
  }

  // Medium confidence, no alternatives: ask for confirmation
  console.log(`  ${YELLOW}⚠${RESET} Best match: ${CYAN}${result.ticker}${RESET} (${result.name}) — ${(result.confidence * 100).toFixed(0)}% confidence`);
  const confirm = await select({
    message: `Use ${result.ticker}?`,
    choices: [
      { name: 'Yes', value: true as const },
      { name: 'No, cancel', value: false as const },
    ],
  });

  if (!confirm) {
    throw new Error('Ticker resolution cancelled.');
  }
  return result.ticker;
}

const ICONS = {
  running: `${YELLOW}⟳${RESET}`,
  complete: `${GREEN}✓${RESET}`,
  error: `${RED}✗${RESET}`,
};

// ── Menu header ──────────────────────────────────────────────

function printMenuHeader(): void {
  console.log('');
  console.log(`${BLUE}┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${BLUE}│${RESET}  ${BOLD}Dolph${RESET} v0.1.0                            ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}  ${DIM}AI-powered SEC filing analysis${RESET}           ${BLUE}│${RESET}`);
  console.log(`${BLUE}├─────────────────────────────────────────┤${RESET}`);
  console.log(`${BLUE}│${RESET}                                         ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   1. Analyze a Company                  ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   2. Compare Companies                  ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   3. Search SEC Filings                 ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   4. Resolve Ticker (/map)              ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   5. Generate DCF Model                 ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   6. Settings                           ${BLUE}│${RESET}`);
  console.log(`${BLUE}│${RESET}   7. Exit                               ${BLUE}│${RESET}`);
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
    async onComplete(report: Report, context?: AnalysisContext) {
      // Terminal output
      if (outputFormat === 'terminal' || outputFormat === 'both') {
        printReportToTerminal(report);
      }

      // PDF output
      if (outputFormat === 'pdf' || outputFormat === 'both') {
        console.log('');
        console.log(`  ${YELLOW}⟳${RESET} Generating PDF...`);
        try {
          const pdfPath = await generatePDF(report, undefined, context);
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
  const rawTicker = await input({
    message: 'Enter ticker symbol:',
    validate: (v) => (v.trim().length > 0 ? true : 'Enter a ticker (e.g., AAPL, BRK-B, TSM)'),
  });

  const resolvedTicker = await resolveAndConfirm(rawTicker);
  const outputFormat = await promptOutputFormat();

  const snapshotInput = await input({
    message: 'Pin to snapshot date? (YYYY-MM-DD, blank for live):',
    validate: (v) => {
      if (v.trim() === '') return true;
      return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? true : 'Enter a valid date (YYYY-MM-DD) or leave blank';
    },
  });
  const snapshotDate = snapshotInput.trim() || undefined;
  const narrativeMode = getNarrativeModeFromEnv();

  const config: PipelineConfig = {
    tickers: [resolvedTicker],
    type: 'single',
    maxRetries: parseInt(process.env['DOLPH_MAX_RETRIES'] || '2', 10),
    maxValidationLoops: parseInt(process.env['DOLPH_MAX_VALIDATION_LOOPS'] || '2', 10),
    narrativeMode,
    outputFormat,
    snapshotDate,
  };

  console.log('');
  console.log(`${BOLD}Analyzing ${config.tickers[0]}${snapshotDate ? ` (snapshot: ${snapshotDate})` : ''}...${RESET}`);
  console.log('');

  let llm: ReturnType<typeof createLLMProvider> | undefined;
  if (narrativeMode === 'llm') {
    const llmConfig = getLLMConfig();
    llm = createLLMProvider(llmConfig);
    console.log(`  ${DIM}Provider: ${llmConfig.provider} (${llmConfig.model})${RESET}`);
  } else {
    console.log(`  ${DIM}Narrative: deterministic mode (no LLM variability)${RESET}`);
  }
  console.log('');

  const controller = new AbortController();
  activeAbortController = controller;
  try {
    await runPipeline({ ...config, abortSignal: controller.signal }, llm, buildCallbacks(outputFormat));
  } finally {
    if (activeAbortController === controller) activeAbortController = null;
  }
}

async function handleCompare(): Promise<void> {
  const tickerInput = await input({
    message: 'Enter tickers (comma-separated, 2-5):',
    validate: (v) => {
      const tickers = v.split(',').map(t => t.trim()).filter(Boolean);
      if (tickers.length < 2) return 'Enter at least 2 tickers';
      if (tickers.length > 5) return 'Maximum 5 tickers';
      if (!tickers.every(t => /^[A-Za-z0-9][A-Za-z0-9.\-]{0,9}$/.test(t))) return 'Invalid ticker format';
      return true;
    },
  });

  const rawTickers = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const tickers: string[] = [];
  for (const raw of rawTickers) {
    tickers.push(await resolveAndConfirm(raw));
  }
  const outputFormat = await promptOutputFormat();

  const snapshotInput = await input({
    message: 'Pin to snapshot date? (YYYY-MM-DD, blank for live):',
    validate: (v) => {
      if (v.trim() === '') return true;
      return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? true : 'Enter a valid date (YYYY-MM-DD) or leave blank';
    },
  });
  const snapshotDate = snapshotInput.trim() || undefined;
  const narrativeMode = getNarrativeModeFromEnv();

  const config: PipelineConfig = {
    tickers,
    type: 'comparison',
    maxRetries: parseInt(process.env['DOLPH_MAX_RETRIES'] || '2', 10),
    maxValidationLoops: parseInt(process.env['DOLPH_MAX_VALIDATION_LOOPS'] || '2', 10),
    narrativeMode,
    outputFormat,
    snapshotDate,
  };

  console.log('');
  console.log(`${BOLD}Comparing ${tickers.join(' vs ')}${snapshotDate ? ` (snapshot: ${snapshotDate})` : ''}...${RESET}`);
  console.log('');

  let llm: ReturnType<typeof createLLMProvider> | undefined;
  if (narrativeMode === 'llm') {
    const llmConfig = getLLMConfig();
    llm = createLLMProvider(llmConfig);
    console.log(`  ${DIM}Provider: ${llmConfig.provider} (${llmConfig.model})${RESET}`);
  } else {
    console.log(`  ${DIM}Narrative: deterministic mode (no LLM variability)${RESET}`);
  }
  console.log('');

  const controller = new AbortController();
  activeAbortController = controller;
  try {
    await runPipeline({ ...config, abortSignal: controller.signal }, llm, buildCallbacks(outputFormat));
  } finally {
    if (activeAbortController === controller) activeAbortController = null;
  }
}

/** Open a URL in the default browser (cross-platform). */
function openInBrowser(url: string): void {
  const safeUrl = url.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(safeUrl)) return;

  if (process.platform === 'darwin') {
    spawn('open', [safeUrl], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'win32') {
    spawn('rundll32', ['url.dll,FileProtocolHandler', safeUrl], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  spawn('xdg-open', [safeUrl], { detached: true, stdio: 'ignore' }).unref();
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

    // Format as numbered table with URL indicator
    console.log(`  ${'#'.padStart(3)} ${'Company'.padEnd(25)} ${'Type'.padEnd(8)} ${'Date'.padEnd(12)} Snippet`);
    console.log(`  ${'─'.repeat(3)} ${'─'.repeat(25)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(40)}`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const num = String(i + 1).padStart(3);
      const urlDot = r.primary_document_url ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
      const company = (r.company_name || 'Unknown').slice(0, 24).padEnd(25);
      const type = r.filing_type.padEnd(8);
      const date = r.date_filed.padEnd(12);
      const snippet = (r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 50);
      console.log(`  ${num} ${urlDot} ${company} ${type} ${date} ${DIM}${snippet}${RESET}`);
    }

    console.log('');

    // Interactive filing browser loop
    let browsing = true;
    while (browsing) {
      const choices = results.map((r, i) => ({
        name: `${String(i + 1).padStart(2)}. ${r.company_name?.slice(0, 30) || 'Unknown'} — ${r.filing_type} (${r.date_filed})`,
        value: i,
      }));
      choices.push({ name: '← Back to menu', value: -1 });

      const selected = await select({
        message: 'Select a filing to view:',
        choices,
      });

      if (selected === -1) {
        browsing = false;
        break;
      }

      const filing = results[selected]!;

      // Show filing details
      console.log('');
      console.log(`  ${BOLD}${filing.company_name || 'Unknown'}${RESET}`);
      console.log(`  ${DIM}Type:${RESET}      ${filing.filing_type}`);
      console.log(`  ${DIM}Filed:${RESET}     ${filing.date_filed}`);
      console.log(`  ${DIM}Accession:${RESET} ${filing.accession_number}`);
      if (filing.primary_document_url) {
        console.log(`  ${DIM}URL:${RESET}       ${CYAN}${filing.primary_document_url}${RESET}`);
      }
      if (filing.snippet) {
        const cleanSnippet = filing.snippet.replace(/<[^>]+>/g, '');
        console.log(`  ${DIM}Snippet:${RESET}   ${cleanSnippet.slice(0, 200)}`);
      }
      console.log('');

      // Filing actions
      const actionChoices: Array<{ name: string; value: string }> = [];
      if (filing.primary_document_url) {
        actionChoices.push({ name: '🌐 Open in browser', value: 'open' });
        actionChoices.push({ name: '👁 Preview filing text', value: 'preview' });
        actionChoices.push({ name: '💾 Download filing text', value: 'download' });
      }
      actionChoices.push({ name: '← Back to results', value: 'back' });

      const action = await select({
        message: 'Action:',
        choices: actionChoices,
      });

      if (action === 'open' && filing.primary_document_url) {
        openInBrowser(filing.primary_document_url);
        console.log(`  ${GREEN}✓${RESET} Opened in browser`);
        console.log('');
      } else if ((action === 'preview' || action === 'download') && filing.primary_document_url) {
        try {
          const content = await getFilingContent({
            accession_number: filing.accession_number,
            document_url: filing.primary_document_url,
          });

          if (action === 'preview') {
            const previewSections = content.sections.slice(0, 3);
            console.log(`  ${GREEN}✓${RESET} Loaded filing text (${content.word_count.toLocaleString()} words)`);
            console.log('');
            if (previewSections.length > 0) {
              for (const section of previewSections) {
                const snippet = section.content.replace(/\s+/g, ' ').slice(0, 280);
                console.log(`  ${BOLD}${section.title}${RESET}`);
                console.log(`  ${DIM}${snippet}${snippet.length === 280 ? '…' : ''}${RESET}`);
                console.log('');
              }
            } else {
              const snippet = content.raw_text.replace(/\s+/g, ' ').slice(0, 500);
              console.log(`  ${DIM}${snippet}${snippet.length === 500 ? '…' : ''}${RESET}`);
              console.log('');
            }
          } else {
            const safeTicker = (filing.company_name || 'filing')
              .replace(/[^a-zA-Z0-9_-]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 40) || 'filing';
            const outDir = resolve(process.cwd(), 'reports', 'filings');
            await mkdir(outDir, { recursive: true });
            const path = resolve(outDir, `${safeTicker}-${filing.filing_type}-${filing.date_filed}-${filing.accession_number}.txt`);
            await writeFile(path, content.raw_text, 'utf-8');
            console.log(`  ${GREEN}✓${RESET} Saved: ${BOLD}${path}${RESET}`);
            console.log('');
          }
        } catch (err) {
          console.error(`  ${RED}✗${RESET} Could not retrieve filing content: ${err instanceof Error ? err.message : err}`);
          console.log('');
        }
      }
    }
  } catch (err) {
    // Handle Ctrl+C during filing browser gracefully
    if (err instanceof Error && err.message.includes('User force closed')) {
      return;
    }
    console.error(`  ${RED}✗${RESET} Search failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
}

async function handleMap(): Promise<void> {
  const ticker = await input({
    message: 'Enter ticker or company name to resolve:',
    validate: (v) => (v.trim().length > 0 ? true : 'Enter a ticker or name'),
  });

  console.log('');
  console.log(`  ${YELLOW}⟳${RESET} Resolving "${ticker.trim()}"...`);

  try {
    const result = await resolveTickerWithConfidence(ticker.trim());

    if (!result) {
      console.log(`  ${RED}✗${RESET} Could not resolve "${ticker.trim()}" to any SEC entity.`);
      console.log(`  ${DIM}Try the official exchange ticker symbol.${RESET}`);
      console.log('');
      return;
    }

    const confidencePct = (result.confidence * 100).toFixed(0);
    const confidenceColor = result.confidence >= 0.9 ? GREEN : result.confidence >= 0.7 ? YELLOW : RED;

    console.log(`  ${GREEN}✓${RESET} Resolved`);
    console.log('');
    console.log(`  ${BOLD}Ticker:${RESET}     ${CYAN}${result.ticker}${RESET}`);
    console.log(`  ${BOLD}Name:${RESET}       ${result.name}`);
    console.log(`  ${BOLD}CIK:${RESET}        ${result.cik}`);
    console.log(`  ${BOLD}Confidence:${RESET} ${confidenceColor}${confidencePct}%${RESET} (${result.method})`);

    if (result.alternatives.length > 0) {
      console.log('');
      console.log(`  ${BOLD}Alternatives:${RESET}`);
      for (const alt of result.alternatives) {
        const altPct = (alt.confidence * 100).toFixed(0);
        console.log(`    ${DIM}${alt.ticker.padEnd(8)} ${alt.name.slice(0, 35).padEnd(36)} CIK: ${alt.cik} (${altPct}%)${RESET}`);
      }
    }
  } catch (err) {
    console.error(`  ${RED}✗${RESET} Resolution failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
}

async function handleDCF(): Promise<void> {
  const rawTicker = await input({
    message: 'Enter ticker symbol for DCF model:',
    validate: (v) => (v.trim().length > 0 ? true : 'Enter a ticker'),
  });

  const tickerUpper = await resolveAndConfirm(rawTicker);

  console.log('');
  console.log(`${BOLD}Building DCF model for ${tickerUpper}...${RESET}`);
  console.log('');

  console.log(`  ${DIM}Narrative: deterministic mode (no LLM needed for DCF data prep)${RESET}`);
  console.log('');

  // Run pipeline to gather AnalysisContext (facts needed for DCF)
  const config: PipelineConfig = {
    tickers: [tickerUpper],
    type: 'single',
    maxRetries: parseInt(process.env['DOLPH_MAX_RETRIES'] || '2', 10),
    maxValidationLoops: 0, // Skip validation — we only need data for DCF
    narrativeMode: 'deterministic',
    outputFormat: 'terminal',
  };

  try {
    const controller = new AbortController();
    activeAbortController = controller;
    const { context } = await runPipeline({ ...config, abortSignal: controller.signal }, undefined, {
      onStep(step, status, detail) {
        const icon = ICONS[status];
        const detailStr = detail ? ` ${DIM}(${detail})${RESET}` : '';
        console.log(`  ${icon} ${step}${detailStr}`);
      },
    });
    if (activeAbortController === controller) activeAbortController = null;

    console.log('');
    console.log(`  ${YELLOW}⟳${RESET} Generating DCF package...`);

    const { xlsxPath, jsonPath, provenancePath } = await generateDCFPackage(context, tickerUpper);

    console.log(`  ${GREEN}✓${RESET} XLSX:        ${BOLD}${xlsxPath}${RESET}`);
    console.log(`  ${GREEN}✓${RESET} Assumptions: ${BOLD}${jsonPath}${RESET}`);
    console.log(`  ${GREEN}✓${RESET} Provenance:  ${BOLD}${provenancePath}${RESET}`);
  } catch (err) {
    activeAbortController = null;
    console.error(`  ${RED}✗${RESET} DCF failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
}

async function handleSettings(): Promise<void> {
  const envPath = resolve(import.meta.dirname, '../../../.env');
  const sanitizeEnvValue = (value: string): string => value.replace(/[\r\n=]/g, ' ').trim();

  while (true) {
    let envContent = '';
    try {
      envContent = await readFile(envPath, 'utf-8');
    } catch {
      envContent = '';
    }

    const getValue = (key: string): string => {
      const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
      return match ? match[1]!.replace(/^['"]|['"]$/g, '') : '';
    };

    const provider = getValue('DOLPH_LLM_PROVIDER') || 'openai';
    const model = getValue('DOLPH_LLM_MODEL') || 'gpt-4o-mini';
    const narrativeMode = getValue('DOLPH_NARRATIVE_MODE') || 'auto';
    const userAgent = getValue('DOLPH_SEC_USER_AGENT') || '';

    console.log('');
    console.log(`  ${BOLD}Current Settings${RESET}`);
    console.log(`  ${DIM}──────────────────────────────────${RESET}`);
    console.log(`  Provider:   ${CYAN}${provider}${RESET}`);
    console.log(`  Model:      ${CYAN}${model}${RESET}`);
    console.log(`  Narrative:  ${CYAN}${narrativeMode}${RESET}`);
    console.log(`  User-Agent: ${CYAN}${userAgent || '(not set)'}${RESET}`);
    console.log('');

    const action = await select({
      message: 'What would you like to change?',
      choices: [
        { name: 'LLM Provider', value: 'provider' },
        { name: 'Model', value: 'model' },
        { name: 'Narrative Mode', value: 'narrative_mode' },
        { name: 'SEC User-Agent', value: 'user_agent' },
        { name: 'Back to menu', value: 'back' },
      ],
    });

    if (action === 'back') return;

    let key: string;
    let newValueRaw: string;

    switch (action) {
      case 'provider': {
        key = 'DOLPH_LLM_PROVIDER';
        newValueRaw = await select({
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
        key = 'DOLPH_LLM_MODEL';
        newValueRaw = await input({
          message: 'Enter model name:',
          default: model,
        });
        break;
      }
      case 'narrative_mode': {
        key = 'DOLPH_NARRATIVE_MODE';
        newValueRaw = await select({
          message: 'Select narrative mode:',
          choices: [
            { name: 'Auto (LLM if key is set, else deterministic)', value: 'auto' },
            { name: 'LLM always', value: 'llm' },
            { name: 'Deterministic always', value: 'deterministic' },
          ],
        });
        break;
      }
      case 'user_agent': {
        key = 'DOLPH_SEC_USER_AGENT';
        newValueRaw = await input({
          message: 'Enter SEC User-Agent (e.g., "CompanyName email@example.com"):',
          default: userAgent,
        });
        break;
      }
      default:
        return;
    }

    const newValue = sanitizeEnvValue(newValueRaw);
    if (!newValue) {
      console.log(`  ${RED}✗${RESET} Value cannot be empty.`);
      continue;
    }

    const envLine = `${key}=${newValue}`;
    if (envContent.includes(`${key}=`)) {
      envContent = envContent.replace(new RegExp(`^${key}=.*$`, 'm'), envLine);
    } else {
      envContent += `\n${envLine}\n`;
    }

    await writeFile(envPath, envContent, 'utf-8');
    console.log(`  ${GREEN}✓${RESET} Updated ${key} → ${CYAN}${newValue}${RESET}`);

    dotenv.config({ path: envPath, override: true });
    console.log(`  ${DIM}(Changes take effect immediately)${RESET}`);
    console.log('');
  }
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
        { name: '🏷️   Resolve Ticker (/map)', value: 'map' },
        { name: '📋  Generate DCF Model', value: 'dcf' },
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
        case 'map':
          await handleMap();
          break;
        case 'dcf':
          await handleDCF();
          break;
        case 'settings':
          await handleSettings();
          break;
        case 'exit':
          running = false;
          break;
      }
    } catch (err) {
      // Cancel current action on Ctrl+C and return to menu
      if (err instanceof Error && err.message.includes('User force closed')) {
        console.log(`  ${DIM}Action cancelled.${RESET}`);
        continue;
      } else if (err instanceof Error && /analysis cancelled/i.test(err.message)) {
        console.log(`  ${DIM}Analysis cancelled.${RESET}`);
        continue;
      } else {
        console.error(`${RED}Error: ${err instanceof Error ? err.message : err}${RESET}`);
      }
    }
  }

  console.log('');
  console.log(`${DIM}Goodbye!${RESET}`);
  console.log('');
  cleanupTerminal();
}

// Handle unexpected termination
process.on('SIGINT', () => {
  if (activeAbortController) {
    activeAbortController.abort();
    process.stdout.write(`\n${DIM}Cancelling current analysis...${RESET}\n`);
    return;
  }
  cleanupTerminal();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupTerminal();
  process.exit(0);
});
process.on('exit', () => {
  cleanupTerminal();
});

main().catch((err) => {
  cleanupTerminal();
  console.error(`${RED}Fatal error: ${err instanceof Error ? err.message : err}${RESET}`);
  process.exit(1);
});
