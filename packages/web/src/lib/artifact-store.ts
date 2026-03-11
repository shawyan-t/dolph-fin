import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

interface ArtifactRecord {
  filePath: string;
  filename: string;
  contentType: string;
  createdAt: number;
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6;
const artifactStore = new Map<string, ArtifactRecord>();
const artifactStateDir = join(tmpdir(), 'dolph-web-artifacts');

async function ensureArtifactStateDir(): Promise<void> {
  await mkdir(artifactStateDir, { recursive: true });
}

function tokenPath(token: string): string {
  return join(artifactStateDir, `${token}.json`);
}

function cleanupExpiredArtifacts(): void {
  const now = Date.now();
  artifactStore.forEach((artifact, token) => {
    if (now - artifact.createdAt > DEFAULT_TTL_MS) {
      artifactStore.delete(token);
    }
  });
}

function inferContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.csv') return 'text/csv; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

export async function registerArtifact(filePath: string, filename?: string, contentType?: string): Promise<{ token: string; filename: string; contentType: string }> {
  await access(filePath);
  await ensureArtifactStateDir();
  cleanupExpiredArtifacts();
  const token = randomUUID();
  const record: ArtifactRecord = {
    filePath,
    filename: filename || basename(filePath),
    contentType: contentType || inferContentType(filePath),
    createdAt: Date.now(),
  };
  artifactStore.set(token, record);
  await writeFile(tokenPath(token), JSON.stringify(record), 'utf8');
  return { token, filename: record.filename, contentType: record.contentType };
}

export async function getArtifact(token: string): Promise<ArtifactRecord | null> {
  cleanupExpiredArtifacts();
  const inMemory = artifactStore.get(token);
  if (inMemory) return inMemory;
  try {
    const raw = await readFile(tokenPath(token), 'utf8');
    const artifact = JSON.parse(raw) as ArtifactRecord;
    artifactStore.set(token, artifact);
    return artifact;
  } catch {
    return null;
  }
}

export async function readArtifactUtf8(token: string): Promise<string | null> {
  const artifact = await getArtifact(token);
  if (!artifact) return null;
  return readFile(artifact.filePath, 'utf8');
}

export async function openArtifactStream(token: string): Promise<{ stream: ReturnType<typeof createReadStream>; artifact: ArtifactRecord } | null> {
  const artifact = await getArtifact(token);
  if (!artifact) return null;
  return {
    stream: createReadStream(artifact.filePath),
    artifact,
  };
}
