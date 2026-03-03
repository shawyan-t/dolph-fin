import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tickers, type } = body as { tickers: string[]; type: "single" | "comparison" };

  if (!tickers || tickers.length === 0) {
    return new Response(JSON.stringify({ error: "No tickers provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create a readable stream for SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (eventType: string, data: unknown) => {
        const payload = `data: ${JSON.stringify({ type: eventType, data })}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        // Dynamic import to avoid bundling issues
        const { runPipeline } = await import("@filinglens/agent/pipeline");
        const { createLLMProvider, getLLMConfig } = await import("@filinglens/agent/dist/llm/provider.js");

        const llmConfig = getLLMConfig();
        const llm = createLLMProvider(llmConfig);

        const result = await runPipeline(
          {
            tickers,
            type,
            maxRetries: 2,
            maxValidationLoops: 2,
          },
          llm,
          {
            onStep(step, status, detail) {
              send("step", { step, status, detail });
            },
            onPartialReport(sectionId, content) {
              send("partial_report", { section: sectionId, content });
            },
            onComplete(report) {
              send("final_report", report);
            },
            onError(error) {
              send("error", { message: error });
            },
          },
        );

        // Final report event
        send("final_report", result.report);
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Analysis failed",
        });
      } finally {
        controller.close();
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
