import { NextRequest } from 'next/server';
import { z } from 'zod';
import { searchFilings } from '@shawyan/mcp-sec-server/tools/search-filings.js';
import { loadDolphEnv } from '@/lib/dolph-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  ticker: z.string().max(10).optional(),
  date_range: z.enum(['last_year', 'last_3_years', 'all_time']).default('last_year'),
});

function buildDateRange(dateRange: 'last_year' | 'last_3_years' | 'all_time') {
  const today = new Date();
  if (dateRange === 'all_time') return { date_from: undefined, date_to: undefined };
  const start = new Date(today);
  start.setUTCFullYear(today.getUTCFullYear() - (dateRange === 'last_3_years' ? 3 : 1));
  const date_from = start.toISOString().slice(0, 10);
  const date_to = today.toISOString().slice(0, 10);
  return { date_from, date_to };
}

export async function POST(request: NextRequest) {
  await loadDolphEnv();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.issues.map((issue) => issue.message) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const range = buildDateRange(parsed.data.date_range);
    const results = await searchFilings({
      query: parsed.data.query,
      ticker: parsed.data.ticker || undefined,
      ...range,
      limit: 15,
    });

    return Response.json({ results });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
