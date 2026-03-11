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
        placeholder: "NVDA",
        parse: (value) => value.trim().toUpperCase() || null,
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
          const tickers = value
            .split(",")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);
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

function WorkspaceCard({
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
      className={`overflow-hidden rounded-3xl border transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? "md:col-span-2 border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
          : hidden
            ? "pointer-events-none max-h-0 scale-[0.98] border-transparent opacity-0"
            : "max-h-[24rem] border-border/60 bg-card/80 shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
      }`}
    >
      <div className="flex items-start justify-between gap-6 px-7 py-8">
        <button
          type="button"
          onClick={onActivate}
          disabled={disabled}
          className={`flex min-w-0 flex-1 items-start gap-5 text-left ${active ? "cursor-default" : "cursor-pointer"}`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/80 bg-background/45 text-primary">
            {config.icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold text-foreground">{config.title}</h3>
            <p className="mt-3 max-w-2xl text-base leading-8 text-muted-foreground">{config.description}</p>
          </div>
        </button>
        {active ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-xl border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition hover:border-border"
          >
            Back
          </button>
        ) : null}
      </div>
      {active ? <div className="border-t border-border/60 px-7 py-7">{children}</div> : null}
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

  useEffect(() => {
    const stored = window.localStorage.getItem("dolph-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dolph-theme", theme);
  }, [theme]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.terminal]);

  useEffect(() => {
    if (!activeTool) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 220);
    return () => window.clearTimeout(timeout);
  }, [activeTool, session.stepIndex, session.awaitingCsvPrompt]);

  const resetForTool = useCallback((tool: ToolKind) => {
    setActiveTool(tool);
    setInputValue("");
    setSession({
      ...INITIAL_SESSION,
      tool,
      terminal: [{ kind: "prompt", text: toolPrompt(tool, 0) }],
    });
  }, []);

  const handleCardActivate = useCallback(
    (tool: ToolKind) => {
      if (session.running) return;
      if (activeTool === tool && session.tool === tool) return;
      resetForTool(tool);
    },
    [activeTool, resetForTool, session.running, session.tool],
  );

  const runSearch = useCallback(async (inputs: Record<string, string>) => {
    setSession((current) => ({
      ...current,
      running: true,
      error: null,
      terminal: appendLine(current.terminal, "info", "⟳ Searching SEC filings"),
    }));
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: inputs.query,
          ticker: inputs.ticker_filter || undefined,
          date_range: inputs.date_range,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Search failed");
      }
      const results = payload.results as SearchResult[];
      const lines: ConsoleLine[] = [];
      lines.push({ kind: "success", text: `✓ Found ${results.length} filing result${results.length === 1 ? "" : "s"}` });
      for (const filing of results.slice(0, 6)) {
        lines.push({
          kind: "info",
          text: `${filing.filing_type} · ${filing.date_filed} · ${filing.company_name || "Unknown company"}`,
        });
      }
      setSession((current) => ({
        ...current,
        running: false,
        completed: true,
        searchResults: results,
        terminal: [...current.terminal, ...lines],
      }));
    } catch (error) {
      setSession((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : "Search failed",
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Search failed"}`),
      }));
    }
  }, []);

  const runResolve = useCallback(async (inputs: Record<string, string>) => {
    setSession((current) => ({
      ...current,
      running: true,
      error: null,
      terminal: appendLine(current.terminal, "info", `⟳ Resolving "${inputs.query}"`),
    }));
    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: inputs.query }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Resolution failed");
      }
      const result = payload.result as ResolvePayload;
      const lines = formatResolveSummary(result).map((text, index) => ({
        kind: index === 0 ? "success" : "info",
        text,
      })) as ConsoleLine[];
      setSession((current) => ({
        ...current,
        running: false,
        completed: true,
        resolveResult: result,
        terminal: [...current.terminal, ...lines],
      }));
    } catch (error) {
      setSession((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : "Resolution failed",
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Resolution failed"}`),
      }));
    }
  }, []);

  const runAnalysis = useCallback(async (tool: ToolKind, inputs: Record<string, string>) => {
    if (tool !== "analyze" && tool !== "compare") return;
    const controller = new AbortController();
    currentRequestRef.current?.abort();
    currentRequestRef.current = controller;
    const tickers = tool === "analyze" ? [inputs.ticker] : inputs.tickers.split(",").map((item) => item.trim()).filter(Boolean);
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
      setSession((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : "Analysis failed",
        terminal: appendLine(current.terminal, "error", `✗ ${error instanceof Error ? error.message : "Analysis failed"}`),
      }));
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!activeTool || session.running) return;
    const raw = inputValue;
    setInputValue("");

    if (session.awaitingCsvPrompt) {
      const normalized = raw.trim().toLowerCase();
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
            terminal: appendLine(current.terminal, "success", "✓ Downloading CSV export"),
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

    const currentStepIndex = session.stepIndex;
    const currentInputs = session.inputs;
    const step = TOOL_CONFIG[activeTool].steps[currentStepIndex];
    if (!step) return;

    const parsed = step.parse ? step.parse(raw) : raw.trim();
    if (parsed === null || (!step.allowBlank && parsed === "")) {
      setSession((current) => ({
        ...current,
        terminal: appendLine(current.terminal, "error", `✗ Invalid input for: ${step.prompt}`),
      }));
      return;
    }

    const nextInputs = { ...currentInputs, [step.key]: parsed };
    const nextStepIndex = currentStepIndex + 1;

    setSession((current) => ({
      ...current,
      tool: activeTool,
      inputs: nextInputs,
      stepIndex: nextStepIndex,
      outputFormat: step.key === "output_format" ? (parsed as OutputFormat) : current.outputFormat,
      terminal: appendLine(
        appendLine(current.terminal, "input", `> ${raw || "(blank)"}`),
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
  }, [activeTool, inputValue, runAnalysis, runResolve, runSearch, session]);

  const activePrompt = useMemo(() => {
    if (!activeTool) return "";
    if (session.awaitingCsvPrompt) return "Export data to CSV? [Y/N]";
    return toolPrompt(activeTool, session.stepIndex);
  }, [activeTool, session.awaitingCsvPrompt, session.stepIndex]);

  const activePlaceholder = useMemo(() => {
    if (!activeTool) return "";
    if (session.awaitingCsvPrompt) return "Y or N";
    return toolPlaceholder(activeTool, session.stepIndex);
  }, [activeTool, session.awaitingCsvPrompt, session.stepIndex]);

  const closeWorkspace = useCallback(() => {
    currentRequestRef.current?.abort();
    currentRequestRef.current = null;
    setActiveTool(null);
    setInputValue("");
    setSession(INITIAL_SESSION);
  }, []);

  return (
    <div data-theme={theme} className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-grid-mask" />
        <div className="absolute top-1/4 -left-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="https://github.com/shawyan-t/dolph-fin" target="_blank" rel="noreferrer" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-background/55 shadow-[0_0_24px_rgba(56,189,248,0.16)]">
              <img src="/dolph-icon.png" alt="Dolph" className="h-full w-full object-cover" />
            </div>
          </a>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground transition hover:border-border"
            >
              Light mode
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground transition hover:border-border"
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
                <WorkspaceCard
                  key={tool}
                  tool={tool}
                  active={active}
                  hidden={hidden}
                  disabled={session.running && !active}
                  onActivate={() => handleCardActivate(tool)}
                  onBack={closeWorkspace}
                >
                  <div className="space-y-6">
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{activePrompt}</p>
                      <input
                        ref={inputRef}
                        id={`${tool}-command`}
                        name={`${tool}-command`}
                        value={inputValue}
                        onChange={(event) => setInputValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleSubmit();
                          }
                        }}
                        placeholder={activePlaceholder || "Type your response"}
                        className="w-full rounded-2xl border border-border/70 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={session.running || !active}
                      />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.25fr]">
                      <div className="rounded-2xl border border-border/60 bg-background/45 p-5">
                        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Console</p>
                        <div className="max-h-[24rem] overflow-y-auto font-mono text-sm">
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

                      <div className="rounded-2xl border border-border/60 bg-background/45 p-5">
                        <p className="mb-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Result</p>
                        {session.error ? (
                          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                            <p className="text-sm font-semibold text-red-500">Request error</p>
                            <p className="mt-2 text-sm text-red-500/80">{session.error}</p>
                          </div>
                        ) : session.report ? (
                          <div className="space-y-6">
                            <div className="rounded-2xl border border-border/60 bg-card/75 px-5 py-4">
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
                                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
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
                                    }}
                                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground"
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
                        ) : session.searchResults ? (
                          <div className="space-y-3">
                            {session.searchResults.map((filing) => (
                              <div key={`${filing.accession_number}-${filing.date_filed}`} className="rounded-2xl border border-border/60 bg-card/75 p-4">
                                <p className="text-sm font-semibold text-foreground">
                                  {filing.company_name || "Unknown company"} · {filing.filing_type}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">{filing.date_filed}</p>
                                {filing.snippet ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{filing.snippet}</p> : null}
                                {filing.primary_document_url ? (
                                  <a href={filing.primary_document_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-primary hover:underline">
                                    Open filing
                                  </a>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : session.resolveResult ? (
                          <div className="rounded-2xl border border-border/60 bg-card/75 p-5">
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
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </WorkspaceCard>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="relative z-10 mt-auto border-t border-border/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
          <p className="text-sm text-muted-foreground">Dolph Research</p>
          <p className="text-xs text-muted-foreground">Built by Shawyan Tabari · 2026</p>
        </div>
      </footer>
    </div>
  );
}
