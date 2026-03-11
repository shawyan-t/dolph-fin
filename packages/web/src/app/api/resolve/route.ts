import { NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveTickerWithConfidence } from '@dolph/mcp-sec-server/resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ResolveRequestSchema = z.object({
  query: z.string().min(1).max(120),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = ResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.issues.map(issue => issue.message) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await resolveTickerWithConfidence(parsed.data.query);
    if (!result) {
      return new Response(JSON.stringify({ error: `Could not resolve \"${parsed.data.query}\"` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json({ result });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Resolution failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
