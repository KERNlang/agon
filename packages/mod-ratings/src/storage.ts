import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { RatingRecord } from './types.js';

/** Preserve legacy normalization. Callers retain their error-reporting policy. */
export function readRatingsFile(resolvePath: () => string, onError?: (error: unknown) => void): unknown {
  try {
    const record = JSON.parse(readFileSync(resolvePath(), 'utf8')) as RatingRecord;
    record.global ??= {};
    record.byMode ??= { forge: {}, brainstorm: {}, tribunal: {}, critique: {} };
    for (const mode of ['forge', 'brainstorm', 'tribunal', 'critique'] as const) record.byMode[mode] ??= {};
    record.byTaskClass ??= {};
    record.engineMeta ??= {};
    return record;
  } catch (error) {
    onError?.(error);
    return { global: {}, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} },
      byTaskClass: {}, engineMeta: {}, lastUpdated: new Date().toISOString() };
  }
}

/** The caller holds the ratings lock during a read-modify-write operation. */
export function writeRatingsFile(path: string, record: unknown, temporary: string): void {
  writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
  renameSync(temporary, path);
}
