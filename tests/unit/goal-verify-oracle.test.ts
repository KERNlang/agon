import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { witnessVerifyCommand } from '../../packages/forge/src/generated/goal/oracle.js';
import { worktreeCreate, worktreeRemoveBestEffort } from '../../packages/core/src/generated/blocks/git.js';

// The differential behavioral oracle is the load-bearing fix for "green ≠ correct":
// a verify command that EXECUTES the produced artifact must fail on base and pass on
// head. These tests run the real thing — real git worktrees, real shell commands —
// because the whole point is that a non-executing assertion cannot fake this signal.

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

describe('witnessVerifyCommand — differential execution oracle', () => {
  let home: string;
  let prev: string | undefined;
  let repo: string;
  let baseSha: string;   // "broken": feature.txt = "broken"
  let headSha: string;   // "fixed":  feature.txt = "ok"
  const worktrees: string[] = [];

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
    const r = await witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.failedOnBase).toBe(true);   // base feature.txt = "broken" -> exit 1
    expect(r.passedOnNew).toBe(true);    // head feature.txt = "ok"     -> exit 0
    expect(r.witnessed).toBe(true);
  });

  it('rejects a non-discriminating verify (passes on base too)', async () => {
    const wt = headWorktree();
    // baseSha = headSha: the behavior already exists at base, so the verify proves nothing.
    const r = await witnessVerifyCommand({ repoRoot: repo, baseSha: headSha, newWorktree: wt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.failedOnBase).toBe(false);
    expect(r.witnessed).toBe(false);
  });

  it('rejects when the implementation does not satisfy the oracle on head', async () => {
    // Point the "new worktree" at the broken base code: verify fails on head.
    const brokenWt = join(mkdtempSync(join(tmpdir(), 'agon-verify-broken-')), 'wt');
    mkdirSync(brokenWt, { recursive: true });
    worktreeCreate(repo, brokenWt, baseSha);
    worktrees.push(brokenWt);
    const r = await witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: brokenWt, verifyCmd: verifyOk, timeout: 30 });
    expect(r.passedOnNew).toBe(false);
    expect(r.witnessed).toBe(false);
  });

  it('does not count a base timeout as a valid fail-on-base', async () => {
    const wt = headWorktree();
    // Sleeps past the 1s timeout on BOTH worktrees; base "fails" only by timing out,
    // which must NOT bless the verify (a flaky/hanging base can't prove a gap).
    const r = await witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: 'sleep 5', timeout: 1 });
    expect(r.baseTimedOut).toBe(true);
    expect(r.failedOnBase).toBe(false);
    expect(r.witnessed).toBe(false);
  });
});
