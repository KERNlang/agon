// ── agon goal — supervisor decision oracle ────────────────────────────────
// Frozen oracle for the forge build of the unattended-overnight supervisor:
// the pure restart/stop judgement. The process-spawn loop (re-exec
// `agon goal --resume`) is hand-wired plumbing; these decide WHEN it runs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  supervisorDecision, computeBackoffMs, isDeterministicExit, runSupervisor,
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

describe('runSupervisor — external-process restart loop (integration)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agon-sup-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // A fake "agon" child: bumps a counter file and exits 1 until it has run
  // `failUntil` times, then exits 0 — so we can assert the supervisor restarts
  // on a crash and stops on the eventual clean exit. Tiny backoff keeps it fast.
  const writeFakeChild = (failUntil: number): string => {
    const p = join(dir, 'fake-child.mjs');
    const counter = join(dir, 'count');
    writeFileSync(p, [
      `import { readFileSync, writeFileSync, existsSync } from 'node:fs';`,
      `const c = ${JSON.stringify(counter)};`,
      `const n = existsSync(c) ? Number(readFileSync(c, 'utf8')) : 0;`,
      `writeFileSync(c, String(n + 1));`,
      `process.exit(n + 1 <= ${failUntil} ? 1 : 0);`,
    ].join('\n'));
    return p;
  };

  it('restarts on a crash and stops on the eventual clean exit', async () => {
    const child = writeFakeChild(2); // fail twice, then succeed on the 3rd run
    const res = await runSupervisor({
      nodeExec: process.execPath, agonEntry: child, childArgs: [],
      goalId: 'no-such-goal', maxRestarts: 5, baseBackoffMs: 1, capBackoffMs: 2,
    });
    expect(res.reason).toMatch(/clean exit/i);
    expect(res.restarts).toBe(2);
    expect(Number(readFileSync(join(dir, 'count'), 'utf8'))).toBe(3);
  });

  it('gives up at the restart cap when the child keeps crashing', async () => {
    const child = writeFakeChild(999); // always fail
    const res = await runSupervisor({
      nodeExec: process.execPath, agonEntry: child, childArgs: [],
      goalId: 'no-such-goal', maxRestarts: 2, baseBackoffMs: 1, capBackoffMs: 2,
    });
    expect(res.reason).toMatch(/restart cap/i);
    expect(res.restarts).toBe(2);
  });

  it('stops immediately on a deterministic failure without retrying', async () => {
    const p = join(dir, 'fake-det.mjs');
    writeFileSync(p, `process.stderr.write('A --gate command is required'); process.exit(1);`);
    const res = await runSupervisor({
      nodeExec: process.execPath, agonEntry: p, childArgs: [],
      goalId: 'no-such-goal', maxRestarts: 5, baseBackoffMs: 1, capBackoffMs: 2,
    });
    expect(res.reason).toMatch(/determin/i);
    expect(res.restarts).toBe(0);
    expect(existsSync(join(dir, 'count'))).toBe(false); // never ran the counter child
  });

  it('classifies a deterministic failure printed to STDOUT, not just stderr', async () => {
    // The CLI fail() helper writes fatal diagnostics to STDOUT — the supervisor
    // must still classify them as non-retryable (captures both streams).
    const p = join(dir, 'fake-det-stdout.mjs');
    writeFileSync(p, `process.stdout.write('queue not found: .kern-gaps/'); process.exit(1);`);
    const res = await runSupervisor({
      nodeExec: process.execPath, agonEntry: p, childArgs: [],
      goalId: 'no-such-goal', maxRestarts: 5, baseBackoffMs: 1, capBackoffMs: 2,
    });
    expect(res.reason).toMatch(/determin/i);
    expect(res.restarts).toBe(0);
  });
});
