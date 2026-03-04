"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TickerInput } from "@/components/TickerInput";

export default function Home() {
  const router = useRouter();
  const [tickers, setTickers] = useState<string[]>([]);
  const [analysisType, setAnalysisType] = useState<"single" | "comparison">("single");
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (tickers.length === 0) return;
    setLoading(true);

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const params = new URLSearchParams({
      tickers: tickers.join(","),
      type: analysisType,
    });
    if (snapshotDate) {
      params.set("snapshot_date", snapshotDate);
    }

    router.push(`/analysis/${id}?${params.toString()}`);
  }, [tickers, analysisType, snapshotDate, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 via-purple-400 to-yellow-400 bg-clip-text text-transparent mb-3">
          Dolph
        </h1>
        <p className="text-lg text-neutral-400">
          AI-powered SEC filing analysis
        </p>
      </div>

      <div className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-xl p-6 shadow-2xl">
        <div className="flex mb-6 bg-[#0a0a0a] rounded-lg p-1">
          <button
            onClick={() => {
              setAnalysisType("single");
              setTickers(tickers.slice(0, 1));
            }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              analysisType === "single"
                ? "bg-[#262626] text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Single Company
          </button>
          <button
            onClick={() => setAnalysisType("comparison")}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              analysisType === "comparison"
                ? "bg-[#262626] text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Compare Companies
          </button>
        </div>

        <TickerInput
          tickers={tickers}
          setTickers={setTickers}
          maxTickers={analysisType === "comparison" ? 5 : 1}
        />

        <div className="mt-4">
          <label className="block text-xs text-neutral-400 mb-1">Snapshot Date (optional)</label>
          <input
            type="date"
            value={snapshotDate}
            onChange={(e) => setSnapshotDate(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-2 text-sm text-neutral-200"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={tickers.length === 0 || loading}
          className={`w-full mt-6 py-3 rounded-lg font-semibold text-sm transition-all ${
            tickers.length === 0 || loading
              ? "bg-[#262626] text-neutral-500 cursor-not-allowed"
              : "bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:opacity-90 active:scale-[0.98]"
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Starting analysis...
            </span>
          ) : (
            `Run Analysis${tickers.length > 0 ? ` \u2014 ${tickers.join(", ")}` : ""}`
          )}
        </button>
      </div>

      <p className="mt-8 text-xs text-neutral-600">
        Data sourced from SEC EDGAR. Not financial advice.
      </p>
    </main>
  );
}
