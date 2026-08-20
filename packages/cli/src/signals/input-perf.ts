import { appendFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { AGON_HOME } from '@kernlang/agon-core';

export const PERF_ENABLED: boolean = process.env.AGON_PERF === '1';

export const PERF_PATH: string = join(AGON_HOME, 'perf', 'input-latency.ndjson');


export function perfNow(): number {
  return PERF_ENABLED ? performance.now() : 0;
}

/**
 * Append one keystroke→commit latency sample as NDJSON. No-op unless AGON_PERF=1 and a valid t0 was captured.
 */
export function recordKeystrokeLatency(t0: number, blocks: number, archive: number, live: number, inputLen: number): void {
  if (!PERF_ENABLED || !t0) return;
  try {
    const dtMs = Math.round((performance.now() - t0) * 100) / 100;
    const line = JSON.stringify({ ts: Date.now(), dtMs, blocks, archive, live, inputLen }) + '\n';
    mkdirSync(dirname(PERF_PATH), { recursive: true });
    appendFileSync(PERF_PATH, line);
  } catch { /* perf logging is best-effort; never disrupt input */ }
}
