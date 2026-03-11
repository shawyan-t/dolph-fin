import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listPreviewableFilingFiles, previewFilingFile } from '@shawyan/mcp-sec-server/edgar/filing-directory.js';
import { loadDolphEnv } from '@/lib/dolph-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FilingRequestSchema = z.object({
  accession_number: z.string().min(1),
  document_url: z.string().url(),
  file_path: z.string().optional(),
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

  const parsed = FilingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.issues.map((issue) => issue.message) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (!parsed.data.file_path) {
      const files = await listPreviewableFilingFiles(parsed.data.document_url);
      return Response.json({
        mode: 'files',
        files: files.map((file) => ({
          name: file.name,
          relative_path: file.relativePath,
        })),
      });
    }

    const file = await previewFilingFile(parsed.data.document_url, parsed.data.file_path);
    return Response.json({
      mode: 'file',
      file: {
        name: file.name,
        relative_path: file.relativePath,
        content: file.content,
        truncated: file.truncated,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to preview filing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
