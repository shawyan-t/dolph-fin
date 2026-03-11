import { NextRequest } from 'next/server';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { registerArtifact } from '@/lib/artifact-store';
import { loadDolphEnv } from '@/lib/dolph-env';
import { buildFilingBundleZip } from '@shawyan/mcp-sec-server/edgar/filing-directory.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FilingRecordSchema = z.object({
  accession_number: z.string().min(1),
  document_url: z.string().url(),
  company_name: z.string().optional(),
  filing_type: z.string(),
  date_filed: z.string(),
});

const FilingZipRequestSchema = z.object({
  filings: z.array(FilingRecordSchema).min(1).max(15),
  label: z.string().optional(),
});

function sanitizePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function runZip(directory: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/zip', ['-rq', outputPath, '.'], { cwd: directory });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `zip exited with status ${code}`));
      }
    });
  });
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

  const parsed = FilingZipRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.issues.map((issue) => issue.message) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let workingDir = '';
  try {
    workingDir = await mkdtemp(join(tmpdir(), 'dolph-filings-zip-'));
    const filesDir = join(workingDir, 'filings');
    await mkdir(filesDir, { recursive: true });

    for (const filing of parsed.data.filings) {
      const bundle = await buildFilingBundleZip({
        accessionNumber: filing.accession_number,
        documentUrl: filing.document_url,
        companyName: filing.company_name,
        filingType: filing.filing_type,
        dateFiled: filing.date_filed,
      });
      await copyFile(bundle.zipPath, join(filesDir, bundle.filename));
    }

    const outDir = join(tmpdir(), 'dolph-web-zips');
    await mkdir(outDir, { recursive: true });
    const zipBase = sanitizePart(parsed.data.label || 'sec_filings_export') || 'sec_filings_export';
    const zipPath = join(outDir, `${zipBase}.zip`);
    await rm(zipPath, { force: true }).catch(() => undefined);
    await runZip(filesDir, zipPath);

    const artifact = await registerArtifact(zipPath, `${zipBase}.zip`, 'application/zip');
    await rm(workingDir, { recursive: true, force: true });
    return Response.json({ artifact });
  } catch (error) {
    if (workingDir) {
      await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to build filings ZIP' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
