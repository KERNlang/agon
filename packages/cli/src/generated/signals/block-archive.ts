// @kern-source: block-archive:5
import { appendFileSync, mkdirSync } from 'node:fs';

// @kern-source: block-archive:6
import { join, dirname } from 'node:path';

// @kern-source: block-archive:7
import { RUNS_DIR } from '@agon/core';

// @kern-source: block-archive:8
import type { OutputBlock } from '../blocks/engine.js';

// @kern-source: block-archive:10
export const MAX_LIVE_BLOCKS: number = 500;

// @kern-source: block-archive:13
export const ARCHIVE_BATCH: number = 100;

// @kern-source: block-archive:16
/**
 * Per-session archive path under RUNS_DIR. Safe to call repeatedly — same sessionStartTime yields the same path.
 */
export function makeBlockArchivePath(sessionStartTime: number): string {
  const dir = join(RUNS_DIR, `live-${sessionStartTime}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'transcript.ndjson');
}

// @kern-source: block-archive:24
/**
 * Append blocks as NDJSON. Fire-and-forget: logs a warning on failure but never throws.
 */
export function archiveBlocks(archivePath: string, blocks: OutputBlock[]): void {
  if (blocks.length === 0) return;
  try {
    mkdirSync(dirname(archivePath), { recursive: true });
    const lines = blocks.map(b => JSON.stringify({ id: b.id, event: b.event })).join('\n') + '\n';
    appendFileSync(archivePath, lines);
  } catch (err) {
    console.warn(`[agon] block archive write failed (${archivePath}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// @kern-source: block-archive:39
export function appendBlockWithCap(prev: OutputBlock[], block: OutputBlock, archivePath: string): OutputBlock[] {
  const next = [...prev, block];
  if (next.length <= MAX_LIVE_BLOCKS) return next;
  const overflow = next.length - MAX_LIVE_BLOCKS + ARCHIVE_BATCH;
  archiveBlocks(archivePath, next.slice(0, overflow));
  return next.slice(overflow);
}

