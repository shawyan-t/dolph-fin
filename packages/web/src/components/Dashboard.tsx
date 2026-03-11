"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useAuth } from "@/components/AuthContext";
import { RenderedChartGallery } from "@/components/RenderedChartGallery";
import { ReportView } from "@/components/ReportView";

type ToolKind = "analyze" | "compare" | "search" | "resolve";
type OutputFormat = "terminal" | "pdf" | "both";
type ThemeMode = "dark" | "light";

interface ReportSection {
  id: string;
  title: string;
  content: string;
}

interface ReportPayload {
  id: string;
  tickers: string[];
  sections: ReportSection[];
  generated_at?: string;
  metadata?: {
    report_state?: string;
  };
}

interface SearchResult {
  company_name?: string;
  filing_type: string;
  date_filed: string;
  accession_number: string;
  primary_document_url?: string;
  snippet?: string;
}

interface ResolvePayload {
  ticker: string;
  name: string;
  cik: string;
  confidence: number;
  method: string;
  alternatives?: Array<{ ticker: string; name: string; cik: string; confidence: number }>;
}

interface DownloadArtifact {
  token: string;
  filename: string;
}

interface AnalysisArtifacts {
  pdf?: DownloadArtifact | null;
  csv?: DownloadArtifact | null;
}

interface RenderedChart {
  key: string;
  title: string;
  caption: string;
  assetType: "svg" | "png";
  mimeType: string;
  content: string;
}

interface ConsoleLine {
  kind: "info" | "success" | "error" | "prompt" | "input";
  text: string;
}

interface ToolDefinition {
  title: string;
  description: string;
  icon: JSX.Element;
  steps: Array<{
    key: string;
    prompt: string;
    placeholder: string;
    allowBlank?: boolean;
    parse?: (value: string) => string | null;
  }>;
}

interface FilingPreviewFileOption {
  name: string;
  relativePath: string;
}

interface FilingPreview {
  accessionNumber: string;
  files: FilingPreviewFileOption[];
  selectedFile: {
    name: string;
    relativePath: string;
    content: string;
    truncated: boolean;
  } | null;
}

interface ResolutionOption {
  ticker: string;
  name: string;
  cik: string;
  confidence: number;
  method?: string;
}

interface PendingResolution {
  tool: Extract<ToolKind, "analyze" | "compare">;
  rawInputs: string[];
  currentIndex: number;
  resolvedTickers: string[];
  options: ResolutionOption[];
}

interface SessionState {
  tool: ToolKind | null;
  inputs: Record<string, string>;
  stepIndex: number;
  terminal: ConsoleLine[];
  running: boolean;
  completed: boolean;
  awaitingCsvPrompt: boolean;
  outputFormat: OutputFormat;
  report: ReportPayload | null;
  artifacts: AnalysisArtifacts | null;
  charts: RenderedChart[];
  searchResults: SearchResult[] | null;
  resolveResult: ResolvePayload | null;
  error: string | null;
  pendingResolution: PendingResolution | null;
  filingPreview: FilingPreview | null;
  actionLoading: string | null;
}

const TOOL_CONFIG: Record<ToolKind, ToolDefinition> = {
  analyze: {
    title: "Analyze Company",
    description: "Deep dive into SEC filings, financial statements, and deterministic report generation.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 19.5h16M7 16V8m5 8V4m5 12v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    steps: [
      {
        key: "ticker",
        prompt: "Enter ticker symbol:",
        placeholder: "NVDA or NVIDIA",
        parse: (value) => value.trim() || null,
      },
      {
        key: "output_format",
        prompt: "Output format [terminal/pdf/both]:",
        placeholder: "both",
        parse: (value) => normalizeOutputFormat(value),
      },
      {
        key: "snapshot_date",
        prompt: "Pin to snapshot date? (YYYY-MM-DD, blank for live):",
        placeholder: "YYYY-MM-DD",
        allowBlank: true,
        parse: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return "";
          return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
        },
      },
    ],
  },
  compare: {
    title: "Compare Companies",
    description: "Side-by-side comparison of filings, metrics, and disclosure patterns.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h7M4 17h7M13 7h7M13 17h7M11 4l2 3-2 3M13 14l-2 3 2 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    steps: [
      {
        key: "tickers",
        prompt: "Enter tickers (comma-separated, 2-5):",
        placeholder: "RTX, LMT, NOC",
        parse: (value) => {
          const tickers = value.split(",").map((item) => item.trim()).filter(Boolean);
          if (tickers.length < 2 || tickers.length > 5) return null;
          return tickers.join(",");
        },
      },
      {
        key: "output_format",
        prompt: "Output format [terminal/pdf/both]:",
        placeholder: "pdf",
        parse: (value) => normalizeOutputFormat(value),
      },
      {
        key: "snapshot_date",
        prompt: "Pin to snapshot date? (YYYY-MM-DD, blank for live):",
        placeholder: "YYYY-MM-DD",
        allowBlank: true,
        parse: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return "";
          return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
        },
      },
    ],
  },
  search: {
    title: "Search SEC Filings",
    description: "Full-text search across EDGAR with focused filing retrieval and direct links.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
    ),
    steps: [
      {
        key: "query",
        prompt: "Search query:",
        placeholder: "share repurchase, debt issuance, guidance",
        parse: (value) => value.trim() || null,
      },
      {
        key: "ticker_filter",
        prompt: "Filter by ticker (optional, press Enter to skip):",
        placeholder: "Optional ticker",
        allowBlank: true,
        parse: (value) => value.trim().toUpperCase(),
      },
      {
        key: "date_range",
        prompt: "Date range [last_year / last_3_years / all_time]:",
        placeholder: "last_year",
        parse: (value) => normalizeDateRange(value),
      },
    ],
  },
  resolve: {
    title: "Resolve Ticker",
    description: "Resolve ambiguous tickers and company names into clean SEC entity mappings.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 12h14M12 5v14" strokeLinecap="round" />
      </svg>
    ),
    steps: [
      {
        key: "query",
        prompt: "Enter ticker or company name to resolve:",
        placeholder: "BRK-B or Berkshire Hathaway",
        parse: (value) => value.trim() || null,
      },
    ],
  },
};

const TOOL_ORDER: ToolKind[] = ["analyze", "compare", "search", "resolve"];

const INITIAL_SESSION: SessionState = {
  tool: null,
  inputs: {},
  stepIndex: 0,
  terminal: [],
  running: false,
  completed: false,
  awaitingCsvPrompt: false,
  outputFormat: "terminal",
  report: null,
  artifacts: null,
  charts: [],
  searchResults: null,
  resolveResult: null,
  error: null,
  pendingResolution: null,
  filingPreview: null,
  actionLoading: null,
};

function normalizeOutputFormat(value: string): OutputFormat | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "terminal";
  if (normalized === "terminal" || normalized === "t") return "terminal";
  if (normalized === "pdf" || normalized === "p") return "pdf";
  if (normalized === "both" || normalized === "b") return "both";
  return null;
}

function normalizeDateRange(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (["1", "last_year", "last year"].includes(normalized)) return "last_year";
  if (["2", "last_3_years", "last 3 years"].includes(normalized)) return "last_3_years";
  if (["3", "all_time", "all time"].includes(normalized)) return "all_time";
  return null;
}

function toolPrompt(tool: ToolKind, stepIndex: number): string {
  return TOOL_CONFIG[tool].steps[stepIndex]?.prompt || "";
}

function toolPlaceholder(tool: ToolKind, stepIndex: number): string {
  return TOOL_CONFIG[tool].steps[stepIndex]?.placeholder || "";
}

function appendLine(lines: ConsoleLine[], kind: ConsoleLine["kind"], text: string): ConsoleLine[] {
  return [...lines, { kind, text }];
}

function createSessionForTool(tool: ToolKind): SessionState {
  return {
    ...INITIAL_SESSION,
    tool,
    terminal: [{ kind: "prompt", text: toolPrompt(tool, 0) }],
  };
}

function shouldResetForNewSubmission(session: SessionState, activeTool: ToolKind | null): boolean {
  if (!activeTool || session.awaitingCsvPrompt || session.running) return false;
  return (
    session.tool !== activeTool
    || session.completed
    || !!session.error
    || !!session.report
    || session.searchResults !== null
    || !!session.resolveResult
    || !!session.pendingResolution
    || !!session.filingPreview
  );
}

function triggerDownload(token: string, filename: string) {
  const link = document.createElement("a");
  link.href = `/api/download/${token}?filename=${encodeURIComponent(filename)}`;
  link.download = filename;
  link.click();
}

function getStepLine(step: { step: string; status: "running" | "complete" | "error"; detail?: string }) {
  const icon = step.status === "running" ? "⟳" : step.status === "complete" ? "✓" : "✗";
  return `${icon} ${step.step}${step.detail ? ` (${step.detail})` : ""}`;
}

function formatResolveSummary(result: ResolvePayload): string[] {
  const lines = [
    `✓ Resolved ${result.ticker}`,
    `Name: ${result.name}`,
    `CIK: ${result.cik}`,
    `Confidence: ${(result.confidence * 100).toFixed(0)}% (${result.method})`,
  ];
  if (result.alternatives?.length) {
    lines.push("Alternatives:");
    for (const alt of result.alternatives.slice(0, 4)) {
      lines.push(`- ${alt.ticker} — ${alt.name} (${(alt.confidence * 100).toFixed(0)}%)`);
    }
  }
  return lines;
}

function uniqueResolutionOptions(result: ResolvePayload): ResolutionOption[] {
  const seen = new Set<string>();
  const options: ResolutionOption[] = [];
  const add = (option: ResolutionOption) => {
    if (seen.has(option.ticker)) return;
    seen.add(option.ticker);
    options.push(option);
  };
  add({ ticker: result.ticker, name: result.name, cik: result.cik, confidence: result.confidence, method: result.method });
  for (const alt of result.alternatives || []) {
    add({ ticker: alt.ticker, name: alt.name, cik: alt.cik, confidence: alt.confidence });
  }
  return options;
}

async function postJson<T>(url: string, payload: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

function SurfaceCard({
  tool,
  active,
  hidden,
  disabled,
  onActivate,
  onBack,
  children,
}: {
  tool: ToolKind;
  active: boolean;
  hidden: boolean;
  disabled: boolean;
  onActivate: () => void;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  const config = TOOL_CONFIG[tool];

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? "md:col-span-2 border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.13),rgba(255,255,255,0.035))] shadow-[0_30px_90px_rgba(2,8,23,0.28),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(15,23,42,0.18)]"
          : hidden
            ? "pointer-events-none max-h-0 scale-[0.98] border-transparent opacity-0"
            : "border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.03))] shadow-[0_20px_52px_rgba(2,8,23,0.18),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(15,23,42,0.12)]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_28%,transparent_70%)] opacity-80" />
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)]" />
      <div className="relative flex items-start justify-between gap-6 px-7 py-8">
        <button
          type="button"
          onClick={onActivate}
          disabled={disabled}
          className={`flex min-w-0 flex-1 items-start gap-5 text-left ${active ? "cursor-default" : "cursor-pointer"}`}
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_12px_24px_rgba(15,23,42,0.16)]">
            {config.icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-[2rem] font-semibold tracking-tight text-foreground">{config.title}</h3>
            <p className="mt-3 max-w-2xl text-[1.02rem] leading-8 text-muted-foreground">{config.description}</p>
          </div>
        </button>
        {active ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-xl border border-border/80 bg-background/55 px-4 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition hover:border-primary/30"
          >
            Back
          </button>
        ) : null}
      </div>
      {active ? <div className="relative border-t border-border/60 px-7 py-7">{children}</div> : null}
    </div>
  );
}

function ResolutionPicker({
  selection,
  onSelect,
  onCancel,
}: {
  selection: PendingResolution;
  onSelect: (ticker: string) => void;
  onCancel: () => void;
}) {
  const raw = selection.rawInputs[selection.currentIndex] || "";
  return (
    <div className="rounded-2xl border border-border/70 bg-card/75 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Select Match</p>
      <h3 className="mt-3 text-xl font-semibold text-foreground">Choose the best match for “{raw}”</h3>
      <div className="mt-5 grid gap-3">
        {selection.options.map((option) => (
          <button
            key={`${option.ticker}-${option.cik}`}
            type="button"
            onClick={() => onSelect(option.ticker)}
            className="rounded-2xl border border-border/70 bg-background/55 px-4 py-4 text-left transition hover:border-primary/40 hover:bg-background/80"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-foreground">{option.ticker}</p>
                <p className="mt-1 text-sm text-muted-foreground">{option.name}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{(option.confidence * 100).toFixed(0)}%</p>
                <p>CIK {option.cik}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 rounded-xl border border-border/70 px-4 py-2 text-sm text-foreground"
      >
        Cancel and re-enter
      </button>
    </div>
  );
}

export function Dashboard() {
  const { logout } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [activeTool, setActiveTool] = useState<ToolKind | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [session, setSession] = useState<SessionState>(INITIAL_SESSION);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const currentRequestRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const activeToolRef = useRef<ToolKind | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dolph-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dolph-theme", theme);
  }, [theme]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.terminal]);

  useEffect(() => {
    if (!activeTool) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 220);
    return () => window.clearTimeout(timer);
  }, [activeTool, session.stepIndex, session.awaitingCsvPrompt, session.pendingResolution]);

  const activateTool = useCallback(
    (tool: ToolKind) => {
      if (session.running) return;
      runIdRef.current += 1;
      currentRequestRef.current?.abort();
      setActiveTool(tool);
      setInputValue("");
      setSession(createSessionForTool(tool));
    },
    [session.running],
  );

  const closeWorkspace = useCallback(() => {
    currentRequestRef.current?.abort();
    currentRequestRef.current = null;
    runIdRef.current += 1;
    setActiveTool(null);
    setInputValue("");
    setSession(INITIAL_SESSION);
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (!activeTool) return;
    if (!shouldResetForNewSubmission(session, activeTool)) return;
    runIdRef.current += 1;
    currentRequestRef.current?.abort();
    currentRequestRef.current = null;
    setSession(createSessionForTool(activeTool));
  }, [activeTool, session]);

  const resolveTickerBatch = useCallback(async (
    tool: Extract<ToolKind, "analyze" | "compare">,
    rawInputs: string[],
    startIndex = 0,
    resolvedTickers: string[] = [],
  ): Promise<{
    terminalAdds: ConsoleLine[];
    resolvedTickers?: string[];
    selection?: PendingResolution;
    error?: string;
  }> => {
    const terminalAdds: ConsoleLine[] = [];
    const resolved = [...resolvedTickers];

    for (let index = startIndex; index < rawInputs.length; index += 1) {
      const raw = rawInputs[index]!.trim();
      const response = await postJson<{ result?: ResolvePayload; error?: string; best_match?: string; alternatives?: string[] }>("/api/resolve", { query: raw });

      if (!response.ok || !response.data.result) {
        const message = response.data.error || `Could not resolve "${raw}"`;
        terminalAdds.push({ kind: "error", text: `✗ ${message}` });
        return { terminalAdds, error: message };
      }

      const result = response.data.result;
      const normalizedRaw = raw.toUpperCase();

      if (result.confidence >= 0.9) {
        if (result.ticker !== normalizedRaw) {
          terminalAdds.push({ kind: "success", text: `✓ Resolved ${raw} → ${result.ticker}` });
        }
        resolved.push(result.ticker);
        continue;
      }

      return {
        terminalAdds,
        selection: {
          tool,
          rawInputs,
          currentIndex: index,
          resolvedTickers: resolved,
          options: uniqueResolutionOptions(result),
        },
      };
    }

    return { terminalAdds, resolvedTickers: resolved };
  }, []);

  const continueAfterResolution = useCallback(async (
    tool: Extract<ToolKind, "analyze" | "compare">,
    selection: PendingResolution,
    pickedTicker: string,
  ) => {
    const followUp = await resolveTickerBatch(tool, selection.rawInputs, selection.currentIndex + 1, [...selection.resolvedTickers, pickedTicker]);

    if (followUp.error) {
      setSession((current) => ({
        ...createSessionForTool(tool),
        terminal: [
          ...createSessionForTool(tool).terminal,
          ...current.terminal.filter((line) => line.kind === "input"),
          ...followUp.terminalAdds,
        ],
        error: followUp.error ?? null,
      }));
      return;
    }

    if (followUp.selection) {
      setSession((current) => ({
        ...current,
        pendingResolution: followUp.selection || null,
        terminal: [...current.terminal, ...followUp.terminalAdds, { kind: "prompt", text: "Select a match below to continue." }],
      }));
      return;
    }

    const stepKey = tool === "analyze" ? "ticker" : "tickers";
    const resolvedValue = tool === "analyze" ? followUp.resolvedTickers?.[0] || pickedTicker : (followUp.resolvedTickers || [...selection.resolvedTickers, pickedTicker]).join(",");
    const nextInputs = { [stepKey]: resolvedValue };

    setSession((current) => ({
      ...current,
      pendingResolution: null,
      inputs: nextInputs,
      stepIndex: 1,
      terminal: [
        ...current.terminal,
        { kind: "success", text: `✓ Using ${pickedTicker}` },
        ...followUp.terminalAdds,
        { kind: "prompt", text: toolPrompt(tool, 1) },
      ],
      error: null,
    }));
  }, [resolveTickerBatch]);

  const runSearch = useCallback(async (inputs: Record<string, string>) => {
    const runId = ++runIdRef.current;
    setSession((current) => ({
      ...current,
      running: true,
      error: null,
      searchResults: null,
      filingPreview: null,
      terminal: appendLine(current.terminal, "info", "⟳ Searching SEC filings"),
    }));

    try {
      const response = await postJson<{ results?: SearchResult[]; error?: string }>("/api/search", {
        query: inputs.query,
        ticker: inputs.ticker_filter || undefined,
        date_range: inputs.date_range,
      });
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      if (!response.ok || !response.data.results) {
        throw new Error(response.data.error || "Search failed");
      }

      const results = response.data.results;
      const lines: ConsoleLine[] = [];
      if (results.length === 0) {
        lines.push({ kind: "info", text: "○ No filings found for that query." });
      } else {
        lines.push({ kind: "success", text: `✓ Found ${results.length} filing result${results.length === 1 ? "" : "s"}` });
        for (const filing of results.slice(0, 15)) {
          lines.push({ kind: "info", text: `${filing.filing_type} · ${filing.date_filed} · ${filing.company_name || "Unknown company"}` });
        }
      }

      setSession((current) => ({
        ...current,
        running: false,
        completed: true,
        stepIndex: 0,
        inputs: {},
        searchResults: results,
        terminal: [...current.terminal, ...lines, { kind: "prompt", text: toolPrompt("search", 0) }],
      }));
    } catch (error) {
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      setSession((current) => ({
        ...current,
        running: false,
        stepIndex: 0,
        inputs: {},
        error: error instanceof Error ? error.message : "Search failed",
        terminal: appendLine(
          appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Search failed"}`),
          "prompt",
          toolPrompt("search", 0),
        ),
      }));
    }
  }, []);

  const runResolve = useCallback(async (inputs: Record<string, string>) => {
    const runId = ++runIdRef.current;
    setSession((current) => ({
      ...current,
      running: true,
      error: null,
      resolveResult: null,
      terminal: appendLine(current.terminal, "info", `⟳ Resolving "${inputs.query}"`),
    }));

    try {
      const response = await postJson<{ result?: ResolvePayload; error?: string }>("/api/resolve", { query: inputs.query });
      if (runId !== runIdRef.current || activeToolRef.current !== "resolve") return;
      if (!response.ok || !response.data.result) {
        throw new Error(response.data.error || "Resolution failed");
      }

      const result = response.data.result;
      const lines = formatResolveSummary(result).map((text, index) => ({ kind: index === 0 ? "success" : "info", text })) as ConsoleLine[];
      setSession((current) => ({
        ...current,
        running: false,
        completed: true,
        stepIndex: 0,
        inputs: {},
        resolveResult: result,
        terminal: [...current.terminal, ...lines, { kind: "prompt", text: toolPrompt("resolve", 0) }],
      }));
    } catch (error) {
      if (runId !== runIdRef.current || activeToolRef.current !== "resolve") return;
      setSession((current) => ({
        ...current,
        running: false,
        stepIndex: 0,
        inputs: {},
        error: error instanceof Error ? error.message : "Resolution failed",
        terminal: appendLine(
          appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Resolution failed"}`),
          "prompt",
          toolPrompt("resolve", 0),
        ),
      }));
    }
  }, []);

  const runAnalysis = useCallback(async (tool: Extract<ToolKind, "analyze" | "compare">, inputs: Record<string, string>) => {
    const controller = new AbortController();
    const runId = ++runIdRef.current;
    currentRequestRef.current?.abort();
    currentRequestRef.current = controller;
    const tickers = tool === "analyze"
      ? [inputs.ticker]
      : inputs.tickers.split(",").map((item) => item.trim()).filter(Boolean);
    const analysisId = nanoid();
    const outputFormat = normalizeOutputFormat(inputs.output_format) || "terminal";

    setSession((current) => ({
      ...current,
      running: true,
      error: null,
      completed: false,
      awaitingCsvPrompt: false,
      outputFormat,
      report: null,
      artifacts: null,
      charts: [],
      searchResults: null,
      resolveResult: null,
      filingPreview: null,
      actionLoading: null,
      terminal: appendLine(current.terminal, "info", `⟳ Starting ${tool === "analyze" ? "company" : "comparison"} analysis`),
    }));

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          tickers,
          type: tool === "analyze" ? "single" : "comparison",
          snapshot_date: inputs.snapshot_date || undefined,
          output_format: outputFormat,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Failed to start analysis" }));
        throw new Error(payload.error || "Failed to start analysis");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const chunk of events) {
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6));
          if (runId !== runIdRef.current || activeToolRef.current !== tool) {
            continue;
          }
          if (event.type === "step") {
            setSession((current) => ({
              ...current,
              terminal: appendLine(
                current.terminal,
                event.data.status === "error" ? "error" : event.data.status === "complete" ? "success" : "info",
                getStepLine(event.data),
              ),
            }));
          } else if (event.type === "partial_report") {
            setSession((current) => ({
              ...current,
              terminal: appendLine(current.terminal, "info", `… ${event.data.section.replace(/_/g, " ")}`),
            }));
          } else if (event.type === "final_report") {
            const report = event.data.report || event.data;
            const artifacts = event.data.artifacts || null;
            const charts = Array.isArray(event.data.charts) ? event.data.charts : [];
            setSession((current) => ({
              ...current,
              running: false,
              completed: true,
              report,
              artifacts,
              charts,
              awaitingCsvPrompt: !!artifacts?.csv,
              terminal: [
                ...current.terminal,
                { kind: "success", text: `✓ ${report.metadata?.report_state === "full" ? "Analysis complete" : "Coverage result ready"}` },
                ...(artifacts?.pdf ? [{ kind: "info" as const, text: "PDF prepared for download." }] : []),
                ...(artifacts?.csv ? [{ kind: "prompt" as const, text: "Export data to CSV? [Y/N]" }] : []),
              ],
            }));
          } else if (event.type === "error") {
            setSession((current) => ({
              ...current,
              running: false,
              error: event.data.message,
              terminal: appendLine(current.terminal, "error", `✗ ${event.data.message}`),
            }));
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (runId !== runIdRef.current || activeToolRef.current !== tool) return;
      setSession((current) => ({
        ...current,
        running: false,
        stepIndex: 0,
        inputs: {},
        error: error instanceof Error ? error.message : "Analysis failed",
        terminal: appendLine(
          appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Analysis failed"}`),
          "prompt",
          toolPrompt(tool, 0),
        ),
      }));
    }
  }, []);

  const handlePreviewFiling = useCallback(async (filing: SearchResult) => {
    if (!filing.primary_document_url) return;
    const runId = ++runIdRef.current;
    setSession((current) => ({
      ...current,
      actionLoading: `preview-${filing.accession_number}`,
      error: null,
      filingPreview: null,
      terminal: appendLine(current.terminal, "info", `⟳ Loading previewable filing files (${filing.accession_number})`),
    }));

    try {
      const response = await postJson<{ mode?: string; files?: Array<{ name: string; relative_path: string }>; error?: string }>(
        "/api/filings/preview",
        {
          accession_number: filing.accession_number,
          document_url: filing.primary_document_url,
        },
      );
      if (!response.ok || response.data.mode !== "files") {
        throw new Error(response.data.error || "Preview failed");
      }
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      setSession((current) => ({
        ...current,
        actionLoading: null,
        filingPreview: {
          accessionNumber: filing.accession_number,
          files: (response.data.files || []).map((file) => ({
            name: file.name,
            relativePath: file.relative_path,
          })),
          selectedFile: null,
        },
        terminal: appendLine(current.terminal, "success", `✓ Loaded ${response.data.files?.length || 0} previewable files (${filing.accession_number})`),
      }));
    } catch (error) {
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      setSession((current) => ({
        ...current,
        actionLoading: null,
        filingPreview: null,
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Preview failed"}`),
      }));
    }
  }, []);

  const handlePreviewFilingFile = useCallback(async (filing: SearchResult, file: FilingPreviewFileOption) => {
    if (!filing.primary_document_url) return;
    const runId = ++runIdRef.current;
    setSession((current) => ({
      ...current,
      actionLoading: `preview-file-${filing.accession_number}`,
      error: null,
      terminal: appendLine(current.terminal, "info", `⟳ Previewing ${file.name}`),
    }));

    try {
      const response = await postJson<{
        mode?: string;
        file?: { name: string; relative_path: string; content: string; truncated: boolean };
        error?: string;
      }>("/api/filings/preview", {
        accession_number: filing.accession_number,
        document_url: filing.primary_document_url,
        file_path: file.relativePath,
      });

      if (!response.ok || response.data.mode !== "file" || !response.data.file) {
        throw new Error(response.data.error || "Preview failed");
      }
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      const selectedFile = response.data.file;

      setSession((current) => ({
        ...current,
        actionLoading: null,
        filingPreview: current.filingPreview
          ? {
              ...current.filingPreview,
              selectedFile: {
                name: selectedFile.name,
                relativePath: selectedFile.relative_path,
                content: selectedFile.content,
                truncated: selectedFile.truncated,
              },
            }
          : current.filingPreview,
        terminal: appendLine(current.terminal, "success", `✓ Loaded ${selectedFile.name}`),
      }));
    } catch (error) {
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      setSession((current) => ({
        ...current,
        actionLoading: null,
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Preview failed"}`),
      }));
    }
  }, []);

  const handleDownloadFilingZip = useCallback(async (filing: SearchResult) => {
    if (!filing.primary_document_url) return;
    const runId = ++runIdRef.current;
    setSession((current) => ({
      ...current,
      actionLoading: `download-${filing.accession_number}`,
      error: null,
      terminal: appendLine(current.terminal, "info", `⟳ Preparing filing ZIP (${filing.accession_number})`),
    }));

    try {
      const response = await postJson<{ artifact?: DownloadArtifact; error?: string }>("/api/filings/download", {
        accession_number: filing.accession_number,
        document_url: filing.primary_document_url,
        company_name: filing.company_name,
        filing_type: filing.filing_type,
        date_filed: filing.date_filed,
      });
      if (!response.ok || !response.data.artifact) {
        throw new Error(response.data.error || "Download failed");
      }
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      triggerDownload(response.data.artifact.token, response.data.artifact.filename);
      setSession((current) => ({
        ...current,
        actionLoading: null,
        terminal: appendLine(current.terminal, "success", `✓ Downloading ${response.data.artifact!.filename}`),
      }));
    } catch (error) {
      if (runId !== runIdRef.current || activeToolRef.current !== "search") return;
      setSession((current) => ({
        ...current,
        actionLoading: null,
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Download failed"}`),
      }));
    }
  }, []);

  const handleResolutionChoice = useCallback(async (ticker: string) => {
    if (!session.pendingResolution) return;
    setSession((current) => ({
      ...current,
      pendingResolution: null,
      terminal: appendLine(current.terminal, "input", `> ${ticker}`),
    }));
    await continueAfterResolution(session.pendingResolution.tool, session.pendingResolution, ticker);
  }, [continueAfterResolution, session.pendingResolution]);

  const handleResolutionCancel = useCallback(() => {
    if (!activeTool) return;
    runIdRef.current += 1;
    setSession(() => ({
      ...createSessionForTool(activeTool),
      terminal: [
        ...createSessionForTool(activeTool).terminal,
        { kind: "info", text: "Resolution cancelled. Enter a new query." },
      ],
    }));
    setInputValue("");
  }, [activeTool]);

  const handleSubmit = useCallback(async () => {
    if (!activeTool || session.running) return;
    const raw = inputValue;
    const trimmed = raw.trim();
    setInputValue("");

    if (session.awaitingCsvPrompt) {
      const normalized = trimmed.toLowerCase();
      setSession((current) => ({
        ...current,
        awaitingCsvPrompt: false,
        terminal: appendLine(current.terminal, "input", `> ${raw || "(blank)"}`),
      }));
      if (normalized === "y" || normalized === "yes") {
        const artifact = session.artifacts?.csv;
        if (artifact) {
          triggerDownload(artifact.token, artifact.filename);
          setSession((current) => ({
            ...current,
            terminal: appendLine(current.terminal, "success", `✓ Downloading ${artifact.filename}`),
          }));
        }
      } else {
        setSession((current) => ({
          ...current,
          terminal: appendLine(current.terminal, "info", "CSV export skipped."),
        }));
      }
      return;
    }

    const shouldRestart = shouldResetForNewSubmission(session, activeTool);

    const baseSession = shouldRestart ? createSessionForTool(activeTool) : session;
    const currentStepIndex = shouldRestart ? 0 : session.stepIndex;
    const currentInputs = shouldRestart ? {} : session.inputs;
    const currentTerminal = shouldRestart ? baseSession.terminal : session.terminal;
    const step = TOOL_CONFIG[activeTool].steps[currentStepIndex];
    if (!step) return;

    const parsed = step.parse ? step.parse(raw) : trimmed;
    if (parsed === null || (!step.allowBlank && parsed === "")) {
      setSession(() => ({
        ...baseSession,
        error: null,
        terminal: appendLine(currentTerminal, "error", `✗ Invalid input for: ${step.prompt}`),
      }));
      return;
    }

    if ((activeTool === "analyze" || activeTool === "compare") && currentStepIndex === 0) {
      const rawInputs = activeTool === "analyze"
        ? [parsed]
        : String(parsed).split(",").map((item) => item.trim()).filter(Boolean);
      setSession({
        ...baseSession,
        tool: activeTool,
        error: null,
        terminal: appendLine(currentTerminal, "input", `> ${raw || "(blank)"}`),
      });
      const outcome = await resolveTickerBatch(activeTool, rawInputs);

      if (outcome.error) {
        setSession(() => ({
          ...createSessionForTool(activeTool),
          error: outcome.error || null,
          terminal: [
            ...createSessionForTool(activeTool).terminal,
            { kind: "input", text: `> ${raw || "(blank)"}` },
            ...outcome.terminalAdds,
          ],
        }));
        return;
      }

      if (outcome.selection) {
        setSession((current) => ({
          ...current,
          pendingResolution: outcome.selection || null,
          terminal: [...current.terminal, ...outcome.terminalAdds, { kind: "prompt", text: "Select a match below to continue." }],
        }));
        return;
      }

      const resolvedValue = activeTool === "analyze"
        ? outcome.resolvedTickers?.[0] || ""
        : (outcome.resolvedTickers || []).join(",");
      const nextInputs = { ...currentInputs, [step.key]: resolvedValue };
      const nextStepIndex = 1;
      setSession((current) => ({
        ...current,
        inputs: nextInputs,
        stepIndex: nextStepIndex,
        terminal: [...current.terminal, ...outcome.terminalAdds, { kind: "prompt", text: toolPrompt(activeTool, nextStepIndex) }],
      }));
      return;
    }

    const nextInputs = { ...currentInputs, [step.key]: parsed };
    const nextStepIndex = currentStepIndex + 1;

    setSession((current) => ({
      ...baseSession,
      tool: activeTool,
      inputs: nextInputs,
      stepIndex: nextStepIndex,
      outputFormat: step.key === "output_format" ? (parsed as OutputFormat) : current.outputFormat,
      error: null,
      terminal: appendLine(
        appendLine(currentTerminal, "input", `> ${raw || "(blank)"}`),
        "prompt",
        nextStepIndex < TOOL_CONFIG[activeTool].steps.length ? toolPrompt(activeTool, nextStepIndex) : "Running…",
      ),
    }));

    if (nextStepIndex >= TOOL_CONFIG[activeTool].steps.length) {
      if (activeTool === "search") {
        await runSearch(nextInputs);
      } else if (activeTool === "resolve") {
        await runResolve(nextInputs);
      } else {
        await runAnalysis(activeTool, nextInputs);
      }
    }
  }, [activeTool, inputValue, resolveTickerBatch, runAnalysis, runResolve, runSearch, session]);

  const activePrompt = useMemo(() => {
    if (!activeTool) return "";
    if (session.awaitingCsvPrompt) return "Export data to CSV? [Y/N]";
    if (session.pendingResolution) return "Select the correct match below or enter a new query";
    if (shouldResetForNewSubmission(session, activeTool)) return toolPrompt(activeTool, 0);
    return toolPrompt(activeTool, session.stepIndex);
  }, [activeTool, session]);

  const activePlaceholder = useMemo(() => {
    if (!activeTool) return "";
    if (session.awaitingCsvPrompt) return "Y or N";
    if (session.pendingResolution) return toolPlaceholder(activeTool, 0);
    if (shouldResetForNewSubmission(session, activeTool)) return toolPlaceholder(activeTool, 0);
    return toolPlaceholder(activeTool, session.stepIndex);
  }, [activeTool, session]);

  return (
    <div data-theme={theme} className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-[-8rem] top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-[-8rem] bottom-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="https://github.com/shawyan-t/dolph-fin" target="_blank" rel="noreferrer" className="flex items-center">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-background/60 shadow-[0_8px_20px_rgba(56,189,248,0.12)]">
              <img src="/dolph-icon.png" alt="Dolph" className="h-full w-full object-cover" />
            </div>
          </a>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="rounded-xl border border-border/70 bg-card/70 px-4 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition hover:border-border"
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-border/70 bg-card/70 px-4 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition hover:border-border"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <section className="mb-16 text-center animate-fade-in [animation-delay:120ms]">
          <h1 className="text-5xl font-bold leading-[1.04] tracking-tight text-foreground md:text-6xl lg:text-7xl">Dolph Research</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Analyze, compare, and search filings from SEC EDGAR
          </p>
        </section>

        <section>
          <div className="grid gap-5 md:grid-cols-2">
            {TOOL_ORDER.map((tool) => {
              const active = activeTool === tool;
              const hidden = !!activeTool && !active;
              return (
                <SurfaceCard
                  key={tool}
                  tool={tool}
                  active={active}
                  hidden={hidden}
                  disabled={session.running && !active}
                  onActivate={() => activateTool(tool)}
                  onBack={closeWorkspace}
                >
                  <div className="space-y-6">
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{activePrompt}</p>
                      <input
                        ref={inputRef}
                        id={`${tool}-query`}
                        name={`${tool}-query`}
                        value={inputValue}
                        onChange={(event) => handleInputChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleSubmit();
                          }
                        }}
                        placeholder={activePlaceholder || "Type your response"}
                        className="w-full rounded-2xl border border-border/80 bg-white px-4 py-3 text-base text-black outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={session.running && !session.awaitingCsvPrompt}
                      />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.3fr]">
                      <div className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] p-5 shadow-[0_18px_36px_rgba(2,8,23,0.12),inset_0_1px_0_rgba(255,255,255,0.12)]">
                        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Console</p>
                        <div className="max-h-[28rem] overflow-y-auto font-mono text-sm">
                          <div className="space-y-2">
                            {session.terminal.map((line, index) => (
                              <p
                                key={`${line.text}-${index}`}
                                className={
                                  line.kind === "error"
                                    ? "text-red-500"
                                    : line.kind === "success"
                                      ? "text-emerald-500"
                                      : line.kind === "prompt"
                                        ? "text-sky-500"
                                        : line.kind === "input"
                                          ? "text-foreground"
                                          : "text-muted-foreground"
                                }
                              >
                                {line.text}
                              </p>
                            ))}
                            <div ref={consoleEndRef} />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] p-5 shadow-[0_18px_36px_rgba(2,8,23,0.12),inset_0_1px_0_rgba(255,255,255,0.12)]">
                        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Result</p>

                        {session.error ? (
                          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-sm font-semibold text-red-500">Request failed</p>
                            <p className="mt-2 text-sm text-red-500/80">{session.error}</p>
                            <p className="mt-3 text-xs uppercase tracking-[0.16em] text-red-500/70">Enter a new query to retry</p>
                          </div>
                        ) : null}

                        {session.pendingResolution ? (
                          <ResolutionPicker
                            selection={session.pendingResolution}
                            onSelect={(ticker) => void handleResolutionChoice(ticker)}
                            onCancel={handleResolutionCancel}
                          />
                        ) : null}

                        {!session.pendingResolution && !session.error && session.running && !session.report && session.searchResults === null && !session.resolveResult ? (
                          <div className="rounded-2xl border border-border/70 bg-card/65 px-5 py-5 shadow-[0_14px_30px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-sm font-semibold text-foreground">Running</p>
                            <p className="mt-2 text-sm text-muted-foreground">Processing the current workflow.</p>
                          </div>
                        ) : null}

                        {!session.pendingResolution && session.report ? (
                          <div className="space-y-6">
                            <div className="rounded-2xl border border-border/70 bg-card/70 px-5 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.10)]">
                              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Report state</p>
                              <p className="mt-2 text-lg font-semibold text-foreground">
                                {session.report.metadata?.report_state === "full" ? "Full report" : "Coverage result"}
                              </p>
                              {session.report.generated_at ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Generated {new Date(session.report.generated_at).toLocaleString()}
                                </p>
                              ) : null}
                              <div className="mt-4 flex flex-wrap gap-2">
                                {session.artifacts?.pdf ? (
                                  <button
                                    type="button"
                                    onClick={() => triggerDownload(session.artifacts!.pdf!.token, session.artifacts!.pdf!.filename)}
                                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_12px_24px_rgba(37,99,235,0.24)]"
                                  >
                                    Download PDF
                                  </button>
                                ) : null}
                                {session.artifacts?.csv ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSession((current) => ({
                                        ...current,
                                        awaitingCsvPrompt: true,
                                        terminal: appendLine(current.terminal, "prompt", "Export data to CSV? [Y/N]"),
                                      }));
                                      inputRef.current?.focus();
                                    }}
                                    className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                                  >
                                    Export CSV
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <div className="report-shell">
                              <RenderedChartGallery charts={session.charts} />
                              <ReportView
                                sections={session.report.sections}
                                tickers={session.report.tickers}
                                generatedAt={session.report.generated_at}
                              />
                            </div>
                          </div>
                        ) : null}

                        {!session.pendingResolution && !session.report && session.searchResults ? (
                          <div className="space-y-5">
                              <div className="flex flex-wrap items-center gap-3">
                                <p className="text-sm text-muted-foreground">{session.searchResults.length} result(s)</p>
                            </div>
                            {session.filingPreview ? (
                              <div className="rounded-2xl border border-border/70 bg-card/70 p-5">
                                <div className="flex items-center justify-between gap-4">
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Filing Preview</p>
                                    <p className="mt-2 text-sm text-muted-foreground">{session.filingPreview.files.length} previewable file(s)</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setSession((current) => ({ ...current, filingPreview: null }))}
                                    className="rounded-xl border border-border/70 px-3 py-2 text-sm text-foreground"
                                  >
                                    Close preview
                                  </button>
                                </div>
                                <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                                  <div className="space-y-2">
                                    {session.filingPreview.files.map((file) => (
                                      <button
                                        key={file.relativePath}
                                        type="button"
                                        onClick={() => {
                                          const filing = session.searchResults?.find((result) => result.accession_number === session.filingPreview?.accessionNumber);
                                          if (filing) void handlePreviewFilingFile(filing, file);
                                        }}
                                        className={`block w-full rounded-xl border px-3 py-2 text-left text-sm ${
                                          session.filingPreview?.selectedFile?.relativePath === file.relativePath
                                            ? "border-primary/50 bg-primary/10 text-foreground"
                                            : "border-border/70 bg-background/40 text-muted-foreground"
                                        }`}
                                      >
                                        {file.name}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="rounded-xl border border-border/70 bg-background/45 p-4">
                                    {session.filingPreview.selectedFile ? (
                                      <>
                                        <p className="text-sm font-semibold text-foreground">{session.filingPreview.selectedFile.name}</p>
                                        <pre className="mt-3 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                                          {session.filingPreview.selectedFile.content}
                                        </pre>
                                        {session.filingPreview.selectedFile.truncated ? (
                                          <p className="mt-3 text-xs text-muted-foreground">Preview truncated.</p>
                                        ) : null}
                                      </>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">Select a file to preview.</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                            {session.searchResults.length === 0 ? (
                              <div className="rounded-2xl border border-border/70 bg-card/65 px-5 py-5 shadow-[0_14px_30px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.08)]">
                                <p className="text-sm font-semibold text-foreground">No filings found</p>
                                <p className="mt-2 text-sm text-muted-foreground">Adjust the query or ticker filter and try again.</p>
                              </div>
                            ) : null}
                            <div className="space-y-3">
                              {session.searchResults.map((filing) => {
                                const filingActionBusy = !!session.actionLoading;
                                const previewBusy = session.actionLoading === `preview-${filing.accession_number}`;
                                const downloadBusy = session.actionLoading === `download-${filing.accession_number}`;
                                return (
                                  <div key={`${filing.accession_number}-${filing.date_filed}`} className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.08)]">
                                    <div className="flex items-start justify-between gap-4">
                                      <div>
                                        <p className="text-sm font-semibold text-foreground">{filing.company_name || "Unknown company"} · {filing.filing_type}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{filing.date_filed}</p>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {filing.primary_document_url ? (
                                          <a
                                            href={filing.primary_document_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground"
                                          >
                                            Open filing
                                          </a>
                                        ) : null}
                                        {filing.primary_document_url ? (
                                          <button
                                            type="button"
                                            onClick={() => void handlePreviewFiling(filing)}
                                            disabled={filingActionBusy}
                                            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            {previewBusy ? "Loading…" : "Preview filing"}
                                          </button>
                                        ) : null}
                                        {filing.primary_document_url ? (
                                          <button
                                            type="button"
                                            onClick={() => void handleDownloadFilingZip(filing)}
                                            disabled={filingActionBusy}
                                            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            {downloadBusy ? "Preparing…" : "Download ZIP"}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                    {filing.snippet ? (
                                      <p className="mt-3 text-sm leading-7 text-muted-foreground">{filing.snippet.replace(/<[^>]+>/g, "")}</p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {!session.pendingResolution && !session.report && !session.searchResults && session.resolveResult ? (
                          <div className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Resolved entity</p>
                            <h3 className="mt-3 text-xl font-semibold text-foreground">{session.resolveResult.ticker}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{session.resolveResult.name}</p>
                            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                              <div>
                                <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">CIK</dt>
                                <dd className="mt-1 text-sm text-foreground">{session.resolveResult.cik}</dd>
                              </div>
                              <div>
                                <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Confidence</dt>
                                <dd className="mt-1 text-sm text-foreground">{(session.resolveResult.confidence * 100).toFixed(0)}%</dd>
                              </div>
                              <div>
                                <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Method</dt>
                                <dd className="mt-1 text-sm text-foreground">{session.resolveResult.method}</dd>
                              </div>
                            </dl>
                            {session.resolveResult.alternatives?.length ? (
                              <div className="mt-5">
                                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Alternatives</p>
                                <div className="mt-3 space-y-2">
                                  {session.resolveResult.alternatives.map((option) => (
                                    <div key={`${option.ticker}-${option.cik}`} className="rounded-xl border border-border/60 bg-background/40 px-3 py-3">
                                      <p className="text-sm font-medium text-foreground">{option.ticker}</p>
                                      <p className="mt-1 text-sm text-muted-foreground">{option.name}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {!session.pendingResolution && !session.report && session.searchResults === null && !session.resolveResult && !session.error && !session.running ? (
                          <div className="rounded-2xl border border-border/70 bg-card/65 px-5 py-5 shadow-[0_14px_30px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-sm font-semibold text-foreground">Awaiting input</p>
                            <p className="mt-2 text-sm text-muted-foreground">Enter a query to begin.</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </SurfaceCard>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
