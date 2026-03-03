/**
 * File-based caching for EDGAR API responses.
 * Cache directory: ~/.filinglens/cache/{namespace}/{hash}.json
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CACHE_DIR } from '@filinglens/shared';

function resolveCacheDir(): string {
  const dir = process.env['FILINGLENS_CACHE_DIR'] || DEFAULT_CACHE_DIR;
  return dir.replace(/^~/, homedir());
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export class FileCache {
  private baseDir: string;

  constructor() {
    this.baseDir = resolveCacheDir();
  }

  private getPath(namespace: string, key: string): string {
    return join(this.baseDir, namespace, `${hashKey(key)}.json`);
  }

  async get<T>(namespace: string, key: string, ttlMs: number): Promise<T | null> {
    const path = this.getPath(namespace, key);

    try {
      const info = await stat(path);
      const age = Date.now() - info.mtimeMs;

      if (age > ttlMs) {
        return null; // expired
      }

      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as T;
    } catch {
      return null; // not found or parse error
    }
  }

  async set(namespace: string, key: string, data: unknown): Promise<void> {
    const path = this.getPath(namespace, key);
    const dir = join(this.baseDir, namespace);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path, JSON.stringify(data), 'utf-8');
    } catch (err) {
      // Cache write failure is non-critical
      console.error(`Cache write failed for ${namespace}/${key}:`, err);
    }
  }
}

// Singleton instance
export const fileCache = new FileCache();
