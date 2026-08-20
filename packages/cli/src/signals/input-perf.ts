import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

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
    // renders: cumulative per-component commit counters (AGON_RENDER_PROBE=1).
    // Consecutive samples differ by exactly the renders caused by one
    // keystroke, so the probe never has to guess where boot ended.
    const line = JSON.stringify({ ts: Date.now(), dtMs, blocks, archive, live, inputLen, renders: renderProbeCounts() }) + '\n';
    mkdirSync(dirname(PERF_PATH), { recursive: true });
    appendFileSync(PERF_PATH, line);
  } catch { /* perf logging is best-effort; never disrupt input */ }
}

// ── Render probe (AGON_RENDER_PROBE=1) ────────────────────────────────
//
// Counts React render commits per instrumented component so a scripted
// keystroke probe can answer "how many components re-render per keystroke".
// Counting is a plain object increment (no allocation, no I/O) and is gated
// behind an env flag so the normal REPL pays nothing. Counts are flushed to
// JSON on an unref'd interval and on process exit — never per render, which
// would itself dominate the measurement.

export const RENDER_PROBE_ENABLED: boolean = process.env.AGON_RENDER_PROBE === '1';

export const RENDER_PROBE_PATH: string = join(AGON_HOME, 'perf', 'render-counts.json');

const renderCounts: Record<string, number> = Object.create(null);

let renderProbeFlushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Write the accumulated render counts to RENDER_PROBE_PATH. Best-effort.
 */
export function flushRenderProbe(): void {
  if (!RENDER_PROBE_ENABLED) return;
  try {
    mkdirSync(dirname(RENDER_PROBE_PATH), { recursive: true });
    writeFileSync(RENDER_PROBE_PATH, JSON.stringify({ ts: Date.now(), counts: renderCounts }, null, 2));
  } catch { /* probe output is best-effort */ }
}

/**
 * Read the in-memory render counters (tests/diagnostics).
 */
export function renderProbeCounts(): Record<string, number> {
  return { ...renderCounts };
}

/**
 * Count one render commit of `component`. No-op unless AGON_RENDER_PROBE=1.
 */
export function countRender(component: string): void {
  if (!RENDER_PROBE_ENABLED) return;
  renderCounts[component] = (renderCounts[component] ?? 0) + 1;
  if (!renderProbeFlushTimer) {
    renderProbeFlushTimer = setInterval(flushRenderProbe, 250);
    renderProbeFlushTimer.unref?.();
    process.once('exit', flushRenderProbe);
  }
}
