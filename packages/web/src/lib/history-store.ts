import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import type { Report } from "@dolph/shared";

export interface StoredCharts {
  revenueMarginChart: string | null;
  fcfBridgeChart: string | null;
  peerScorecardChart: string | null;
  returnLeverageChart: string | null;
  growthDurabilityChart: string | null;
}

export interface StoredAnalysisRecord {
  id: string;
  created_at: string;
  updated_at: string;
  tickers: string[];
  type: "single" | "comparison";
  snapshot_date?: string;
  report: Report;
  charts?: StoredCharts;
}

const HISTORY_DIR = resolve(process.cwd(), process.env["DOLPH_HISTORY_DIR"] || "reports/history");

function sanitizeId(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return null;
  return id;
}

function recordPath(id: string): string {
  return resolve(HISTORY_DIR, `${id}.json`);
}

export async function loadAnalysisRecord(id: string): Promise<StoredAnalysisRecord | null> {
  const safeId = sanitizeId(id);
  if (!safeId) return null;

  try {
    const raw = await readFile(recordPath(safeId), "utf-8");
    const parsed = JSON.parse(raw) as StoredAnalysisRecord;
    if (!parsed || parsed.id !== safeId || !parsed.report) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAnalysisRecord(record: StoredAnalysisRecord): Promise<void> {
  const safeId = sanitizeId(record.id);
  if (!safeId) {
    throw new Error(`Invalid analysis id: ${record.id}`);
  }

  await mkdir(HISTORY_DIR, { recursive: true });
  const finalPath = recordPath(safeId);
  const tmpPath = `${finalPath}.tmp-${Date.now()}`;
  const payload = JSON.stringify(record, null, 2);
  await writeFile(tmpPath, payload, "utf-8");
  await rename(tmpPath, finalPath);
}
