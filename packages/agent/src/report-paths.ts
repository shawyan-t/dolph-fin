import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function defaultReportsDir(): string {
  return resolve(fileURLToPath(new URL('../reports', import.meta.url)));
}

export function defaultFilingsDir(): string {
  return resolve(defaultReportsDir(), 'filings');
}
