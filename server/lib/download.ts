import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type DownloadRequest = { url: string; headers?: Readonly<Record<string, string>>; timeoutMs?: number };

export async function downloadFile(
  source: string | DownloadRequest,
  destination: string,
): Promise<number> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  fs.rmSync(temporary, { force: true });

  try {
    const request = typeof source === 'string' ? { url: source } : source;
    const response = await fetch(request.url, {
      signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
      headers: { 'User-Agent': 'transit-3d/0.2', ...request.headers },
    });

    if (!response.ok) {
      throw new Error(
        `Download failed: HTTP ${response.status}`,
      );
    }

    if (!response.body) throw new Error('Download failed: empty response body');
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), fs.createWriteStream(temporary, { flags: 'wx' }));

  const size = fs.statSync(temporary).size;

  if (size <= 0) {
    fs.rmSync(temporary, { force: true });
    throw new Error('Downloaded file is empty');
  }

  fs.renameSync(temporary, destination);
  return size;
  } finally { fs.rmSync(temporary, { force: true }); }
}
