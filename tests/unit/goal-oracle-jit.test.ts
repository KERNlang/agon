// ── agon goal — the oracle red-team is per TASK and per LAUNCH ──────────────
// Regression suite for the self-disabling oracle gate. The red-team used to be a
// goal-global BATCH pre-flight guarded by a PERSISTED boolean
// (JournalState.oracleGateChecked), which produced two coupled defects:
//
//   1. the panel probe is STOCHASTIC, so one clean pass was cached forever and
//      every later launch — strict included — silently skipped the gate;
//   2. the batch only considered tasks whose dependsOn were already `done`, so a
//      verify that unblocks mid-run was never probed at all.
//
// These run the REAL controller against a real git repo with fake engines (the
// probe/implement/review callbacks are injected), because the bug lived in WHEN
// the probe is called, not in the pure warn/strict decision (covered by
// oracle-redteam.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGoalController } from '../../packages/forge/src/generated/goal/controller.js';
import { journalPath, loadJournal } from '../../packages/forge/src/generated/goal/journal.js';
import type { GoalSpec, JournalState } from '../../packages/forge/src/generated/goal/types.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

const GOAL_ID = 'oracle-jit-test';

describe('goal controller — JIT per-task oracle red-team', () => {
  let home: string;
  let prevHome: string | undefined;
  let repo: string;

  const spec = (): GoalSpec => ({
    goalId: GOAL_ID,
    intent: 'close two gaps',
    branch: 'goal/oracle-jit-test',
    gate: 'true',
    queueSource: 'inline',
    maxAttempts: 3,
    budgetUsd: 100,
    maxHours: 8,
    supervised: false,
  });

  // t2 depends on t1: at launch time only t1 is runnable, so the OLD batch
  // pre-flight (which filtered on already-done deps) could never probe t2.
  const tasks = [
    { id: 't1', source: 'add feature one', verify: 'test -f one.txt' },
    { id: 't2', source: 'add feature two', dependsOn: ['t1'], verify: 'test -f two.txt' },
  ];

  // A "real" engine: writes the file the task's verify asserts on. Non-test file
  // (requireTests:false skips the witness) with no mutable operators, so the
  // mutation gate generates nothing and the task lands.
  const goodImplement = async (a: { task: { id: string }; worktree: string }) => {
    writeFileSync(join(a.worktree, a.task.id === 't1' ? 'one.txt' : 'two.txt'), 'ok\n');
    return { ok: true, costUsd: 0 };
  };
  const passingReview = async () => ({ blocking: false, summary: 'no findings', costUsd: 0 });

  const run = (over: Record<string, unknown>) =>
    runGoalController({
      spec: spec(),
      repoRoot: repo,
      tasks,
      requireTests: false,
      gateTimeoutSec: 60,
      witnessTimeoutSec: 60,
      oracleGate: 'warn',
      implement: goodImplement,
      review: passingReview,
      ...over,
    } as Parameters<typeof runGoalController>[0]);

  beforeEach(() => {
    prevHome = process.env.AGON_HOME;
    home = mkdtempSync(join(tmpdir(), 'agon-oracle-jit-home-'));
    process.env.AGON_HOME = home;

    repo = mkdtempSync(join(tmpdir(), 'agon-oracle-jit-repo-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@agon.dev');
    git(repo, 'config', 'user.name', 'agon test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const recordingRedTeam = (probes: string[]) =>
    async (a: { tasks: Array<{ id: string }> }) => {
      for (const t of a.tasks) probes.push(t.id);
      return { holes: [], costUsd: 0 };   // clean pass — the stochastic result that used to be cached forever
    };

  it('probes EVERY runnable task exactly once, incl. one whose deps unblock mid-run, and journals the clean pass', async () => {
    const probes: string[] = [];
    const state = await run({ oracleRedTeam: recordingRedTeam(probes) }) as JournalState;

    // Both tasks landed…
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    // …and BOTH were red-teamed — t2 the moment its dependency became done. The
    // batch pre-flight filtered t2 out (dep not yet done) and never came back.
    expect(probes).toEqual(['t1', 't2']);

    // A clean pass is now AUDITABLE: it used to be emit-only, which is exactly
    // why a cached stochastic pass left no trace in the goal artifact.
    const ok = state.events.filter((e) => e.kind === 'oracle-gate-ok');
    expect(ok.map((e) => e.taskId)).toEqual(['t1', 't2']);

    // Nothing about the probe is persisted any more.
    const onDisk = JSON.parse(readFileSync(journalPath(GOAL_ID), 'utf-8'));
    expect(onDisk.oracleGateChecked).toBeUndefined();
  }, 120_000);

  it('does not re-probe the same task on a SAME-LAUNCH retry', async () => {
    const probes: string[] = [];
    let firstAttempt = true;
    const flakyImplement = async (a: { task: { id: string }; worktree: string }) => {
      if (a.task.id === 't1' && firstAttempt) { firstAttempt = false; return { ok: false, costUsd: 0, error: 'engine blew up' }; }
      return goodImplement(a);
    };
    const state = await run({ oracleRedTeam: recordingRedTeam(probes), implement: flakyImplement }) as JournalState;

    expect(state.tasks.find((t) => t.id === 't1')!.attempts).toBe(2);   // it really did retry
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    // The probe attacks task.verify (frozen for the task), not the patch, so a
    // retry of the same task in the same launch is redundant by design.
    expect(probes.filter((p) => p === 't1')).toHaveLength(1);
    expect(probes).toEqual(['t1', 't2']);
  }, 120_000);

  it('re-probes on the NEXT launch — a clean pass is never cached across launches', async () => {
    // LAUNCH 1: t1 is probed, then the run is aborted mid-attempt so t1 stays queued.
    const first: string[] = [];
    const abort = new AbortController();
    const abortingImplement = async () => { abort.abort(); return { ok: false, costUsd: 0, error: 'interrupted' }; };
    await run({ oracleRedTeam: recordingRedTeam(first), implement: abortingImplement, signal: abort.signal });
    expect(first).toEqual(['t1']);
    expect(loadJournal(GOAL_ID)!.tasks.find((t) => t.id === 't1')!.status).toBe('queued');

    // Simulate a journal written by the OLD version: the goal-global flag is set.
    // It must still PARSE (deprecated, read-only) and must NOT suppress anything.
    const jp = journalPath(GOAL_ID);
    const legacy = JSON.parse(readFileSync(jp, 'utf-8'));
    legacy.oracleGateChecked = true;
    writeFileSync(jp, JSON.stringify(legacy, null, 2));

    // LAUNCH 2: fresh controller call, fresh in-process set → t1 is probed AGAIN.
    const second: string[] = [];
    const state = await run({ oracleRedTeam: recordingRedTeam(second), resume: true }) as JournalState;
    expect(second).toEqual(['t1', 't2']);
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
  }, 120_000);

  it('strict + a gameable verify stops the launch at the offending task', async () => {
    const gamingRedTeam = async (a: { tasks: Array<{ id: string }> }) => ({
      holes: a.tasks.map((t) => ({ taskId: t.id, engine: 'codex', evidence: 'a cheating implementation made the verify pass' })),
      costUsd: 0,
    });
    const state = await run({ oracleGate: 'strict', oracleRedTeam: gamingRedTeam }) as JournalState;

    expect(state.tasks.every((t) => t.status === 'queued')).toBe(true);   // nothing was forged
    expect(state.events.some((e) => e.kind === 'stop' && e.detail === 'oracle-gameable')).toBe(true);
    expect(state.events.some((e) => e.kind === 'oracle-gameable' && e.taskId === 't1')).toBe(true);
  }, 120_000);

  // The gate must be ON for a caller that never mentions it. The CLI defaulted
  // to 'warn' while the controller defaulted to 'off', so the supervisor, tests
  // and any embedder ran un-gated while every doc promised otherwise.
  it('probes by DEFAULT when oracleGate is omitted entirely', async () => {
    const probes: string[] = [];
    await run({ oracleGate: undefined, oracleRedTeam: recordingRedTeam(probes) });
    expect(probes).toEqual(['t1', 't2']);
  }, 120_000);

  it('never probes when the gate is explicitly off', async () => {
    const probes: string[] = [];
    const state = await run({ oracleGate: 'off', oracleRedTeam: recordingRedTeam(probes) }) as JournalState;
    expect(probes).toEqual([]);
    expect(state.events.some((e) => e.kind.startsWith('oracle-gate'))).toBe(false);
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
  }, 120_000);

  // warn = report and CONTINUE. The strict path was covered; this one was not.
  it('warn + a gameable verify reports the hole and still forges the task', async () => {
    const gamingRedTeam = async (a: { tasks: Array<{ id: string }> }) => ({
      holes: a.tasks.map((t) => ({ taskId: t.id, engine: 'codex', evidence: 'a cheating implementation made the verify pass' })),
      costUsd: 0,
    });
    const state = await run({ oracleGate: 'warn', oracleRedTeam: gamingRedTeam }) as JournalState;
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    expect(state.events.filter((e) => e.kind === 'oracle-gameable').map((e) => e.taskId)).toEqual(['t1', 't2']);
    expect(state.events.some((e) => e.kind === 'stop')).toBe(false);
  }, 120_000);

  // The production callback catches its own forge failures, so a broken probe
  // arrives as `holes: []` — byte-identical to "nobody could cheat this verify".
  // Believing it journaled `oracle-gate-ok` and marked the task checked, i.e. it
  // certified an oracle it had never actually measured.
  it('an INCONCLUSIVE probe (errored:true with no holes) is never a clean pass', async () => {
    const seen: string[] = [];
    let inconclusive = true;
    const brokenRedTeam = async (a: { tasks: Array<{ id: string }> }) => {
      seen.push(a.tasks[0]!.id);
      if (inconclusive) {
        inconclusive = false;
        return { holes: [], costUsd: 0, errored: true, errorDetail: 'all 5 red-team seat(s) failed to complete' };
      }
      return { holes: [], costUsd: 0 };
    };
    // t1's first implement fails so the task is picked a second time — which is
    // the only way to observe whether the failed probe was cached as "checked".
    let firstAttempt = true;
    const flakyImplement = async (a: { task: { id: string }; worktree: string }) => {
      if (a.task.id === 't1' && firstAttempt) { firstAttempt = false; return { ok: false, costUsd: 0, error: 'engine blew up' }; }
      return goodImplement(a);
    };
    const state = await run({ oracleRedTeam: brokenRedTeam, implement: flakyImplement }) as JournalState;

    // It was NOT certified on the failed attempt — t1 is probed again.
    expect(seen).toEqual(['t1', 't1', 't2']);
    // And the failure is DURABLE, not emit-only: the artifact must be able to
    // show "the gate ran and learned nothing", or it is indistinguishable from
    // --oracle-gate=off.
    const errs = state.events.filter((e) => e.kind === 'oracle-gate-error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!.taskId).toBe('t1');
    expect(errs[0]!.detail).toContain('failed to complete');
    // The clean pass is only recorded for the attempts that really measured.
    expect(state.events.filter((e) => e.kind === 'oracle-gate-ok').map((e) => e.taskId)).toEqual(['t1', 't2']);
  }, 120_000);

  // The retry is intentional (a transient failure must not permanently un-gate a
  // task) but it cannot be unbounded, or a persistently broken panel spends the
  // whole budget looping on the safety check instead of doing the work.
  it('caps probe attempts per task per launch at 2, then forges UNPROBED and says so', async () => {
    const seen: string[] = [];
    const alwaysBroken = async (a: { tasks: Array<{ id: string }> }) => {
      seen.push(a.tasks[0]!.id);
      throw new Error('panel unreachable');
    };
    // t1's first two implements fail, so it is picked three times: probe, probe,
    // then the cap. maxAttempts is raised so the retries are not what parks it.
    let t1Fails = 2;
    const flakyImplement = async (a: { task: { id: string }; worktree: string }) => {
      if (a.task.id === 't1' && t1Fails > 0) { t1Fails -= 1; return { ok: false, costUsd: 0, error: 'engine blew up' }; }
      return goodImplement(a);
    };
    const state = await run({
      spec: { ...spec(), maxAttempts: 6 },
      oracleRedTeam: alwaysBroken,
      implement: flakyImplement,
    }) as JournalState;

    // Exactly two probe attempts for t1 — never a third.
    expect(seen.filter((p) => p === 't1')).toHaveLength(2);
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    const gaveUp = state.events.filter((e) => e.kind === 'oracle-gate-error' && (e.detail ?? '').includes('gave up'));
    expect(gaveUp.map((e) => e.taskId)).toEqual(['t1']);
    expect(gaveUp[0]!.detail).toContain('UNPROBED');
  }, 120_000);

  // The probe spends real money and real wall-clock before the implement leg.
  it('stops on budget when the PROBE exhausted it, instead of forging anyway', async () => {
    const implement = vi.fn(goodImplement);
    const expensiveRedTeam = async () => ({ holes: [], costUsd: 1000 });
    const state = await run({ oracleRedTeam: expensiveRedTeam, implement }) as JournalState;

    expect(state.spentUsd).toBeGreaterThanOrEqual(100);
    expect(state.events.some((e) => e.kind === 'stop' && e.detail === 'budget')).toBe(true);
    // The whole point: no forge was dispatched after the budget was blown.
    expect(implement).not.toHaveBeenCalled();
    expect(state.tasks.every((t) => t.status === 'queued')).toBe(true);
  }, 120_000);

  // DEFAULT_ORACLE_GATE turns the gate on for every caller, but the PROBE needs
  // a red-team callback the CLI supplies and a direct library caller may not.
  // Silently skipping it made the default a promise the controller did not keep.
  it('journals oracle-gate-skipped ONCE when the gate is on but no red-team callback was supplied', async () => {
    const state = await run({ oracleRedTeam: undefined }) as JournalState;

    const skipped = state.events.filter((e) => e.kind === 'oracle-gate-skipped');
    expect(skipped).toHaveLength(1);                       // one note per launch, not one per task
    expect(skipped[0]!.detail).toContain('no red-team callback');
    expect(skipped[0]!.detail).toContain('INACTIVE');
    expect(skipped[0]!.detail).toContain('warn');
    // The work still runs — an unavailable safety check is reported, not fatal.
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    // …and it is DURABLE, not emit-only.
    const onDisk = JSON.parse(readFileSync(journalPath(GOAL_ID), 'utf-8')) as JournalState;
    expect(onDisk.events.filter((e) => e.kind === 'oracle-gate-skipped')).toHaveLength(1);
  }, 120_000);

  it('says nothing when the gate is off and no callback was supplied', async () => {
    const state = await run({ oracleGate: 'off', oracleRedTeam: undefined }) as JournalState;
    expect(state.events.some((e) => e.kind === 'oracle-gate-skipped')).toBe(false);
    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);
  }, 120_000);

  // persistGateLog builds a filename from the QUEUE-authored task id, and
  // runGoalController is an exported entry point — a library caller does not
  // slug ids. `../../..` must never author a writeFileSync path.
  it('a traversal task id can never write a gate log outside the goal dir', async () => {
    const evil = '../../../../../../tmp/agon-goal-pwn';
    const state = await runGoalController({
      // Green at base (no one.txt yet), RED in the task worktree once the
      // implement leg writes it — so the gate log is written for the TASK.
      spec: { ...spec(), gate: 'test ! -f one.txt', maxAttempts: 1 },
      repoRoot: repo,
      tasks: [{ id: evil, source: 'do a thing' }],
      requireTests: false,
      gateTimeoutSec: 60,
      witnessTimeoutSec: 60,
      oracleGate: 'off',
      implement: async (a: { worktree: string }) => {
        writeFileSync(join(a.worktree, 'one.txt'), 'ok\n');
        return { ok: true, costUsd: 0 };
      },
      review: passingReview,
    } as Parameters<typeof runGoalController>[0]) as JournalState;

    const goalHome = join(home, 'goals', GOAL_ID);
    // The log landed INSIDE the goal dir under the sanitized segment…
    const written = readdirSync(goalHome).filter((f) => f.endsWith('-gate.log'));
    expect(written).toEqual(['tmp-agon-goal-pwn-gate.log']);
    expect(readFileSync(join(goalHome, written[0]!), 'utf-8')).toContain('test ! -f one.txt');
    // …and nothing was written where the traversal pointed.
    expect(existsSync(join(tmpdir(), 'agon-goal-pwn-gate.log'))).toBe(false);
    // The failure is still reported against the task.
    expect(state.tasks[0]!.status).not.toBe('done');
  }, 120_000);

  it('a probe ERROR never aborts the run and leaves the task unmarked, so the next pick retries it', async () => {
    const seen: string[] = [];
    let boom = true;
    const flakyRedTeam = async (a: { tasks: Array<{ id: string }> }) => {
      seen.push(a.tasks[0]!.id);
      if (boom) { boom = false; throw new Error('panel unreachable'); }
      return { holes: [], costUsd: 0 };
    };
    let firstAttempt = true;
    const flakyImplement = async (a: { task: { id: string }; worktree: string }) => {
      if (a.task.id === 't1' && firstAttempt) { firstAttempt = false; return { ok: false, costUsd: 0, error: 'engine blew up' }; }
      return goodImplement(a);
    };
    const state = await run({ oracleRedTeam: flakyRedTeam, implement: flakyImplement }) as JournalState;

    expect(state.tasks.map((t) => t.status)).toEqual(['done', 'done']);   // a safety check never stops the work
    expect(seen).toEqual(['t1', 't1', 't2']);                            // errored probe was NOT marked as checked
  }, 120_000);
});
