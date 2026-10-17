import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as legacyOracle from '../../packages/forge/src/goal/oracle.js';
import * as legacyRedTeam from '../../packages/forge/src/goal/oracle-redteam.js';
import * as physicalGoal from '@kernlang/agon-mod-goal';
import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';
import { resolveWithinRoot } from '../../packages/core/src/blocks/paths.js';
import { worktreeCreate, worktreeRemoveBestEffort } from '../../packages/core/src/blocks/git.js';

// The differential behavioral oracle is the load-bearing fix for "green ≠ correct":
// a verify command that EXECUTES the produced artifact must fail on base and pass on
// head. These tests run the real thing — real git worktrees, real shell commands —
// because the whole point is that a non-executing assertion cannot fake this signal.

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

it('has one physical hash and red-team policy owner', () => {
  expect(physicalGoal).toHaveProperty('hashOracleInputs', legacyOracle.hashOracleInputs);
  expect(physicalGoal).toHaveProperty('oracleTampered', legacyOracle.oracleTampered);
  for (const [name, value] of Object.entries(legacyRedTeam)) expect(physicalGoal).toHaveProperty(name, value);
  expect(physicalGoal).toHaveProperty('createGoalOracleProbe', expect.any(Function));
});

describe.each(['legacy', 'physical'] as const)('%s differential execution oracle', (route) => {
  let home: string;
  let prev: string | undefined;
  let repo: string;
  let baseSha: string;   // "broken": feature.txt = "broken"
  let headSha: string;   // "fixed":  feature.txt = "ok"
  const worktrees: string[] = [];
  let oracle: Pick<typeof legacyOracle, 'witnessVerifyCommand' | 'witnessTest' | 'snapshotOracle'>;

  beforeEach(() => {
    prev = process.env.AGON_HOME;
    home = mkdtempSync(join(tmpdir(), 'agon-verify-'));
    process.env.AGON_HOME = home;

    repo = mkdtempSync(join(tmpdir(), 'agon-verify-repo-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@agon.dev');
    git(repo, 'config', 'user.name', 'agon test');
    writeFileSync(join(repo, 'feature.txt'), 'broken\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base: feature broken');
    baseSha = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'feature.txt'), 'ok\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'head: feature fixed');
    headSha = git(repo, 'rev-parse', 'HEAD').trim();
    oracle = route === 'legacy' ? legacyOracle : physicalGoal.createGoalOracle({
      path: (...parts) => join(home, ...parts),
      ensureHome: () => { mkdirSync(home, { recursive: true }); },
      spawnWithTimeout, worktreeCreate, worktreeRemoveBestEffort, resolveWithin: resolveWithinRoot,
    });
  });

  afterEach(() => {
    for (const wt of worktrees) worktreeRemoveBestEffort(repo, wt);
    worktrees.length = 0;
    if (prev === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prev;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  // The provided "new worktree" holds the head (fixed) code, like the controller's task worktree.
  const headWorktree = (): string => {
    const wt = join(mkdtempSync(join(tmpdir(), 'agon-verify-head-')), 'wt');
    mkdirSync(wt, { recursive: true });
    worktreeCreate(repo, wt, headSha);
    worktrees.push(wt);
    return wt;
  };

  const verifyOk = 'test "$(cat feature.txt)" = ok';

  it('witnesses fail-on-base + pass-on-head for a command that executes the artifact', async () => {
    const wt = headWorktree();
    const r = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.failedOnBase).toBe(true);   // base feature.txt = "broken" -> exit 1
    expect(r.passedOnNew).toBe(true);    // head feature.txt = "ok"     -> exit 0
    expect(r.witnessed).toBe(true);
  });

  it('rejects a non-discriminating verify (passes on base too)', async () => {
    const wt = headWorktree();
    // baseSha = headSha: the behavior already exists at base, so the verify proves nothing.
    const r = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha: headSha, newWorktree: wt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.failedOnBase).toBe(false);
    expect(r.witnessed).toBe(false);
  });

  it('rejects when the implementation does not satisfy the oracle on head', async () => {
    // Point the "new worktree" at the broken base code: verify fails on head.
    const brokenWt = join(mkdtempSync(join(tmpdir(), 'agon-verify-broken-')), 'wt');
    mkdirSync(brokenWt, { recursive: true });
    worktreeCreate(repo, brokenWt, baseSha);
    worktrees.push(brokenWt);
    const r = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: brokenWt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.passedOnNew).toBe(false);
    expect(r.witnessed).toBe(false);
  });

  it('does not count a base timeout as a valid fail-on-base', async () => {
    const wt = headWorktree();
    // Sleeps past the 1s timeout on BOTH worktrees; base "fails" only by timing out,
    // which must NOT bless the verify (a flaky/hanging base can't prove a gap).
    const r = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: 'sleep 5', timeout: 1 });
    expect(r.baseTimedOut).toBe(true);
    expect(r.failedOnBase).toBe(false);
    expect(r.witnessed).toBe(false);
  });

  it('copies a new test to base and removes its temporary worktree', async () => {
    const wt = headWorktree();
    writeFileSync(join(wt, 'verify.mjs'), "import fs from 'node:fs'; if (fs.readFileSync('feature.txt', 'utf8').trim() !== 'ok') process.exit(1);");
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const result = await oracle.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt,
      newTestFiles: ['verify.mjs'], testCmd: `${JSON.stringify(process.execPath)} verify.mjs`, timeout: 30 });
    expect(result).toMatchObject({ witnessed: true, failedOnBase: true, passedOnNew: true });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
    await expect(oracle.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt,
      newTestFiles: ['../escape'], testCmd: 'true', timeout: 30 })).rejects.toThrow('escapes');
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it('does not accept cancellation as a witness and cleans up', async () => {
    const wt = headWorktree();
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const abort = new AbortController();
    abort.abort();
    const result = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt,
      verifyCmd: verifyOk, timeout: 30, signal: abort.signal });
    expect(result).toMatchObject({ witnessed: false, passedOnNew: false, baseExit: 130, newExit: 130 });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it('cleans up when cancellation arrives after the base process spawns', async () => {
    const wt = headWorktree();
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const abort = new AbortController();
    let spawned = 0;
    const active = physicalGoal.createGoalOracle({
      path: (...parts) => join(home, ...parts),
      ensureHome: () => { mkdirSync(home, { recursive: true }); },
      worktreeCreate, worktreeRemoveBestEffort, resolveWithin: resolveWithinRoot,
      spawnWithTimeout: options => spawnWithTimeout({ ...options, onSpawn: () => { spawned++; abort.abort(); } }),
    });
    const result = await active.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt,
      verifyCmd: 'sleep 10', timeout: 30, signal: abort.signal });
    expect(spawned).toBe(1);
    expect(result).toMatchObject({ witnessed: false, passedOnNew: false, baseExit: 130, newExit: 130 });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it('retains gate, file identity, copies and tamper detection', () => {
    const a = join(repo, 'a', 'oracle.txt');
    const b = join(repo, 'b', 'oracle.txt');
    mkdirSync(join(repo, 'a')); mkdirSync(join(repo, 'b'));
    writeFileSync(a, 'first'); writeFileSync(b, 'second');
    const frozen = oracle.snapshotOracle({ goalId: 'snapshot', gate: verifyOk, files: [a, b] });
    expect(frozen.dir).toBe(join(home, 'goals', 'snapshot', 'oracle'));
    expect(frozen.files).toEqual([a, b]);
    expect(readFileSync(join(frozen.dir, 'files', '0-oracle.txt'), 'utf8')).toBe('first');
    expect(readFileSync(join(frozen.dir, 'files', '1-oracle.txt'), 'utf8')).toBe('second');
    expect(readFileSync(join(frozen.dir, 'gate.txt'), 'utf8')).toBe(verifyOk);
    expect(readFileSync(join(frozen.dir, 'hash.txt'), 'utf8')).toBe(legacyOracle.hashOracleInputs(verifyOk, [b, a]));
    expect(legacyOracle.oracleTampered(frozen, [a, b])).toBe(false);
    writeFileSync(a, 'changed');
    expect(legacyOracle.oracleTampered(frozen, [a, b])).toBe(true);
    expect(readFileSync(join(frozen.dir, 'files', '0-oracle.txt'), 'utf8')).toBe('first');
    expect(() => oracle.snapshotOracle({ goalId: '../escape', gate: 'true', files: [] })).toThrow('Invalid goalId');
  });
});
