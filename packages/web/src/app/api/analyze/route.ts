import { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.DOLPH_WEB_RATE_LIMIT_MAX || "10", 10);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = rateLimitStore.get(ip);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

function cleanupRateLimitStore(): void {
  const now = Date.now();
  rateLimitStore.forEach((entry, ip) => {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  });
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Request body schema — validated before pipeline runs */
const AnalyzeRequestSchema = z.object({
  tickers: z
    .array(z.string().min(1).max(10).regex(/^[A-Za-z0-9][A-Za-z0-9.\-]{0,9}$/))
    .min(1)
    .max(5),
  type: z.enum(["single", "comparison"]),
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: NextRequest) {
  cleanupRateLimitStore();

  const apiKey = process.env.DOLPH_WEB_API_KEY;
  if (apiKey) {
    const provided = request.headers.get("x-api-key");
    if (!provided || provided !== apiKey) {
      return unauthorized("Unauthorized");
    }
  }

  const allowedOrigin = process.env.DOLPH_WEB_ALLOWED_ORIGIN;
  const origin = request.headers.get("origin");
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Invalid request",
        details: parsed.error.issues.map((i) => i.message),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { tickers: rawTickers, type, snapshot_date } = parsed.data;
  const { resolveTickerWithConfidence } = await import(
    "@dolph/mcp-sec-server/resolver"
  );

  const tickers: string[] = [];
  for (const raw of rawTickers) {
    const resolved = await resolveTickerWithConfidence(raw);
    if (!resolved) {
      return new Response(JSON.stringify({
        error: `Could not resolve ticker "${raw}"`,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (resolved.confidence < 0.7) {
      return new Response(JSON.stringify({
        error: `Ticker "${raw}" is ambiguous`,
        best_match: resolved.ticker,
        alternatives: resolved.alternatives.map(a => a.ticker),
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    tickers.push(resolved.ticker);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let disconnected = false;
      request.signal.addEventListener("abort", () => {
        disconnected = true;
      });

      const ensureConnected = () => {
        if (disconnected || request.signal.aborted) {
          throw new Error("Client disconnected");
        }
      };

      const send = (eventType: string, data: unknown) => {
        if (disconnected) return;
        try {
          const payload = `data: ${JSON.stringify({ type: eventType, data })}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client disconnected — ignore enqueue errors
        }
      };

      try {
        const { runPipeline } = await import("@dolph/agent/pipeline");
        const { createLLMProvider, getLLMConfig } = await import(
          "@dolph/agent/llm/provider"
        );

        const llmConfig = getLLMConfig();
        const llm = createLLMProvider(llmConfig);

        await runPipeline(
          {
            tickers,
            type,
            maxRetries: 2,
            maxValidationLoops: 2,
            snapshotDate: snapshot_date,
          },
          llm,
          {
            onStep(step, status, detail) {
              ensureConnected();
              send("step", { step, status, detail });
            },
            onPartialReport(sectionId, content) {
              ensureConnected();
              send("partial_report", { section: sectionId, content });
            },
            async onComplete(report, context) {
              ensureConnected();
              // Send charts if context available
              if (context) {
                try {
                  const { generateCharts } = await import("@dolph/agent/dist/charts.js");
                  const charts = generateCharts(context);
                  send("charts", {
                    revenueMarginChart: charts.revenueMarginChart,
                    fcfBridgeChart: charts.fcfBridgeChart,
                    peerScorecardChart: charts.peerScorecardChart,
                    returnLeverageChart: charts.returnLeverageChart,
                    growthDurabilityChart: charts.growthDurabilityChart,
                  });
                } catch {
                  // Chart generation failure is non-fatal
                }
              }
              ensureConnected();
              send("final_report", report);
            },
            onError(error) {
              if (disconnected) return;
              send("error", { message: error });
            },
          },
        );
      } catch (err) {
        if (!disconnected) {
          send("error", {
            message: err instanceof Error ? err.message : "Analysis failed",
          });
        }
      } finally {
        if (!disconnected) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
