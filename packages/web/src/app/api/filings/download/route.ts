import { NextRequest } from 'next/server';
import { z } from 'zod';
import { registerArtifact } from '@/lib/artifact-store';
import { loadDolphEnv } from '@/lib/dolph-env';
import { buildFilingBundleZip } from '@shawyan/mcp-sec-server/edgar/filing-directory.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FilingDownloadRequestSchema = z.object({
  accession_number: z.string().min(1),
  document_url: z.string().url(),
  company_name: z.string().optional(),
  filing_type: z.string().optional(),
  date_filed: z.string().optional(),
});

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

  const parsed = FilingDownloadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.issues.map((issue) => issue.message) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const bundle = await buildFilingBundleZip({
      accessionNumber: parsed.data.accession_number,
      documentUrl: parsed.data.document_url,
      companyName: parsed.data.company_name,
      filingType: parsed.data.filing_type,
      dateFiled: parsed.data.date_filed,
    });
    const artifact = await registerArtifact(bundle.zipPath, bundle.filename, 'application/zip');

    return Response.json({ artifact });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to download filing ZIP' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
