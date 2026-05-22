// ── agon goal — sliding-window breaker oracle ─────────────────────────────
// The contract for the long-run global breaker. Authored as the FROZEN ORACLE
// for the forge build: forge engines implement globalBreaker's window branch
// and pushRecentOutcome in policy.kern to satisfy these; the tests do not move.
//
// The bug being fixed: the old breaker aborted the whole run on 5 CONSECUTIVE
// parks (parkedStreak), so a queue ordered [hard,hard,hard,hard,hard,easy,...]
// died before reaching the easy work. And it could not be replaced by the
// no-progress breaker, because a park DECREASES remainingCount (inflight ->
// parked), so noProgressStreak resets to 0 on every park. The fix: a sliding
// window over recent TERMINAL outcomes — abort only when the window has too
// few successes (broken gate / uniformly-too-hard queue), tolerating clusters.
import { describe, it, expect } from 'vitest';
import { globalBreaker, pushRecentOutcome } from '../../packages/forge/src/generated/goal/policy.js';
import type { JournalState, GoalSpec } from '../../packages/forge/src/generated/goal/types.js';

const spec = (over: Partial<GoalSpec> = {}): GoalSpec => ({
  goalId: 'g', intent: 'x', branch: 'goal/x', gate: 'npm test', queueSource: '.kern-gaps/',
  maxAttempts: 3, budgetUsd: 50, maxHours: 8, supervised: true, ...over,
});
const state = (over: Partial<JournalState> = {}): JournalState => ({
  spec: spec(), createdAt: 0, spentUsd: 0, parkedStreak: 0, noProgressStreak: 0,
  lastRemainingCount: 0, tasks: [], events: [], ...over,
});
// Default overnight window: stop only if 0 of the last 8 terminal outcomes are 'done'.
const WIN = { size: 8, minSuccessRate: 0.125 };

describe('globalBreaker — sliding-window success-rate breaker', () => {
  it('does NOT abort on a cluster of hard tasks shorter than the window (THE CORE FIX)', () => {
    // 5 consecutive parks, window not yet full, legacy park-streak disabled (0).
    const s = state({ recentOutcomes: ['parked', 'parked', 'parked', 'parked', 'parked'], parkedStreak: 5 });
    expect(globalBreaker(s, 0, 0, WIN).stop).toBe(false);
  });

  it('aborts when the whole window has zero successes (broken gate / uniformly-too-hard queue)', () => {
    const s = state({ recentOutcomes: Array(8).fill('parked') });
    const r = globalBreaker(s, 0, 0, WIN);
    expect(r.stop).toBe(true);
    expect(r.reason).toMatch(/success-rate/i);
  });

  it('a single success in the window keeps the run alive (rate == threshold is NOT below threshold)', () => {
    // 1 done / 8 = 0.125, which is not < 0.125 -> keep going.
    const s = state({ recentOutcomes: [...Array(7).fill('parked'), 'done'] });
    expect(globalBreaker(s, 0, 0, WIN).stop).toBe(false);
  });

  it('slides: only the last `size` outcomes count — an old success outside the window does not save it', () => {
    const s = state({ recentOutcomes: ['done', ...Array(8).fill('parked')] }); // last 8 are all parked
    expect(globalBreaker(s, 0, 0, WIN).stop).toBe(true);
  });

  it('does not fire until the window has filled (fewer than `size` samples never aborts on rate)', () => {
    const s = state({ recentOutcomes: Array(7).fill('parked') }); // 7 < 8
    expect(globalBreaker(s, 0, 0, WIN).stop).toBe(false);
  });

  it('window disabled (size 0) never trips on success-rate', () => {
    const s = state({ recentOutcomes: Array(8).fill('parked') });
    expect(globalBreaker(s, 0, 0, { size: 0, minSuccessRate: 0.5 }).stop).toBe(false);
  });

  it('treats a missing recentOutcomes (legacy journal) as empty — no crash, no abort', () => {
    expect(globalBreaker(state(), 0, 0, WIN).stop).toBe(false);
  });

  it('back-compat: legacy park-streak still trips when explicitly enabled (>0)', () => {
    // window not full (5 < 8) so it can't fire; an explicit park-streak cap of 5 must still stop.
    const s = state({ parkedStreak: 5, recentOutcomes: Array(5).fill('parked') });
    expect(globalBreaker(s, 5, 0, WIN).stop).toBe(true);
  });

  it('no-progress breaker remains independent of the window', () => {
    const s = state({ noProgressStreak: 9, recentOutcomes: ['done', 'done'] });
    expect(globalBreaker(s, 0, 8, WIN).stop).toBe(true);
  });

  it('the 3-arg legacy form is unchanged when the window arg is omitted', () => {
    expect(globalBreaker(state({ parkedStreak: 5 }), 5, 5).stop).toBe(true);
    expect(globalBreaker(state({ parkedStreak: 4, noProgressStreak: 4 }), 5, 5).stop).toBe(false);
    expect(globalBreaker(state({ parkedStreak: 99 }), 0, 0).stop).toBe(false);
  });
});

describe('pushRecentOutcome — bounded ring of terminal outcomes', () => {
  it('appends an outcome to the ring', () => {
    expect(pushRecentOutcome(['done'], 'parked', 8)).toEqual(['done', 'parked']);
  });

  it('starts from an empty ring', () => {
    expect(pushRecentOutcome([], 'done', 8)).toEqual(['done']);
  });

  it('drops the oldest entries beyond the cap, keeping the most recent', () => {
    const full = Array(8).fill('done');
    const out = pushRecentOutcome(full, 'parked', 8);
    expect(out.length).toBe(8);
    expect(out[7]).toBe('parked');
    expect(out.slice(0, 7)).toEqual(Array(7).fill('done'));
  });

  it('cap <= 0 means unbounded', () => {
    expect(pushRecentOutcome(Array(10).fill('done'), 'parked', 0).length).toBe(11);
  });

  it('does not mutate the input array', () => {
    const input = ['done', 'parked'];
    pushRecentOutcome(input, 'done', 8);
    expect(input).toEqual(['done', 'parked']);
  });
});
