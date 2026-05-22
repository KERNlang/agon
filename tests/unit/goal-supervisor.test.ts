// ── agon goal — supervisor decision oracle ────────────────────────────────
// Frozen oracle for the forge build of the unattended-overnight supervisor:
// the pure restart/stop judgement. The process-spawn loop (re-exec
// `agon goal --resume`) is hand-wired plumbing; these decide WHEN it runs.
import { describe, it, expect } from 'vitest';
import {
  supervisorDecision, computeBackoffMs, isDeterministicExit,
} from '../../packages/forge/src/generated/goal/supervisor.js';

describe('computeBackoffMs — exponential backoff, capped', () => {
  it('grows exponentially from the base', () => {
    expect(computeBackoffMs(0, 5000, 300000)).toBe(5000);
    expect(computeBackoffMs(1, 5000, 300000)).toBe(10000);
    expect(computeBackoffMs(2, 5000, 300000)).toBe(20000);
    expect(computeBackoffMs(3, 5000, 300000)).toBe(40000);
  });
  it('caps at capMs and never exceeds it', () => {
    expect(computeBackoffMs(20, 5000, 300000)).toBe(300000);
  });
  it('treats a non-positive restart count as the base delay (no negative exponent)', () => {
    expect(computeBackoffMs(0, 5000, 300000)).toBe(5000);
    expect(computeBackoffMs(-3, 5000, 300000)).toBe(5000);
  });
});

describe('isDeterministicExit — non-retryable classification', () => {
  it('flags known config/oracle failures as deterministic (do not retry)', () => {
    expect(isDeterministicExit(1, 'oracle changed since the run was frozen — refusing to resume')).toBe(true);
    expect(isDeterministicExit(1, 'A --gate command is required (the green oracle).')).toBe(true);
    expect(isDeterministicExit(1, 'queue not found: .kern-gaps/')).toBe(true);
    expect(isDeterministicExit(1, 'No engines found. Install at least one AI CLI tool.')).toBe(true);
    expect(isDeterministicExit(1, 'Refusing to use main as the goal branch')).toBe(true);
  });
  it('treats an unknown crash as transient (retryable)', () => {
    expect(isDeterministicExit(1, 'TypeError: cannot read properties of undefined')).toBe(false);
    expect(isDeterministicExit(137, 'Killed')).toBe(false); // OOM-kill — worth a retry
  });
  it('is case-insensitive and tolerates surrounding stack noise', () => {
    expect(isDeterministicExit(1, 'Error: ORACLE CHANGED since the run was frozen\n  at run (goal.js:1)')).toBe(true);
  });
});

describe('supervisorDecision — restart vs stop', () => {
  const base = { exitCode: 1, restarts: 0, maxRestarts: 5, journalDone: false, deterministic: false };

  it('stops when the journal is complete, regardless of exit code', () => {
    expect(supervisorDecision({ ...base, journalDone: true, exitCode: 1 }).action).toBe('stop');
  });

  it('stops on a clean exit (0) — the run reached a terminal state itself (done/budget/time/breaker)', () => {
    expect(supervisorDecision({ ...base, exitCode: 0 }).action).toBe('stop');
  });

  it('stops on a deterministic failure without retrying', () => {
    const d = supervisorDecision({ ...base, deterministic: true });
    expect(d.action).toBe('stop');
    expect(d.reason).toMatch(/determin/i);
  });

  it('stops once the restart cap is reached', () => {
    expect(supervisorDecision({ ...base, restarts: 5, maxRestarts: 5 }).action).toBe('stop');
  });

  it('restarts a transient crash below the cap', () => {
    const d = supervisorDecision({ ...base, exitCode: 1, restarts: 1, maxRestarts: 5 });
    expect(d.action).toBe('restart');
  });

  it('maxRestarts 0 disables restarts (one-shot run)', () => {
    expect(supervisorDecision({ ...base, restarts: 0, maxRestarts: 0 }).action).toBe('stop');
  });

  it('a completed journal wins even when a crash would otherwise restart', () => {
    expect(supervisorDecision({ exitCode: 1, restarts: 0, maxRestarts: 5, journalDone: true, deterministic: false }).action).toBe('stop');
  });
});
