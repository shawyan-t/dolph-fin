"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AnalysisTimeline } from "@/components/AnalysisTimeline";
import { ReportView } from "@/components/ReportView";
import { ExportButtons } from "@/components/ExportButtons";
import { ChartDisplay } from "@/components/ChartDisplay";
import Link from "next/link";

interface TimelineStep {
  step: string;
  status: "running" | "complete" | "error";
  detail?: string;
}

interface ReportSection {
  id: string;
  title: string;
  content: string;
}

function AnalysisPageContent() {
  const searchParams = useSearchParams();
  const tickers = (searchParams.get("tickers") || "").split(",").filter(Boolean);
  const type = (searchParams.get("type") || "single") as "single" | "comparison";
  const snapshotDate = searchParams.get("snapshot_date") || undefined;

  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [retryToken, setRetryToken] = useState(0);
  const [charts, setCharts] = useState<{
    revenueMarginChart: string | null;
    fcfBridgeChart: string | null;
    peerScorecardChart: string | null;
    returnLeverageChart: string | null;
    growthDurabilityChart: string | null;
  } | null>(null);
  const started = useRef(false);

  const startAnalysis = useCallback(async () => {
    if (started.current || tickers.length === 0) return;
    started.current = true;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, type, snapshot_date: snapshotDate }),
      });

      if (!response.ok || !response.body) {
        setError("Failed to start analysis");
        started.current = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case "step":
                setSteps((prev) => {
                  const existing = prev.findIndex(s => s.step === event.data.step);
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = event.data;
                    return updated;
                  }
                  return [...prev, event.data];
                });
                break;

              case "partial_report":
                setSections((prev) => {
                  const existing = prev.findIndex(s => s.id === event.data.section);
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = {
                      id: event.data.section,
                      title: event.data.section.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                      content: event.data.content,
                    };
                    return updated;
                  }
                  return [...prev, {
                    id: event.data.section,
                    title: event.data.section.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                    content: event.data.content,
                  }];
                });
                break;

              case "charts":
                setCharts(event.data);
                break;

              case "final_report":
                if (event.data.sections) {
                  setSections(event.data.sections);
                }
                if (event.data.generated_at) {
                  setGeneratedAt(event.data.generated_at);
                }
                setDone(true);
                break;

              case "error":
                setError(event.data.message);
                started.current = false;
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      started.current = false;
    }
  }, [tickers, type, snapshotDate]);

  const handleRetry = useCallback(() => {
    started.current = false;
    setError(null);
    setDone(false);
    setGeneratedAt("");
    setCharts(null);
    setSteps([]);
    setSections([]);
    setRetryToken((v) => v + 1);
  }, []);

  useEffect(() => {
    startAnalysis();
  }, [startAnalysis, retryToken]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#262626] bg-[#0f0f0f]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
          >
            Dolph
          </Link>
          <span className="text-neutral-600">|</span>
          <span className="text-sm text-neutral-400 font-mono">
            {tickers.join(", ")}
          </span>
          {!done && !error && (
            <span className="text-xs text-cyan-400 animate-pulse-slow">analyzing...</span>
          )}
          {done && (
            <span className="text-xs text-green-400">complete</span>
          )}
          {error && (
            <span className="text-xs text-red-400">error</span>
          )}
        </div>
        <ExportButtons sections={sections} tickers={tickers} />
      </header>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left: Timeline */}
        <aside className="w-72 flex-shrink-0 border-r border-[#262626] p-4 overflow-y-auto bg-[#0c0c0c]">
          <AnalysisTimeline steps={steps} />
        </aside>

        {/* Right: Report */}
        <main className="flex-1 p-8 overflow-y-auto max-w-4xl">
          {error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 text-sm font-medium">Analysis Error</p>
              <p className="text-red-300/70 text-sm mt-1">{error}</p>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="text-sm text-cyan-400 hover:underline"
                >
                  Retry
                </button>
                <Link href="/" className="text-sm text-neutral-400 hover:underline">
                  &larr; Back
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ReportView
                sections={sections}
                tickers={tickers}
                generatedAt={generatedAt}
              />
              {charts && (
                <ChartDisplay
                  revenueMarginChart={charts.revenueMarginChart}
                  fcfBridgeChart={charts.fcfBridgeChart}
                  peerScorecardChart={charts.peerScorecardChart}
                  returnLeverageChart={charts.returnLeverageChart}
                  growthDurabilityChart={charts.growthDurabilityChart}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="px-6 py-2 text-center text-xs text-neutral-600 border-t border-[#262626]">
        Data sourced from SEC EDGAR. This analysis is generated from public SEC filings and is not financial advice.
      </footer>
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-neutral-400">Loading analysis...</div>}>
      <AnalysisPageContent />
    </Suspense>
  );
}
