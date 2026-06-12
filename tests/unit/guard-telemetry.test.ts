import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
// Module A — pure fns + per-turn tracker + thresholds const.
import {
  normalizeForHash,
  contentHashOf,
  tokenSetJaccard,
  deriveGroundedWriteResolution,
  deriveGroundedWriteResolutionMulti,
  deriveCalibrationBucket,
  createTurnTracker,
  GUARD_TELEMETRY_THRESHOLDS,
} from '../../packages/core/src/generated/telemetry/guard-telemetry.js';
import type {
  GuardFireEvent,
  TurnTelemetryRecord,
} from '../../packages/core/src/generated/telemetry/guard-telemetry.js';
// Module A2 — persistence layer.
import {
  guardTelemetryDir as storeDir,
  guardTelemetryEnabled as storeEnabled,
  appendGuardTelemetry as storeAppend,
  applyGuardCounters as storeApply,
  updateGuardCounters as storeUpdate,
  readGuardCounters as storeRead,
  recommendGuardAction as storeRecommend,
} from '../../packages/core/src/generated/telemetry/guard-telemetry-store.js';
import type {
  GuardCounterCell,
} from '../../packages/core/src/generated/telemetry/guard-telemetry-store.js';

// ──────────────────────────────────────────────────────────────────────
// Pure fns — no fs, no env. These are reused live AND offline.
// ──────────────────────────────────────────────────────────────────────

describe('guard-telemetry — normalizeForHash + contentHashOf', () => {
  it('collapses whitespace and trims so cosmetic diffs hash identically', () => {
    const a = '  const x   =\t1;\n\n  return x; ';
    const b = 'const x = 1; return x;';
    expect(normalizeForHash(a)).toBe('const x = 1; return x;');
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it('caps the normalized content at 4096 chars', () => {
    const big = 'a'.repeat(5000);
    expect(normalizeForHash(big).length).toBe(4096);
  });

  it('produces a 64-hex-char sha256 digest and differs on real content change', () => {
    const h = contentHashOf('hello world');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHashOf('hello world')).toBe(h);
    expect(contentHashOf('goodbye world')).not.toBe(h);
  });
});

describe('guard-telemetry — tokenSetJaccard', () => {
  it('returns 1 for identical token sets (order/dupes ignored)', () => {
    expect(tokenSetJaccard('the quick brown fox', 'fox the brown quick the')).toBe(1);
  });

  it('returns 0 for fully disjoint token sets', () => {
    expect(tokenSetJaccard('alpha beta', 'gamma delta')).toBe(0);
  });

  it('returns 1 when both strings are empty, 0 when only one is', () => {
    expect(tokenSetJaccard('', '')).toBe(1);
    expect(tokenSetJaccard('', 'nonempty')).toBe(0);
    expect(tokenSetJaccard('nonempty', '')).toBe(0);
  });

  it('computes the intersection-over-union for partial overlap', () => {
    // {a,b,c} vs {b,c,d}: inter=2, union=4 → 0.5
    expect(tokenSetJaccard('a b c', 'b c d')).toBe(0.5);
  });
});

describe('guard-telemetry — deriveGroundedWriteResolution', () => {
  it('ceremony: same path, re-issued near-identical content (jaccard ≥ 0.9)', () => {
    const fire = { path: '/x.ts', rawContent: 'export const x = 1; return x;' };
    const later = [{ path: '/x.ts', rawContent: 'export const x = 1; return x;', ok: true }];
    const r = deriveGroundedWriteResolution(fire, later);
    expect(r.label).toBe('ceremony');
    expect(r.observedInTurn).toBe(true);
    expect(r.divergence).toBeCloseTo(0, 5); // 1 - jaccard, jaccard == 1
  });

  it('prevented: same path but materially different content (low jaccard)', () => {
    const fire = { path: '/x.ts', rawContent: 'export const x = 1;' };
    const later = [{ path: '/x.ts', rawContent: 'completely different replacement body here', ok: true }];
    const r = deriveGroundedWriteResolution(fire, later);
    expect(r.label).toBe('prevented');
    expect(r.observedInTurn).toBe(true);
    expect(r.divergence).toBeGreaterThan(0.1);
  });

  it('redirected: a later write only to a DIFFERENT path', () => {
    const fire = { path: '/x.ts', rawContent: 'export const x = 1;' };
    const later = [{ path: '/y.ts', rawContent: 'export const y = 2;', ok: true }];
    const r = deriveGroundedWriteResolution(fire, later);
    expect(r.label).toBe('redirected');
    expect(r.observedInTurn).toBe(true);
  });

  it('averted: no later write but the turn finished normally', () => {
    const fire = { path: '/x.ts', rawContent: 'export const x = 1;' };
    const r = deriveGroundedWriteResolution(fire, []);
    expect(r.label).toBe('averted');
    expect(r.observedInTurn).toBe(true);
  });

  it('unresolved/only-failed-writes: a FAILED same-path re-issue is NOT ceremony evidence', () => {
    // The model re-issued the blocked write to the SAME path near-identically,
    // but the write FAILED (ok=false). A failed edit is not proof the guard was
    // ceremony — it must not count. With no successful writes at all → unresolved.
    const fire = { path: '/x.ts', rawContent: 'export const x = 1; return x;' };
    const later = [{ path: '/x.ts', rawContent: 'export const x = 1; return x;', ok: false }];
    const r = deriveGroundedWriteResolution(fire, later);
    expect(r.label).toBe('unresolved');
    expect(r.observedInTurn).toBe(false);
    expect(r.detail).toBe('only-failed-writes');
  });

  it('redirected: a FAILED same-path write + a SUCCESSFUL different-path write', () => {
    // The same-path re-issue failed (not evidence); only the successful write to
    // a different path counts → the model redirected.
    const fire = { path: '/x.ts', rawContent: 'export const x = 1;' };
    const later = [
      { path: '/x.ts', rawContent: 'export const x = 1;', ok: false },
      { path: '/y.ts', rawContent: 'export const y = 2;', ok: true },
    ];
    const r = deriveGroundedWriteResolution(fire, later);
    expect(r.label).toBe('redirected');
    expect(r.observedInTurn).toBe(true);
  });
});

describe('guard-telemetry — deriveGroundedWriteResolutionMulti (codex FIX 2: ALL blocked calls)', () => {
  it('ceremony: 2 blocked writes, the SECOND is re-issued near-identically (ok) → ceremony', () => {
    // A single grounded-write fire blocked two writes; only the second path is
    // re-issued near-identically. Resolving against ONLY the first call would
    // miss it — the multi resolver must classify every blocked call.
    const blocked = [
      { path: '/a.ts', rawContent: 'export const a = 1; return a;' },
      { path: '/b.ts', rawContent: 'export const b = 2; return b;' },
    ];
    const later = [
      { path: '/b.ts', rawContent: 'export const b = 2;\nreturn b;', ok: true }, // near-identical re-issue of the 2nd
    ];
    const r = deriveGroundedWriteResolutionMulti(blocked, later);
    expect(r.label).toBe('ceremony');
    expect(r.observedInTurn).toBe(true);
    expect(r.divergence).toBeCloseTo(0, 5); // 1 - jaccard, jaccard == 1
  });

  it('redirected: 2 blocked writes, only a DIFFERENT path gets an ok write → redirected', () => {
    // Neither blocked path is written; a successful write lands on a third path.
    const blocked = [
      { path: '/a.ts', rawContent: 'export const a = 1;' },
      { path: '/b.ts', rawContent: 'export const b = 2;' },
    ];
    const later = [
      { path: '/c.ts', rawContent: 'export const c = 3;', ok: true },
    ];
    const r = deriveGroundedWriteResolutionMulti(blocked, later);
    expect(r.label).toBe('redirected');
    expect(r.observedInTurn).toBe(true);
  });

  it('ceremony beats prevented: one blocked path re-issued identically, another changed', () => {
    const blocked = [
      { path: '/a.ts', rawContent: 'export const a = 1; return a;' }, // re-issued identically → ceremony
      { path: '/b.ts', rawContent: 'export const b = 2;' },           // changed → prevented
    ];
    const later = [
      { path: '/a.ts', rawContent: 'export const a = 1; return a;', ok: true },
      { path: '/b.ts', rawContent: 'totally different body for b here now', ok: true },
    ];
    const r = deriveGroundedWriteResolutionMulti(blocked, later);
    // Aggregation priority: any ceremony → ceremony.
    expect(r.label).toBe('ceremony');
  });

  it('prevented: no ceremony, but a blocked path is re-written with different content', () => {
    const blocked = [
      { path: '/a.ts', rawContent: 'export const a = 1;' },
      { path: '/b.ts', rawContent: 'export const b = 2;' },
    ];
    const later = [
      { path: '/a.ts', rawContent: 'a wholly different replacement body for a', ok: true },
    ];
    const r = deriveGroundedWriteResolutionMulti(blocked, later);
    expect(r.label).toBe('prevented');
  });

  it('averted: no later ok-writes at all → averted', () => {
    const blocked = [
      { path: '/a.ts', rawContent: 'export const a = 1;' },
      { path: '/b.ts', rawContent: 'export const b = 2;' },
    ];
    expect(deriveGroundedWriteResolutionMulti(blocked, []).label).toBe('averted');
  });

  it('only-failed-writes: later writes existed but ALL failed → unresolved', () => {
    const blocked = [{ path: '/a.ts', rawContent: 'export const a = 1;' }];
    const later = [{ path: '/a.ts', rawContent: 'export const a = 1;', ok: false }];
    const r = deriveGroundedWriteResolutionMulti(blocked, later);
    expect(r.label).toBe('unresolved');
    expect(r.observedInTurn).toBe(false);
    expect(r.detail).toBe('only-failed-writes');
  });
});

describe('guard-telemetry — deriveCalibrationBucket (all 5 buckets)', () => {
  it('no_edit when there are no edit outcomes in the window', () => {
    expect(deriveCalibrationBucket(95, [])).toBe('no_edit');
    expect(deriveCalibrationBucket(10, [])).toBe('no_edit');
  });

  it('high_conf_hit: value ≥ 85 and every edit succeeded', () => {
    expect(deriveCalibrationBucket(90, [true, true])).toBe('high_conf_hit');
    expect(deriveCalibrationBucket(85, [true])).toBe('high_conf_hit');
  });

  it('high_conf_miss: value ≥ 85 but some edit failed', () => {
    expect(deriveCalibrationBucket(90, [true, false])).toBe('high_conf_miss');
  });

  it('low_conf_hit: value < 85 and every edit succeeded', () => {
    expect(deriveCalibrationBucket(60, [true])).toBe('low_conf_hit');
    expect(deriveCalibrationBucket(84, [true, true])).toBe('low_conf_hit');
  });

  it('low_conf_miss: value < 85 and some edit failed', () => {
    expect(deriveCalibrationBucket(40, [false])).toBe('low_conf_miss');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tracker — end-to-end synthetic step traces (no I/O; finalize is pure).
// ──────────────────────────────────────────────────────────────────────

describe('guard-telemetry — tracker end-to-end', () => {
  it('grounded-write fire → near-identical re-issue → ceremony', () => {
    const t = createTurnTracker('codex', 'turn-1');
    t.recordAssembleMs(12);
    // Step 1: the model attempts a write; the guard blocks it and fires.
    const fireId = t.recordFire(
      'grounded-write',
      1,
      [{ name: 'Write', path: '/a.ts', argsPreview: 'write /a.ts', rawContent: 'export const a = 1; return a;' }],
      4,
    );
    expect(fireId).toContain('grounded-write');
    t.recordStep(1, { roundTripMs: 100, toolCallCount: 1 });
    // Step 2: model re-issues the SAME write near-identically (ceremony).
    t.recordToolResult(2, 'Write', { file_path: '/a.ts', content: 'export const a = 1;\nreturn a;' }, true);
    t.recordStep(2, { roundTripMs: 80, toolCallCount: 1 });

    const { events, turn } = t.finalize('done');
    expect(events).toHaveLength(1);
    expect(events[0].guardId).toBe('grounded-write');
    expect(events[0].resolution.label).toBe('ceremony');
    expect(events[0].resolution.observedInTurn).toBe(true);
    expect(turn.steps).toBe(2);
    expect(turn.assembleMs).toBe(12);
    expect(turn.totalToolCalls).toBe(2);
    expect(turn.fires).toBe(1);
    expect(turn.roundTripMsPerStep).toEqual([100, 80]);
  });

  it('grounded-write fire blocking MULTIPLE writes → resolves against the re-issued SECOND one (codex FIX 2)', () => {
    const t = createTurnTracker('codex', 'turn-multi');
    // One fire blocks TWO writes in the same step.
    t.recordFire(
      'grounded-write',
      1,
      [
        { name: 'Write', path: '/a.ts', argsPreview: 'write /a.ts', rawContent: 'export const a = 1; return a;' },
        { name: 'Write', path: '/b.ts', argsPreview: 'write /b.ts', rawContent: 'export const b = 2; return b;' },
      ],
      5,
    );
    t.recordStep(1, { roundTripMs: 90, toolCallCount: 2 });
    // Only the SECOND blocked path is re-issued near-identically. The old
    // first-only resolver would have missed this → averted/redirected.
    t.recordToolResult(2, 'Write', { file_path: '/b.ts', content: 'export const b = 2;\nreturn b;' }, true);
    t.recordStep(2, { roundTripMs: 80, toolCallCount: 1 });

    const { events } = t.finalize('done');
    expect(events).toHaveLength(1);
    expect(events[0].resolution.label).toBe('ceremony');
    expect(events[0].resolution.observedInTurn).toBe(true);
  });

  it('grounded-write fire blocking MULTIPLE writes, only a different path written → redirected (codex FIX 2)', () => {
    const t = createTurnTracker('codex', 'turn-multi-redir');
    t.recordFire(
      'grounded-write',
      1,
      [
        { name: 'Write', path: '/a.ts', argsPreview: 'write /a.ts', rawContent: 'export const a = 1;' },
        { name: 'Edit', path: '/b.ts', argsPreview: 'edit /b.ts', rawContent: 'export const b = 2;' },
      ],
      5,
    );
    t.recordStep(1, { roundTripMs: 90, toolCallCount: 2 });
    // A successful write to a THIRD path only.
    t.recordToolResult(2, 'Write', { file_path: '/c.ts', content: 'export const c = 3;' }, true);
    t.recordStep(2, { roundTripMs: 70, toolCallCount: 1 });

    const { events } = t.finalize('done');
    expect(events).toHaveLength(1);
    expect(events[0].resolution.label).toBe('redirected');
  });

  it('read-spin deferred → spontaneous pivot → would_have_recovered', () => {
    const t = createTurnTracker('agy', 'turn-2');
    const fireId = t.recordFire('read-spin', 3, [], 2, { deferred: true });
    t.recordStep(3, { roundTripMs: 50, toolCallCount: 1 });
    // Model pivoted on its own (e.g. issued a write next step) — the nudge was
    // never needed.
    t.recordReadSpinOutcome(fireId, 'would_have_recovered');
    t.recordStep(4, { roundTripMs: 60, toolCallCount: 2 }); // a parallel step

    const { events, turn } = t.finalize('done');
    expect(events).toHaveLength(1);
    expect(events[0].guardId).toBe('read-spin');
    expect(events[0].resolution.label).toBe('would_have_recovered');
    expect(events[0].resolution.heuristicVersion).toBe('v1');
    expect(turn.parallelSteps).toBe(1);
    expect(turn.maxParallelCalls).toBe(2);
  });

  it('report-confidence fire buckets calibration from subsequent edit outcomes', () => {
    const t = createTurnTracker('codex', 'turn-3');
    t.recordFire('report-confidence', 1, [], 0, { confidenceValue: 92 });
    t.recordStep(1, { roundTripMs: 30, toolCallCount: 1 });
    // Two successful edits within the ≤3-step window → high_conf_hit.
    t.recordToolResult(2, 'Edit', { file_path: '/b.ts', new_string: 'fix' }, true);
    t.recordToolResult(3, 'Write', { file_path: '/c.ts', content: 'new' }, true);
    t.recordStep(2, { roundTripMs: 40, toolCallCount: 2 });

    const { events } = t.finalize('done');
    const conf = events.find((e) => e.guardId === 'report-confidence')!;
    expect(conf.confidenceValue).toBe(92);
    expect(conf.calibrationBucket).toBe('high_conf_hit');
  });

  it('read-spin recordReadSpinOutcome(extraCostMs) adds the deferral cost to fireOverheadMs + counters', () => {
    // FIX 3: a deferred read-spin fire that stalled into the recovery path charges
    // the wasted extra round-trip (extraCostMs) to its fireOverheadMs, so the
    // week-1 cheap-half (avgOverheadMs) reflects the deferral's real cost.
    const t = createTurnTracker('codex', 'turn-cost');
    const fireId = t.recordFire('read-spin', 3, [], 0, { deferred: true }); // base overhead 0
    t.recordStep(3, { roundTripMs: 50, toolCallCount: 1 });
    t.recordReadSpinOutcome(fireId, 'stalled', 4321);
    t.recordStep(4, { roundTripMs: 60, toolCallCount: 1 });

    const { events, turn } = t.finalize('done');
    expect(events).toHaveLength(1);
    expect(events[0].guardId).toBe('read-spin');
    expect(events[0].resolution.label).toBe('stalled');
    // The deferral cost flowed into the event's fireOverheadMs (0 base + 4321).
    expect(events[0].fireOverheadMs).toBe(4321);

    // …and through applyGuardCounters into the cell's overheadMsTotal.
    const counters = { byEngineGuard: {}, byEngineTurns: {}, lastUpdated: '' };
    storeApply(counters as never, events, turn);
    const cell = (counters as never as { byEngineGuard: Record<string, Record<string, GuardCounterCell>> }).byEngineGuard['codex']['read-spin'];
    expect(cell.stalled).toBe(1);
    expect(cell.overheadMsTotal).toBe(4321);
  });

  // ── codex FIX 1: 'evidence' / 'confidence-escalation' are fire-counting ──
  // guards — they must finalize as PLAIN fires (label 'unresolved',
  // observedInTurn=true, NO calibrationBucket) and must NEVER route through the
  // report-confidence calibration flow (no averted/recovered/highConf* cells).
  it("'evidence' fire finalizes as a plain fire without calibrationBucket (codex FIX 1)", () => {
    const t = createTurnTracker('codex', 'turn-evidence');
    t.recordFire('evidence', 1, [], 0);
    t.recordStep(1, { roundTripMs: 30, toolCallCount: 1 });
    // A later edit must NOT pull 'evidence' into the calibration window.
    t.recordToolResult(2, 'Edit', { file_path: '/x.ts', new_string: 'fix' }, true);
    t.recordStep(2, { roundTripMs: 40, toolCallCount: 1 });

    const { events } = t.finalize('done');
    const ev = events.find((e) => e.guardId === 'evidence')!;
    expect(ev).toBeDefined();
    expect(ev.resolution.label).toBe('unresolved');
    expect(ev.resolution.observedInTurn).toBe(true);
    expect(ev.calibrationBucket).toBeUndefined();

    // …and through applyGuardCounters it only bumps fires + unresolved, never
    // averted/recovered/highConfHit.
    const counters = { byEngineGuard: {}, byEngineTurns: {}, lastUpdated: '' };
    storeApply(counters as never, events, turnRecord({ engineId: 'codex' }));
    const cell = (counters as never as { byEngineGuard: Record<string, Record<string, GuardCounterCell>> }).byEngineGuard['codex']['evidence'];
    expect(cell.fires).toBe(1);
    expect(cell.unresolved).toBe(1);
    expect(cell.averted).toBe(0);
    expect(cell.recovered).toBe(0);
    expect(cell.highConfHit ?? 0).toBe(0);
  });

  it("'confidence-escalation' fire finalizes as a plain fire without calibrationBucket (codex FIX 1)", () => {
    const t = createTurnTracker('agy', 'turn-escalation');
    t.recordFire('confidence-escalation', 2, [], 1);
    t.recordStep(2, { roundTripMs: 50, toolCallCount: 1 });
    t.recordToolResult(3, 'Write', { file_path: '/y.ts', content: 'new' }, true);
    t.recordStep(3, { roundTripMs: 45, toolCallCount: 1 });

    const { events } = t.finalize('done');
    const ev = events.find((e) => e.guardId === 'confidence-escalation')!;
    expect(ev).toBeDefined();
    expect(ev.resolution.label).toBe('unresolved');
    expect(ev.resolution.observedInTurn).toBe(true);
    expect(ev.calibrationBucket).toBeUndefined();

    const counters = { byEngineGuard: {}, byEngineTurns: {}, lastUpdated: '' };
    storeApply(counters as never, events, turnRecord({ engineId: 'agy' }));
    const cell = (counters as never as { byEngineGuard: Record<string, Record<string, GuardCounterCell>> }).byEngineGuard['agy']['confidence-escalation'];
    expect(cell.fires).toBe(1);
    expect(cell.unresolved).toBe(1);
    expect(cell.averted).toBe(0);
    expect(cell.recovered).toBe(0);
    expect(cell.highConfHit ?? 0).toBe(0);
  });

  it("finalize('aborted') leaves open fires unresolved", () => {
    const t = createTurnTracker('agy', 'turn-4');
    t.recordFire(
      'grounded-write',
      1,
      [{ name: 'Edit', path: '/d.ts', argsPreview: 'edit /d.ts', rawContent: 'x' }],
      3,
    );
    t.recordStep(1, { roundTripMs: 70, toolCallCount: 1 });

    const { events } = t.finalize('aborted');
    expect(events).toHaveLength(1);
    expect(events[0].resolution.label).toBe('unresolved');
    expect(events[0].resolution.observedInTurn).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Store — AGON_HOME=tmpdir; append + rotate; counters; recommendation gate;
// disable switch.
// ──────────────────────────────────────────────────────────────────────

function fireEvent(over: Partial<GuardFireEvent> = {}): GuardFireEvent {
  return {
    kind: 'guard_fire',
    id: 'f1',
    ts: Date.now(),
    turnId: 't1',
    engineId: 'codex',
    guardId: 'grounded-write',
    step: 1,
    blockedCalls: [],
    fireOverheadMs: 10,
    resolution: { label: 'ceremony', observedInTurn: true },
    ...over,
  };
}

function turnRecord(over: Partial<TurnTelemetryRecord> = {}): TurnTelemetryRecord {
  return {
    kind: 'turn',
    turnId: 't1',
    engineId: 'codex',
    ts: Date.now(),
    steps: 3,
    assembleMs: 10,
    roundTripMsPerStep: [100, 80, 60],
    toolExecMsTotal: 50,
    guardOverheadMsTotal: 12,
    totalToolCalls: 4,
    parallelSteps: 1,
    maxParallelCalls: 2,
    fires: 1,
    ...over,
  };
}

describe('guard-telemetry-store — paths + disable switch', () => {
  let home = '';
  beforeEach(() => { home = setupTestAgonHome('guard-telemetry'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('guardTelemetryDir resolves under the AGON_HOME override', () => {
    expect(storeDir()).toBe(join(home, 'telemetry'));
  });

  it('guardTelemetryEnabled honours AGON_GUARD_TELEMETRY=0/false/off', () => {
    delete process.env.AGON_GUARD_TELEMETRY;
    expect(storeEnabled()).toBe(true);
    for (const v of ['0', 'false', 'off', 'OFF', 'False']) {
      process.env.AGON_GUARD_TELEMETRY = v;
      expect(storeEnabled()).toBe(false);
    }
    process.env.AGON_GUARD_TELEMETRY = '1';
    expect(storeEnabled()).toBe(true);
    delete process.env.AGON_GUARD_TELEMETRY;
  });
});

describe('guard-telemetry-store — append + rotation', () => {
  let home = '';
  beforeEach(() => { home = setupTestAgonHome('guard-telemetry-append'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('appends a JSONL block (events + turn) per call', () => {
    storeAppend([fireEvent()], turnRecord());
    storeAppend([fireEvent({ id: 'f2' })], turnRecord({ turnId: 't2' }));
    const path = join(home, 'telemetry', 'guard-fires.jsonl');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    // 2 calls × (1 event + 1 turn) = 4 lines.
    expect(lines).toHaveLength(4);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.filter((p) => p.kind === 'guard_fire')).toHaveLength(2);
    expect(parsed.filter((p) => p.kind === 'turn')).toHaveLength(2);
  });

  it('strips rawContent from blockedCalls before writing the ledger', () => {
    const ev = fireEvent();
    ev.blockedCalls = [{
      name: 'Edit',
      path: 'src/a.ts',
      argsPreview: '{"file_path":"src/a.ts"}',
      contentHash: 'abc123',
      rawContent: 'SECRET FILE BYTES that must never persist',
    }];
    storeAppend([ev], turnRecord());
    const raw = readFileSync(join(home, 'telemetry', 'guard-fires.jsonl'), 'utf-8');
    expect(raw).not.toContain('SECRET FILE BYTES');
    expect(raw).not.toContain('rawContent');
    const fire = raw.trim().split('\n').map((l) => JSON.parse(l)).find((p) => p.kind === 'guard_fire');
    // hash + preview survive — only the raw bytes are dropped.
    expect(fire.blockedCalls[0].contentHash).toBe('abc123');
    expect(fire.blockedCalls[0].argsPreview).toContain('src/a.ts');
  });

  it('rotates the ledger to .1 once it exceeds the byte cap', () => {
    const path = join(home, 'telemetry', 'guard-fires.jsonl');
    mkdirSync(join(home, 'telemetry'), { recursive: true });
    // Seed a file just over 10 MB so the next append triggers a rotation.
    writeFileSync(path, 'x'.repeat(10 * 1024 * 1024 + 10));
    storeAppend([fireEvent()], turnRecord());
    expect(existsSync(path + '.1')).toBe(true);
    // Fresh live file holds only the new block (2 lines), not the 10 MB seed.
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('never throws when the home is unwritable (best-effort)', () => {
    // Point AGON_HOME at a path whose parent is a FILE, so mkdir fails — the
    // append must swallow the error rather than throw into the session.
    const filePath = join(home, 'not-a-dir');
    writeFileSync(filePath, 'i am a file');
    process.env.AGON_HOME = join(filePath, 'sub'); // mkdir under a file → ENOTDIR
    expect(() => storeAppend([fireEvent()], turnRecord())).not.toThrow();
    process.env.AGON_HOME = home;
  });
});

describe('guard-telemetry-store — counters aggregation + recommendation', () => {
  let home = '';
  beforeEach(() => { home = setupTestAgonHome('guard-telemetry-counters'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('updateGuardCounters aggregates fires/labels/overhead + turn rollups', () => {
    storeUpdate(
      [fireEvent({ resolution: { label: 'ceremony', observedInTurn: true }, fireOverheadMs: 10 })],
      turnRecord(),
    );
    storeUpdate(
      [fireEvent({ resolution: { label: 'prevented', observedInTurn: true }, fireOverheadMs: 30 })],
      turnRecord({ turnId: 't2', steps: 2, totalToolCalls: 3, parallelSteps: 0, roundTripMsPerStep: [50, 50] }),
    );
    const c = storeRead();
    expect(c).not.toBeNull();
    const cell = c!.byEngineGuard['codex']['grounded-write'];
    expect(cell.fires).toBe(2);
    expect(cell.ceremony).toBe(1);
    expect(cell.prevented).toBe(1);
    expect(cell.overheadMsTotal).toBe(40);

    const agg = c!.byEngineTurns['codex'];
    expect(agg.turns).toBe(2);
    expect(agg.steps).toBe(5); // 3 + 2
    expect(agg.totalToolCalls).toBe(7); // 4 + 3
    expect(agg.parallelSteps).toBe(1); // 1 + 0
    expect(agg.roundTripMsTotal).toBe(100 + 80 + 60 + 50 + 50);
  });

  it('applyGuardCounters is a pure fold (no fs) producing the same tallies', () => {
    const counters = { byEngineGuard: {}, byEngineTurns: {}, lastUpdated: '' };
    storeApply(counters as never, [fireEvent({ resolution: { label: 'redirected', observedInTurn: true } })], turnRecord());
    const cell = (counters as never as { byEngineGuard: Record<string, Record<string, GuardCounterCell>> }).byEngineGuard['codex']['grounded-write'];
    expect(cell.redirected).toBe(1);
    expect(cell.fires).toBe(1);
  });

  it('readGuardCounters returns null when the counters file is absent', () => {
    expect(storeRead()).toBeNull();
  });
});

describe('guard-telemetry-store — recommendGuardAction (week-1 rule)', () => {
  function cell(over: Partial<GuardCounterCell> = {}): GuardCounterCell {
    return {
      fires: 0, ceremony: 0, prevented: 0, redirected: 0, averted: 0,
      recovered: 0, stalled: 0, wouldHaveRecovered: 0, unresolved: 0,
      overheadMsTotal: 0, ...over,
    };
  }

  it('insufficient-data when resolved (ceremony+prevented) < minSample', () => {
    // 10 ceremony + 5 prevented = 15 resolved < 20.
    const c = cell({ fires: 15, ceremony: 10, prevented: 5, overheadMsTotal: 150 });
    expect(storeRecommend('grounded-write', c)).toBe('insufficient-data');
  });

  it('relax when mostly-ceremony AND cheap overhead, with enough sample', () => {
    // 20 ceremony + 5 prevented = 25 resolved ≥ 20; ceremony ratio 0.8 > 0.7;
    // avg overhead = 250/25 = 10 < 50 → relax.
    const c = cell({ fires: 25, ceremony: 20, prevented: 5, overheadMsTotal: 250 });
    expect(storeRecommend('grounded-write', c)).toBe('relax');
  });

  it('keep when ceremony ratio is below the threshold despite enough sample', () => {
    // 12 ceremony + 13 prevented = 25 resolved; ratio 0.48 < 0.7 → keep.
    const c = cell({ fires: 25, ceremony: 12, prevented: 13, overheadMsTotal: 250 });
    expect(storeRecommend('grounded-write', c)).toBe('keep');
  });

  it('keep when overhead is too high even though ceremony dominates', () => {
    // ratio 0.8 > 0.7 but avg overhead = 2500/25 = 100 ≥ 50 → keep.
    const c = cell({ fires: 25, ceremony: 20, prevented: 5, overheadMsTotal: 2500 });
    expect(storeRecommend('grounded-write', c)).toBe('keep');
  });

  it('respects custom thresholds', () => {
    const c = cell({ fires: 10, ceremony: 8, prevented: 2, overheadMsTotal: 100 });
    // Default minSample 20 → insufficient; lower it to 10 and it relaxes.
    expect(storeRecommend('grounded-write', c)).toBe('insufficient-data');
    expect(storeRecommend('grounded-write', c, { minSample: 10, ceremonyRate: 0.7, avgOverheadMs: 50 })).toBe('relax');
  });

  it('exposes the documented default thresholds (incl. the read-spin gate — codex FIX 3)', () => {
    expect(GUARD_TELEMETRY_THRESHOLDS).toEqual({
      minSample: 20, ceremonyRate: 0.7, avgOverheadMs: 50,
      readSpin: { minSample: 20, wouldHaveRecoveredRate: 0.5 },
    });
  });

  // ── codex FIX 3b: per-guard recommendation ──────────────────────────
  it('read-spin: relax when wouldHaveRecovered dominates the resolved fires', () => {
    // resolved = 18 whr + 2 stalled + 2 recovered = 22 ≥ 20; whr/resolved = 18/22
    // ≈ 0.82 > 0.5 → the model usually pivots on its own → relax.
    const c = cell({ fires: 22, wouldHaveRecovered: 18, stalled: 2, recovered: 2 });
    expect(storeRecommend('read-spin', c)).toBe('relax');
  });

  it('read-spin: keep when stalls/recoveries dominate (nudge is pulling weight)', () => {
    // resolved = 8 whr + 14 stalled + 2 recovered = 24 ≥ 20; whr/resolved = 8/24
    // ≈ 0.33 < 0.5 → keep.
    const c = cell({ fires: 24, wouldHaveRecovered: 8, stalled: 14, recovered: 2 });
    expect(storeRecommend('read-spin', c)).toBe('keep');
  });

  it('read-spin: insufficient-data below the read-spin minSample (NOT the grounded-write one)', () => {
    // 15 resolved read-spin fires < readSpin.minSample(20) → insufficient-data,
    // even though it never touches ceremony/prevented.
    const c = cell({ fires: 15, wouldHaveRecovered: 12, stalled: 2, recovered: 1 });
    expect(storeRecommend('read-spin', c)).toBe('insufficient-data');
  });

  it('report-confidence: always insufficient-data in Phase 0 (P1 owns demotion)', () => {
    // Even a large, lopsided calibration sample yields no relax/keep call yet.
    const c = cell({ fires: 100, highConfHit: 80, highConfMiss: 20 });
    expect(storeRecommend('report-confidence', c)).toBe('insufficient-data');
  });

  // ── claude FIX 3 (defensive): non-grounded-write ids never inherit the GW rule ──
  it("'evidence' and 'confidence-escalation' return insufficient-data even with a GW-relax-shaped cell (claude FIX 3)", () => {
    // This cell (25 ceremony+prevented resolved, ratio 0.8 > 0.7, avg overhead 10 < 50)
    // would RELAX under the grounded-write rule. A guard id with no week-1 rule must
    // NOT fall through to that rule — it must explicitly return insufficient-data.
    const c = cell({ fires: 25, ceremony: 20, prevented: 5, overheadMsTotal: 250 });
    // Sanity: this very cell DOES relax for grounded-write (so the test is meaningful).
    expect(storeRecommend('grounded-write', c)).toBe('relax');
    // …but the fire-counting guards must not borrow that verdict.
    expect(storeRecommend('evidence', c)).toBe('insufficient-data');
    expect(storeRecommend('confidence-escalation', c)).toBe('insufficient-data');
  });
});
