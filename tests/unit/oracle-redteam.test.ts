// Unit tests for the oracle red-team pre-flight core — the pure cheat prompt and
// the warn/strict gate decision. The orchestration (running an adversarial forge
// per task) lives in the goal CLI command and is exercised end-to-end there.
import { describe, it, expect } from 'vitest';
import { buildOracleCheatPrompt, oracleGateDecision, oracleProbeConclusive, safePathSegment, DEFAULT_ORACLE_GATE } from '@kernlang/agon-forge';
import type { OracleHole } from '@kernlang/agon-forge';

describe('buildOracleCheatPrompt', () => {
  it('embeds the gap + verify and demands a degenerate cheat, not a real impl', () => {
    const p = buildOracleCheatPrompt({ source: 'implement pow(a,b)', verify: 'node -e "assert(pow(2,3)===8)"' });
    expect(p).toContain('implement pow(a,b)');
    expect(p).toContain('node -e "assert(pow(2,3)===8)"');
    expect(p.toLowerCase()).toContain('cheat');
    expect(p).toMatch(/do not implement/i);
    expect(p.toLowerCase()).toContain('hardcode');
  });
});

describe('oracleGateDecision', () => {
  const hole = (taskId: string): OracleHole => ({ taskId, engine: 'codex', evidence: 'cheat passed' });

  it('no holes -> never abort, clean summary', () => {
    const d = oracleGateDecision([], 'strict');
    expect(d.abort).toBe(false);
    expect(d.summary).toMatch(/no gameable/i);
  });

  it('warn + holes -> proceed with a loud summary naming the tasks, and SAYS it is continuing', () => {
    const d = oracleGateDecision([hole('t1')], 'warn');
    expect(d.abort).toBe(false);
    expect(d.summary).toContain('t1');
    expect(d.summary).toMatch(/gameable/i);
    // The tail must match the mode: a warn run that reads "Stopping the run"
    // (or a strict run that reads "Continuing") is a lie the flag flips silently.
    expect(d.summary).toContain('Continuing (--oracle-gate=warn)');
    expect(d.summary).not.toContain('Stopping the run');
  });

  it('strict + holes -> stop the run, and the summary says the run is stopping', () => {
    const d = oracleGateDecision([hole('t1'), hole('t2')], 'strict');
    expect(d.abort).toBe(true);
    expect(d.summary).toContain('t1');
    expect(d.summary).toContain('t2');
    expect(d.summary).toContain('Stopping the run (--oracle-gate=strict)');
    expect(d.summary).not.toContain('Continuing');
  });

  it('only strict aborts — an unexpected mode with holes does not', () => {
    expect(oracleGateDecision([hole('t1')], 'off').abort).toBe(false);
    expect(oracleGateDecision([hole('t1')], 'warn').abort).toBe(false);
  });
});

// ── The probe must know when it learned NOTHING ──────────────────────
// A forge that threw, dispatched nobody, or whose every seat failed returns
// `winner: null` — the exact same shape as an honest "nobody could cheat this
// verify". Reading the second meaning into the first certifies an oracle the
// gate never actually attacked.
describe('oracleProbeConclusive', () => {
  const seat = (engineCompleted: boolean) => ({ engineCompleted });

  it('is conclusive when an engine WON — a hole was really found', () => {
    expect(oracleProbeConclusive({ winner: 'codex' }).conclusive).toBe(true);
  });

  it('is conclusive when seats completed and none could game the verify', () => {
    const v = oracleProbeConclusive({ winner: null, enginesDispatched: 3, results: { a: seat(true), b: seat(false), c: seat(true) } });
    expect(v.conclusive).toBe(true);
    expect(v.reason).toContain('2/3 seat(s)');
  });

  it('is INCONCLUSIVE when the forge reported an error', () => {
    const v = oracleProbeConclusive({ winner: null, error: 'baseline already passes', enginesDispatched: 3, results: { a: seat(true) } });
    expect(v.conclusive).toBe(false);
    expect(v.reason).toContain('baseline already passes');
  });

  // `seats.length === 0 || enginesDispatched === 0` — each disjunct alone must be
  // enough, or the guard silently becomes an AND and lets an empty probe through.
  it('is INCONCLUSIVE when nothing was dispatched', () => {
    expect(oracleProbeConclusive({ winner: null, enginesDispatched: 0, results: {} }).conclusive).toBe(false);
    // seats recorded but nothing actually dispatched
    expect(oracleProbeConclusive({ winner: null, enginesDispatched: 0, results: { a: seat(true) } }).conclusive).toBe(false);
    // dispatched but no seat recorded a result
    expect(oracleProbeConclusive({ winner: null, enginesDispatched: 2, results: {} }).conclusive).toBe(false);
  });

  it('is INCONCLUSIVE when every seat failed to complete', () => {
    const v = oracleProbeConclusive({ winner: null, enginesDispatched: 2, results: { a: seat(false), b: seat(false) } });
    expect(v.conclusive).toBe(false);
    expect(v.reason).toContain('never actually attacked');
  });
});

describe('DEFAULT_ORACLE_GATE', () => {
  it('is warn — ONE default, so the CLI and the library cannot disagree', () => {
    expect(DEFAULT_ORACLE_GATE).toBe('warn');
  });
});

// The goal loop builds worktrees from queue-authored task ids and rmSync's them.
describe('safePathSegment', () => {
  it('reduces a traversal attempt to one harmless segment', () => {
    expect(safePathSegment('../../etc', 'task')).toBe('etc');
    expect(safePathSegment('a/b', 'task')).toBe('a-b');
    expect(safePathSegment('..', 'task')).toBe('task');
    expect(safePathSegment('', 'task')).toBe('task');
  });

  it('leaves a normal id alone', () => {
    expect(safePathSegment('gap-alpha_2', 'task')).toBe('gap-alpha_2');
  });
});
