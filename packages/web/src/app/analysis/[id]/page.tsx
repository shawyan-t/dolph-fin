"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AnalysisTimeline } from "@/components/AnalysisTimeline";
import { ReportView } from "@/components/ReportView";
import { ExportButtons } from "@/components/ExportButtons";
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

export default function AnalysisPage() {
  const searchParams = useSearchParams();
  const tickers = (searchParams.get("tickers") || "").split(",").filter(Boolean);
  const type = (searchParams.get("type") || "single") as "single" | "comparison";

  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const started = useRef(false);

  const startAnalysis = useCallback(async () => {
    if (started.current || tickers.length === 0) return;
    started.current = true;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, type }),
      });

      if (!response.ok || !response.body) {
        setError("Failed to start analysis");
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
    }
  }, [tickers, type]);

  useEffect(() => {
    startAnalysis();
  }, [startAnalysis]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#262626] bg-[#0f0f0f]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
          >
            FilingLens
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
              <Link href="/" className="inline-block mt-3 text-sm text-cyan-400 hover:underline">
                &larr; Try again
              </Link>
            </div>
          ) : (
            <ReportView
              sections={sections}
              tickers={tickers}
              generatedAt={generatedAt}
            />
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
