import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  recordApiLoopDispatch,
  recordTextTransportDispatch,
  readDelegateLedgerRecords,
  summarizeDelegateReliability,
  summarizeDelegateReliabilityByEngine,
  deriveOutcomeCounts,
  buildApiLoopDigest,
  textTransportDigest,
  formatDelegateReliability,
  formatAllDelegateReliability,
  delegateLedgerPath,
} from '../../packages/core/src/generated/signals/delegate-ledger.js';
import type { AgentToolOutcome } from '../../packages/core/src/generated/signals/delegate-ledger.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

const native = (tool: string, status: AgentToolOutcome['status']): AgentToolOutcome => ({
  tool,
  status,
  durationMs: 1,
  provenance: 'native',
});

const stall = (): AgentToolOutcome => ({
  tool: 'narrated-stall',
  status: 'unknown',
  durationMs: 0,
  provenance: 'heuristic',
});

describe('delegate-ledger', () => {
  let home: string;
  beforeEach(() => { home = setupTestAgonHome('delegate-ledger'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('records an api-loop dispatch and summarizes the round-trip (3 outcomes: 2 ok, 1 error)', () => {
    const outcomes = [native('Read', 'ok'), native('Grep', 'ok'), native('Bash', 'error')];
    const record = recordApiLoopDispatch('gpt-x', 'agent', outcomes);

    // Ledger holds exactly one record with 3 native outcomes.
    const records = readDelegateLedgerRecords();
    expect(records).toHaveLength(1);
    expect(records[0].engineId).toBe('gpt-x');
    expect(records[0].backend).toBe('api-loop');
    expect(records[0].outcomes).toHaveLength(3);
    expect(records[0].outcomes.every((o) => o.provenance === 'native')).toBe(true);
    expect(records[0].counts).toEqual({ total: 3, ok: 2, error: 1, timeout: 0, unknown: 0, narratedStalls: 0, dispatchFailed: 0 });

    // Acceptance: the digest line reads "3 tool calls: 2 ok, 1 failed".
    const digest = buildApiLoopDigest(record.counts);
    expect(digest).toContain('3 tool calls: 2 ok, 1 failed');

    // Per-backend summary reflects the same numbers.
    const summary = summarizeDelegateReliability('gpt-x');
    expect(summary.dispatches).toBe(1);
    expect(summary.backends).toHaveLength(1);
    const apiLoop = summary.backends[0];
    expect(apiLoop.backend).toBe('api-loop');
    expect(apiLoop.hasPerCallVisibility).toBe(true);
    expect(apiLoop).toMatchObject({ dispatches: 1, toolCalls: 3, ok: 2, error: 1 });

    const lines = formatDelegateReliability(summary);
    expect(lines.join('\n')).toContain('(native)');
    expect(lines.join('\n')).toContain('2 ok, 1 failed');
  });

  it('returns empty results when the ledger file is missing (never throws)', () => {
    expect(readDelegateLedgerRecords()).toEqual([]);
    const summary = summarizeDelegateReliability();
    expect(summary).toEqual({ engineId: 'all', dispatches: 0, backends: [] });
    expect(formatDelegateReliability(summary)).toEqual(['no ledger records yet']);
  });

  it('skips a corrupt tail line without dropping valid records', () => {
    recordApiLoopDispatch('eng-a', 'agent', [native('Read', 'ok')]);
    // A partially-written / garbage line at the tail must never poison the read.
    appendFileSync(delegateLedgerPath(), '{ this is not valid json\n');
    recordApiLoopDispatch('eng-a', 'agent', [native('Grep', 'ok')]);

    const records = readDelegateLedgerRecords();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.outcomes[0].tool)).toEqual(['Read', 'Grep']);
  });

  it('keeps backends strictly separate — an api-loop failure never pollutes cli-print stats', () => {
    // Same engine, two transports: an api-loop run that failed a tool, and a
    // text-only (cli-print) delegate with no per-call visibility.
    recordApiLoopDispatch('eng-b', 'agent', [native('Bash', 'error')]);
    recordTextTransportDispatch('eng-b', 'exec', 'cli-print');

    const summary = summarizeDelegateReliability('eng-b');
    expect(summary.dispatches).toBe(2);
    const byBackend = Object.fromEntries(summary.backends.map((b) => [b.backend, b]));

    // api-loop carries the real failure and per-call visibility.
    expect(byBackend['api-loop'].error).toBe(1);
    expect(byBackend['api-loop'].hasPerCallVisibility).toBe(true);
    expect(byBackend['api-loop'].unknown).toBe(0);

    // cli-print carries NO fabricated ok/error — only an unknown dispatch tally.
    expect(byBackend['cli-print'].hasPerCallVisibility).toBe(false);
    expect(byBackend['cli-print'].ok).toBe(0);
    expect(byBackend['cli-print'].error).toBe(0);
    expect(byBackend['cli-print'].unknown).toBe(1);

    const lines = formatDelegateReliability(summary).join('\n');
    expect(lines).toContain('[cli-print]');
    expect(lines).toContain('no per-call visibility on this transport');
  });

  it('deriveOutcomeCounts tallies unknown for unrecognized statuses; textTransportDigest is honest', () => {
    const counts = deriveOutcomeCounts([
      native('Read', 'ok'),
      native('Bash', 'timeout'),
      { tool: 'x', status: 'weird' as any, provenance: 'native' },
    ]);
    expect(counts).toEqual({ total: 3, ok: 1, error: 0, timeout: 1, unknown: 1, narratedStalls: 0, dispatchFailed: 0 });
    expect(textTransportDigest()).toBe('no per-call visibility on this transport');
  });

  it('separates records by engineId (no cross-engine bleed)', () => {
    recordApiLoopDispatch('eng-1', 'agent', [native('Read', 'ok')]);
    recordApiLoopDispatch('eng-2', 'agent', [native('Bash', 'error')]);

    const s1 = summarizeDelegateReliability('eng-1');
    expect(s1.dispatches).toBe(1);
    expect(s1.backends[0].ok).toBe(1);
    expect(s1.backends[0].error).toBe(0);

    const all = summarizeDelegateReliability();
    expect(all.dispatches).toBe(2);
  });

  // ── Finding 1: per-engine grouping must NOT merge engines by backend ──
  it('summarizeDelegateReliabilityByEngine never merges two engines on the same backend', () => {
    // Two DIFFERENT engines, both on api-loop. The old all-engine summary merged
    // them into one api-loop bucket (2 dispatches, 2 tool calls) and lost the
    // per-engine signal; the by-engine view keeps each engine separate.
    recordApiLoopDispatch('eng-fast', 'agent', [native('Read', 'ok'), native('Grep', 'ok')]);
    recordApiLoopDispatch('eng-flaky', 'agent', [native('Bash', 'error')]);

    const perEngine = summarizeDelegateReliabilityByEngine();
    expect(perEngine).toHaveLength(2);
    const byId = Object.fromEntries(perEngine.map((s) => [s.engineId, s]));

    // eng-fast keeps its own 2-ok api-loop stats, untouched by eng-flaky.
    const fast = byId['eng-fast'].backends.find((b) => b.backend === 'api-loop')!;
    expect(fast).toMatchObject({ dispatches: 1, toolCalls: 2, ok: 2, error: 0 });
    // eng-flaky keeps its own single failure — NOT blended into eng-fast.
    const flaky = byId['eng-flaky'].backends.find((b) => b.backend === 'api-loop')!;
    expect(flaky).toMatchObject({ dispatches: 1, toolCalls: 1, ok: 0, error: 1 });

    // Rendered lines carry each engine id distinctly.
    const lines = formatAllDelegateReliability(perEngine).join('\n');
    expect(lines).toContain('eng-fast [api-loop]');
    expect(lines).toContain('eng-flaky [api-loop]');

    // Regression contrast: the merged 'all' summary DOES collapse both (grand
    // total), which is exactly why the renderer uses the per-engine view.
    const merged = summarizeDelegateReliability();
    const mergedApiLoop = merged.backends.find((b) => b.backend === 'api-loop')!;
    expect(mergedApiLoop).toMatchObject({ dispatches: 2, toolCalls: 3, ok: 2, error: 1 });
  });

  it('summarizeDelegateReliabilityByEngine with an engineId returns just that engine (or [] if unseen)', () => {
    recordApiLoopDispatch('eng-x', 'agent', [native('Read', 'ok')]);
    recordApiLoopDispatch('eng-y', 'agent', [native('Bash', 'error')]);

    const one = summarizeDelegateReliabilityByEngine('eng-x');
    expect(one).toHaveLength(1);
    expect(one[0].engineId).toBe('eng-x');

    expect(summarizeDelegateReliabilityByEngine('never-seen')).toEqual([]);
  });

  // ── Finding 2: heuristic narrated stalls must NOT inflate native counts ──
  it('narrated stalls (heuristic) are counted separately and never inflate the tool-call total', () => {
    // One real call + two narrated stalls in the same dispatch.
    const record = recordApiLoopDispatch('eng-stall', 'agent', [native('Read', 'ok'), stall(), stall()]);

    // total counts ONLY the native call; stalls live in narratedStalls.
    expect(record.counts).toEqual({ total: 1, ok: 1, error: 0, timeout: 0, unknown: 0, narratedStalls: 2, dispatchFailed: 0 });

    // Digest: "1 tool call" (not 3), stalls surfaced as a distinct clause.
    const digest = buildApiLoopDigest(record.counts);
    expect(digest).toContain('1 tool call: 1 ok, 0 failed (native)');
    expect(digest).not.toContain('3 tool call');
    expect(digest).toContain('2 narrated stalls (heuristic)');

    // Summary + formatter: tool calls stays 1; stalls never join ok/failed/unknown.
    const summary = summarizeDelegateReliability('eng-stall');
    const apiLoop = summary.backends.find((b) => b.backend === 'api-loop')!;
    expect(apiLoop.toolCalls).toBe(1);
    expect(apiLoop.unknown).toBe(0);
    expect(apiLoop.narratedStalls).toBe(2);

    const line = formatDelegateReliability(summary).join('\n');
    expect(line).toContain('1 tool calls'); // native total, stalls excluded
    expect(line).toContain('2 narrated stalls (heuristic)');
  });

  // ── Coordinator add-on: failed dispatch is a stronger negative than unknown ──
  it('a failed text-transport dispatch is recorded as dispatchFailed, not blended into unknown', () => {
    recordTextTransportDispatch('eng-fail', 'exec', 'cli-print', { dispatchFailed: true });

    const record = readDelegateLedgerRecords()[0];
    expect(record.counts).toEqual({ total: 0, ok: 0, error: 0, timeout: 0, unknown: 0, narratedStalls: 0, dispatchFailed: 1 });

    const summary = summarizeDelegateReliability('eng-fail');
    const cliPrint = summary.backends.find((b) => b.backend === 'cli-print')!;
    // The failure is a dispatchFailed, NOT an 'unknown' (no-visibility) tally.
    expect(cliPrint.dispatchFailed).toBe(1);
    expect(cliPrint.unknown).toBe(0);

    const lines = formatDelegateReliability(summary).join('\n');
    expect(lines).toContain('1 failed dispatch');
  });

  // ── Finding 4: schema-invalid but valid-JSON records must never throw ──
  it('never throws on schema-invalid (but valid JSON) ledger lines — skips or defaults them', () => {
    // A well-formed record first, so we can prove the good one still summarizes.
    recordApiLoopDispatch('eng-ok', 'agent', [native('Read', 'ok')]);

    // Hand-written lines that are valid JSON but violate the record schema in
    // every way the reviewer flagged: outcomes not an array (a number — the
    // for..of would throw), counts not an object, engineId not a string, and a
    // bare JSON array that is not a record object at all.
    const path = delegateLedgerPath();
    appendFileSync(path, JSON.stringify({ engineId: 'eng-bad', backend: 'api-loop', outcomes: 42, counts: 'nope' }) + '\n');
    appendFileSync(path, JSON.stringify({ engineId: { not: 'a string' }, backend: 'cli-print', counts: { total: 'x' } }) + '\n');
    appendFileSync(path, JSON.stringify([1, 2, 3]) + '\n');
    appendFileSync(path, JSON.stringify('a bare string') + '\n');
    appendFileSync(path, JSON.stringify(12345) + '\n');

    // The good record still reads back (non-object/array JSON is dropped by the reader).
    const records = readDelegateLedgerRecords();
    expect(records.some((r) => r.engineId === 'eng-ok')).toBe(true);

    // None of the summarizers throw, in any grouping.
    expect(() => summarizeDelegateReliability()).not.toThrow();
    expect(() => summarizeDelegateReliability('eng-bad')).not.toThrow();
    expect(() => summarizeDelegateReliabilityByEngine()).not.toThrow();
    expect(() => deriveOutcomeCounts(42 as any)).not.toThrow();
    expect(deriveOutcomeCounts(42 as any)).toEqual({ total: 0, ok: 0, error: 0, timeout: 0, unknown: 0, narratedStalls: 0, dispatchFailed: 0 });

    // The good engine's numbers survive intact despite the poison lines.
    const good = summarizeDelegateReliability('eng-ok');
    expect(good.backends.find((b) => b.backend === 'api-loop')!.ok).toBe(1);

    // Formatting the whole set never throws either.
    expect(() => formatAllDelegateReliability(summarizeDelegateReliabilityByEngine())).not.toThrow();
  });
});
