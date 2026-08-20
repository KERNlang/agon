import { appendFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { RUNS_DIR } from '@kernlang/agon-core';

import type { OutputBlock } from '../blocks/engine.js';

export const MAX_LIVE_BLOCKS: number = 500;

export const ARCHIVE_BATCH: number = 100;

/**
 * Per-session archive path under RUNS_DIR. PURE — computes the path only; the dir is created lazily by archiveBlocks on the first real spill. (Must stay side-effect-free: it is evaluated in a useRef initializer that React re-runs on EVERY render, so a mkdirSync here created one empty live-<ts> dir per keystroke.)
 */
export function makeBlockArchivePath(sessionStartTime: number): string {
  const dir = join(RUNS_DIR, `live-${sessionStartTime}`);
  return join(dir, 'transcript.ndjson');
}

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

let droppedBlockTotal = 0;

/**
 * Blocks the cap has dropped off the FRONT of the live transcript in this
 * process. The array length alone cannot express this (a spill drops N and
 * appends 1 in the same step), and Ink's <Static> indexes by position, so the
 * renderer needs the exact front-drop to keep its print cursor aligned. Never
 * reset on /clear: <Static> remounts under a new key there and its cursor
 * restarts at 0, so a permanent offset stays consistent.
 */
export function transcriptDroppedTotal(): number {
  return droppedBlockTotal;
}

/** Test-only: reset the process-wide front-drop counter. */
export function resetTranscriptDroppedTotal(): void {
  droppedBlockTotal = 0;
}

export function appendBlockWithCap(prev: OutputBlock[], block: OutputBlock, archivePath: string): OutputBlock[] {
  const next = [...prev, block];
  if (next.length <= MAX_LIVE_BLOCKS) {
    return next;
  }
  const overflow = next.length - MAX_LIVE_BLOCKS + ARCHIVE_BATCH;
  archiveBlocks(archivePath, next.slice(0, overflow));
  droppedBlockTotal += overflow;
  return next.slice(overflow);
}

/**
 * Next <Static> remount epoch. Only a true transcript reset advances it; append and cap-spill leave it untouched (a spill must NOT repaint the sealed Static region).
 */
export function nextStaticEpoch(currentEpoch: number, cause: 'append'|'spill'|'reset'): number {
  if (cause === 'reset') {
    return currentEpoch + 1;
  }
  return currentEpoch;
}
