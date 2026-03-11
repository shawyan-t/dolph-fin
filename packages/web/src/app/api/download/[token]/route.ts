import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { openArtifactStream } from '@/lib/artifact-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, '_');
  return `attachment; filename="${safe}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } },
) {
  const artifactResult = await openArtifactStream(params.token);
  if (!artifactResult) {
    return new Response(JSON.stringify({ error: 'Download not found or expired' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const requestedFilename = request.nextUrl.searchParams.get('filename');
  const filename = requestedFilename || artifactResult.artifact.filename;

  return new Response(Readable.toWeb(artifactResult.stream) as ReadableStream, {
    headers: {
      'Content-Type': artifactResult.artifact.contentType,
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'no-store',
    },
  });
}
