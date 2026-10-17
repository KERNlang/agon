import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
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
// head. These tests use real Git worktrees and shell commands. Differential
// results are evidence of changed behavior, not proof that an assertion ran.

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

  it.each(['mjs', 'cjs'])('rejects a missing %s test helper instead of reporting behavioral sensitivity', async extension => {
    const wt = headWorktree();
    writeFileSync(join(wt, 'helper.cjs'), 'module.exports = true;\n');
    const file = `verify.${extension}`;
    writeFileSync(join(wt, file), extension === 'mjs' ? "import './helper.cjs'; process.exit(0);\n" : "require('./helper.cjs'); process.exit(0);\n");
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const result = await oracle.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt,
      newTestFiles: [file], testCmd: `${JSON.stringify(process.execPath)} ${file}`, timeout: 30 });
    expect(result).toMatchObject({ witnessed: false, failedOnBase: false, passedOnNew: true, baseInvalidReason: 'module-load' });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
    const prepared = await oracle.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt,
      newTestFiles: [file, 'helper.cjs'], testCmd: `${JSON.stringify(process.execPath)} ${file}`, timeout: 30 });
    expect(prepared).toMatchObject({ witnessed: false, baseExit: 0, newExit: 0 });
  });

  it.each([126, 127, 130, 143])('rejects base execution/cancellation exit %s even if the candidate succeeds', async code => {
    const wt = headWorktree();
    const result = await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt,
      verifyCmd: `test "$(cat feature.txt)" = ok || exit ${code}`, timeout: 30 });
    expect(result).toMatchObject({ witnessed: false, failedOnBase: false, passedOnNew: true,
      baseInvalidReason: code === 130 || code === 143 ? 'cancelled' : 'execution' });
  });

  it.each(['verify', 'test'])('does not accept cancellation as a %s witness and cleans up', async kind => {
    const wt = headWorktree();
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const abort = new AbortController();
    abort.abort();
    const result = kind === 'test'
      ? await oracle.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt, newTestFiles: [], testCmd: verifyOk, timeout: 30, signal: abort.signal })
      : await oracle.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: verifyOk, timeout: 30, signal: abort.signal });
    expect(result).toMatchObject({ witnessed: false, passedOnNew: false, baseExit: 130, newExit: 130 });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it.each(['verify', 'test'])('cleans up when cancellation arrives after the %s base process spawns', async kind => {
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
    const result = kind === 'test'
      ? await active.witnessTest({ repoRoot: repo, baseSha, newWorktree: wt, newTestFiles: [], testCmd: 'sleep 10', timeout: 30, signal: abort.signal })
      : await active.witnessVerifyCommand({ repoRoot: repo, baseSha, newWorktree: wt, verifyCmd: 'sleep 10', timeout: 30, signal: abort.signal });
    expect(spawned).toBe(1);
    expect(result).toMatchObject({ witnessed: false, passedOnNew: false, baseExit: 130, newExit: 130 });
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it('refuses to replace a frozen oracle with changed input', () => {
    const file = join(repo, 'frozen.txt');
    writeFileSync(file, 'original\n');
    const frozen = oracle.snapshotOracle({ goalId: 'immutable', gate: verifyOk, files: [file] });
    expect(oracle.snapshotOracle({ goalId: 'immutable', gate: verifyOk, files: [file] })).toEqual(frozen);
    writeFileSync(file, 'changed\n');
    expect(() => oracle.snapshotOracle({ goalId: 'immutable', gate: verifyOk, files: [file] })).toThrow();
    expect(readFileSync(join(frozen.dir, 'files', '0-frozen.txt'), 'utf8')).toBe('original\n');
    expect(readFileSync(join(frozen.dir, 'hash.txt'), 'utf8')).toBe(frozen.hash);
    expect(readFileSync(join(frozen.dir, 'gate.txt'), 'utf8')).toBe(verifyOk);
  });

  it('verifies reordered inputs without replacing their original copies', () => {
    const a = join(repo, 'a.txt'); const b = join(repo, 'b.txt');
    writeFileSync(a, 'alpha'); writeFileSync(b, 'beta');
    const frozen = oracle.snapshotOracle({ goalId: 'ordered', gate: verifyOk, files: [a, b] });
    expect(oracle.snapshotOracle({ goalId: 'ordered', gate: verifyOk, files: [b, a] }).hash).toBe(frozen.hash);
    expect(readFileSync(join(frozen.dir, 'files', '0-a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(join(frozen.dir, 'files', '1-b.txt'), 'utf8')).toBe('beta');
  });

  it('detects tampering even when legacy newline framing collides', () => {
    const a = join(repo, 'a.txt'); const b = join(repo, 'b.txt');
    writeFileSync(a, 'X'); writeFileSync(b, `Y\nfile\n${b}\nZ`);
    const frozen = oracle.snapshotOracle({ goalId: 'framing', gate: verifyOk, files: [a, b] });
    writeFileSync(a, `X\nfile\n${b}\nY`); writeFileSync(b, 'Z');
    expect(legacyOracle.hashOracleInputs(verifyOk, [a, b])).toBe(frozen.hash);
    expect(legacyOracle.oracleTampered(frozen, [a, b])).toBe(true);
  });

  it.each([true, false])('verifies a concurrent snapshot winner (identical=%s)', identical => {
    const file = join(repo, 'race.txt'); writeFileSync(file, 'proof');
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      fs.cpSync(source, destination, { recursive: true });
      if (!identical) writeFileSync(join(String(destination), 'gate.txt'), 'different gate');
      return rename(source, destination);
    });
    syncBuiltinESMExports();
    try {
      const capture = () => oracle.snapshotOracle({ goalId: 'racing', gate: verifyOk, files: [file] });
      if (identical) expect(capture().gate).toBe(verifyOk);
      else expect(capture).toThrow();
      const parent = join(home, 'goals', 'racing');
      expect(fs.readdirSync(parent)).toEqual(['oracle']);
      expect(readFileSync(join(parent, 'oracle', 'gate.txt'), 'utf8')).toBe(identical ? verifyOk : 'different gate');
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it('rejects a FIFO substituted immediately before opening an oracle input', () => {
    const file = join(repo, 'swapped.txt'); writeFileSync(file, 'regular file');
    const open = fs.openSync;
    const spy = vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
      if (String(path) === file) {
        unlinkSync(file);
        execFileSync('mkfifo', [file]);
        // Refuse unsafe reads in the fixture instead of hanging the test process.
        if (!(Number(flags) & fs.constants.O_NONBLOCK)) throw new Error('unsafe blocking oracle open');
      }
      return open(path, flags, mode);
    });
    syncBuiltinESMExports();
    try {
      expect(() => oracle.snapshotOracle({ goalId: 'fifo', gate: verifyOk, files: [file] }))
        .toThrow('not a regular file');
      expect(existsSync(join(home, 'goals', 'fifo', 'oracle'))).toBe(false);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it.each(['write', 'rename'] as const)('cleans staging after a snapshot %s failure', phase => {
    const file = join(repo, 'cleanup.txt'); writeFileSync(file, 'proof');
    const write = fs.writeFileSync;
    const spy = phase === 'write' ? vi.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
      if (String(path).includes('.oracle-') && String(path).endsWith('/hash.txt')) throw new Error('fixture write failure');
      return write(path, data, options);
    }) : vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('fixture rename failure'); });
    syncBuiltinESMExports();
    try {
      expect(() => oracle.snapshotOracle({ goalId: 'cleanup', gate: verifyOk, files: [file] })).toThrow(`fixture ${phase} failure`);
      expect(fs.readdirSync(join(home, 'goals', 'cleanup'))).toEqual([]);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it('reports both snapshot and staging-cleanup failures', () => {
    const file = join(repo, 'failed-cleanup.txt'); writeFileSync(file, 'proof');
    const write = fs.writeFileSync;
    const remove = fs.rmSync;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
      if (String(path).endsWith('/hash.txt')) throw new Error('snapshot write failed');
      return write(path, data, options);
    });
    const removeSpy = vi.spyOn(fs, 'rmSync').mockImplementation((path, options) => {
      if (String(path).includes('.oracle-')) throw new Error('staging cleanup failed');
      return remove(path, options);
    });
    syncBuiltinESMExports();
    try {
      let failure: unknown;
      try { oracle.snapshotOracle({ goalId: 'failed-cleanup', gate: verifyOk, files: [file] }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors.map(error => error.message)).toEqual(['snapshot write failed', 'staging cleanup failed']);
      expect(existsSync(join(home, 'goals', 'failed-cleanup', 'oracle'))).toBe(false);
    } finally { writeSpy.mockRestore(); removeSpy.mockRestore(); syncBuiltinESMExports(); }
  });

  it.each(['missing', 'directory'])('rejects %s oracle inputs before leaving snapshot evidence', kind => {
    const file = join(repo, 'available.txt');
    writeFileSync(file, 'available\n');
    const unavailable = kind === 'missing' ? join(repo, 'missing.txt') : repo;
    expect(() => oracle.snapshotOracle({ goalId: 'unavailable', gate: verifyOk, files: [file, unavailable] })).toThrow();
    expect(existsSync(join(home, 'goals', 'unavailable', 'oracle'))).toBe(false);
  });

  it('detects a deleted empty oracle file and distinct binary bytes', () => {
    const empty = join(repo, 'empty.txt');
    writeFileSync(empty, '');
    const frozen = oracle.snapshotOracle({ goalId: 'empty', gate: verifyOk, files: [empty] });
    unlinkSync(empty);
    expect(legacyOracle.oracleTampered(frozen, [empty])).toBe(true);
    const binary = join(repo, 'binary.dat');
    writeFileSync(binary, Buffer.from([0x80]));
    const captured = oracle.snapshotOracle({ goalId: 'binary', gate: verifyOk, files: [binary] });
    expect(readFileSync(join(captured.dir, 'files', '0-binary.dat'))).toEqual(Buffer.from([0x80]));
    writeFileSync(binary, Buffer.from([0x81]));
    expect(legacyOracle.oracleTampered(captured, [binary])).toBe(true);
    expect(legacyOracle.hashOracleInputs(verifyOk, [binary])).toBe(captured.hash);
  });

  it.each([Buffer.from('UTF-8 snowman: ☃\n'), Buffer.from([0x80])])('preserves legacy digest compatibility for %j', bytes => {
    const file = join(repo, 'legacy.dat'); writeFileSync(file, bytes);
    const expected = createHash('sha256').update(`gate\n${verifyOk}\nfile\n${file}\n${bytes.toString('utf8')}\n`).digest('hex');
    expect(legacyOracle.hashOracleInputs(verifyOk, [file])).toBe(expected);
    const frozen = oracle.snapshotOracle({ goalId: 'legacy-compatible', gate: verifyOk, files: [file] });
    expect(frozen.hash).toBe(expected);
    unlinkSync(join(frozen.dir, 'files.json'));
    expect(legacyOracle.oracleTampered(frozen, [file])).toBe(false);
    expect(oracle.snapshotOracle({ goalId: 'legacy-compatible', gate: verifyOk, files: [file] })).toEqual(frozen);
  });

  it('refuses to repair corrupted snapshot evidence implicitly', () => {
    const file = join(repo, 'proof.txt');
    writeFileSync(file, 'source proof\n');
    const frozen = oracle.snapshotOracle({ goalId: 'corrupted', gate: verifyOk, files: [file] });
    const copied = join(frozen.dir, 'files', '0-proof.txt');
    writeFileSync(copied, 'changed evidence\n');
    expect(() => oracle.snapshotOracle({ goalId: 'corrupted', gate: verifyOk, files: [file] })).toThrow();
    expect(readFileSync(copied, 'utf8')).toBe('changed evidence\n');
    expect(readFileSync(file, 'utf8')).toBe('source proof\n');
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
