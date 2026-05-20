import { describe, it, expect } from 'vitest';
import {
  gateFailureSignature, taskParkDecision, globalBreaker, budgetExceeded, timeExceeded,
} from '../../packages/forge/src/generated/goal/policy.js';
import type { JournalState, GoalTask, GoalSpec } from '../../packages/forge/src/generated/goal/types.js';

const spec = (over: Partial<GoalSpec> = {}): GoalSpec => ({
  goalId: 'g', intent: 'x', branch: 'goal/x', gate: 'npm test', queueSource: '.kern-gaps/',
  maxAttempts: 3, budgetUsd: 50, maxHours: 8, supervised: true, ...over,
});

const task = (over: Partial<GoalTask> = {}): GoalTask => ({
  id: 'a', source: 'gap-a', status: 'queued', attempts: 0, attemptLog: [], costUsd: 0, ...over,
});

const state = (over: Partial<JournalState> = {}): JournalState => ({
  spec: spec(), createdAt: 0, spentUsd: 0, parkedStreak: 0, noProgressStreak: 0,
  lastRemainingCount: 0, tasks: [], events: [], ...over,
});

describe('gateFailureSignature', () => {
  it('is stable for the same failure', () => {
    const out = 'Error at foo.ts:12:4\n  expected 3 got 4';
    expect(gateFailureSignature(out)).toBe(gateFailureSignature(out));
  });
  it('normalizes away volatile noise (shas, durations, paths, line:col) so the same logical failure matches', () => {
    const a = 'FAIL /Users/me/repo/wt-1700000000/src/x.ts:12:4 (1234ms)  abc1234def deadbeef';
    const b = 'FAIL /Users/me/repo/wt-1700009999/src/x.ts:88:1 (37ms)  9999000aaaa fedcba98';
    expect(gateFailureSignature(a)).toBe(gateFailureSignature(b));
  });
  it('distinguishes genuinely different failures', () => {
    expect(gateFailureSignature('assertion failed: equality'))
      .not.toBe(gateFailureSignature('type error: cannot find name'));
  });
  it('strips ANSI color so the same error colored or plain hashes identically', () => {
    const plain = 'FAIL expected foo got bar';
    const colored = '\x1b[31mFAIL\x1b[0m expected \x1b[1mfoo\x1b[0m got bar';
    expect(gateFailureSignature(colored)).toBe(gateFailureSignature(plain));
  });
  it('handles all-digit content without collapsing to an empty hash', () => {
    expect(gateFailureSignature('error code 12345').length).toBe(16);
  });
});

describe('taskParkDecision', () => {
  it('parks once attempts hit max', () => {
    expect(taskParkDecision(task({ attempts: 3 }), 3).park).toBe(true);
    expect(taskParkDecision(task({ attempts: 2 }), 3).park).toBe(false);
  });
  it('parks on a repeated gate-failure signature (oscillation)', () => {
    const t = task({
      attempts: 2,
      attemptLog: [
        { at: 1, outcome: 'gate-fail', gateFailureSignature: 'sig-A' },
        { at: 2, outcome: 'gate-fail', gateFailureSignature: 'sig-A' },
      ],
    });
    const d = taskParkDecision(t, 5);
    expect(d.park).toBe(true);
    expect(d.reason).toMatch(/oscillation/);
  });
  it('treats a NaN / non-positive cap as 1 so a task never grinds forever', () => {
    expect(taskParkDecision(task({ attempts: 1 }), Number.NaN).park).toBe(true);
    expect(taskParkDecision(task({ attempts: 1 }), 0).park).toBe(true);
    expect(taskParkDecision(task({ attempts: 0 }), Number.NaN).park).toBe(false);
  });
  it('does not park when signatures differ and attempts remain', () => {
    const t = task({
      attempts: 2,
      attemptLog: [
        { at: 1, outcome: 'gate-fail', gateFailureSignature: 'sig-A' },
        { at: 2, outcome: 'gate-fail', gateFailureSignature: 'sig-B' },
      ],
    });
    expect(taskParkDecision(t, 5).park).toBe(false);
  });
});

describe('globalBreaker', () => {
  it('stops on park streak', () => {
    expect(globalBreaker(state({ parkedStreak: 5 }), 5, 5).stop).toBe(true);
  });
  it('stops on no-progress streak', () => {
    expect(globalBreaker(state({ noProgressStreak: 5 }), 5, 5).stop).toBe(true);
  });
  it('keeps going below thresholds, and 0 disables the breaker', () => {
    expect(globalBreaker(state({ parkedStreak: 4, noProgressStreak: 4 }), 5, 5).stop).toBe(false);
    expect(globalBreaker(state({ parkedStreak: 99 }), 0, 0).stop).toBe(false);
  });
});

describe('budgetExceeded / timeExceeded', () => {
  it('budget: trips at the cap, 0 means unlimited', () => {
    expect(budgetExceeded(state({ spentUsd: 50, spec: spec({ budgetUsd: 50 }) }))).toBe(true);
    expect(budgetExceeded(state({ spentUsd: 49, spec: spec({ budgetUsd: 50 }) }))).toBe(false);
    expect(budgetExceeded(state({ spentUsd: 9999, spec: spec({ budgetUsd: 0 }) }))).toBe(false);
  });
  it('time: trips after maxHours from startedAt, false before start, 0 means unlimited', () => {
    const start = 1_000_000;
    const s = state({ startedAt: start, spec: spec({ maxHours: 1 }) });
    expect(timeExceeded(s, start + 3_600_000)).toBe(true);
    expect(timeExceeded(s, start + 3_599_000)).toBe(false);
    expect(timeExceeded(state({ spec: spec({ maxHours: 1 }) }), Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(timeExceeded(state({ startedAt: start, spec: spec({ maxHours: 0 }) }), start + 1e12)).toBe(false);
  });
});
