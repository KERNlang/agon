import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as engineRuntime from '@kernlang/agon-support-engine-runtime';
import * as worktreeSupport from '@kernlang/agon-support-worktree';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runGoal, runGoalSupervisor } from './implementation.js';
import { createGoalHostServices } from './host.js';
import { createSessionWorktree, findSessionWorktree, worktreePathFor, rehydrateSessionWorktree } from '@kernlang/agon-support-worktree';
import type { WorktreeSessionRuntime } from '@kernlang/agon-support-worktree';
import { WriterFence } from '@kernlang/agon-kernel';

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-goal-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'g@example.invalid'], { cwd });
  execFileSync('git', ['config', 'user.name', 'G'], { cwd });
  writeFileSync(join(cwd, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-m', 'base'], { cwd });
  return cwd;
}

afterEach(() => vi.restoreAllMocks());

function harness(hostOptions: Partial<Parameters<typeof createGoalHostServices>[0]> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'agon-goal-home-'));
  const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const runtime: WorktreeSessionRuntime = {
    getAgonHome: () => home, ensureAgonHome: () => undefined,
    worktreeAddOnBranch(root, path, branch, base, _link, fresh) {
      if (fresh) git(root, ['worktree', 'add', '-b', branch, path, base ?? 'HEAD']);
      else git(root, ['worktree', 'add', path, branch]);
      return path;
    },
    worktreeRemoveBestEffort: (root, path) => { git(root, ['worktree', 'remove', '--force', path]); },
    linkWorktreeNodeModules: () => undefined, hydrateWorktreeBuildArtifacts: () => undefined,
    absoluteGitDir: cwd => git(cwd, ['rev-parse', '--absolute-git-dir']),
    isDirty: cwd => Boolean(git(cwd, ['status', '--porcelain'])),
    worktreePrune: cwd => { git(cwd, ['worktree', 'prune']); },
  };
  const worktrees = {
      createSessionWorktree: options => createSessionWorktree(options, runtime),
      findSessionWorktree: (root, branch) => findSessionWorktree(root, branch, runtime),
      worktreePathFor: (root, branch) => worktreePathFor(root, branch, runtime),
      rehydrateSessionWorktree: vi.fn((root: string, branch: string) => rehydrateSessionWorktree(root, branch, runtime)),
  } satisfies Parameters<typeof createGoalHostServices>[0]['worktrees'];
  const oracleEffects: NonNullable<Parameters<typeof createGoalHostServices>[0]['oracleEffects']> = {
      path: (...parts) => join(home, ...parts), ensureHome: () => undefined,
      spawnWithTimeout: engineRuntime.spawnWithTimeout,
      resolveWithin: worktreeSupport.resolveWithinRoot,
      worktreeCreate: (root, path, sha) => { git(root, ['worktree', 'add', '--detach', path, sha]); return path; },
      worktreeRemoveBestEffort: runtime.worktreeRemoveBestEffort,
  };
  const goal = createGoalHostServices({
    oracleEffects,
    acquireWriter: id => WriterFence.acquire(join(home, `${id}.lock`), `agon.goal:${id}`),
    captureAuthority: () => () => undefined,
    worktrees,
    ...hostOptions,
  });
  const state = new Map<string, any>();
  const dispatch = vi.fn(async (_id: string, prompt: string, context: any, options: any) => {
    if (options.mode === 'agent') {
      if (prompt.includes('TASK first')) writeFileSync(join(context.cwd, 'first.ts'), 'export const first = true;\n');
      else writeFileSync(join(context.cwd, 'second.ts'), 'export const second = true;\n');
      return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    }
    return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
  });
  const finish = vi.fn(async () => undefined);
  const writeArtifact = vi.fn(async () => undefined);
  const services = {
    goal,
    identity: { id: 'agon.goal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'goal-r') },
    permissions: { check: vi.fn(async () => 'allow') },
    state: {
      read: vi.fn(async (key: string) => state.get(key)),
      write: vi.fn(async (key: string, value: any) => { state.set(key, value); }),
    },
    runs: {
      start: vi.fn(async (mode: string) => ({ id: `${mode}-run`, path: `/tmp/${mode}-run`, mode, startedAt: '2026-01-01T00:00:00Z' })),
      finish, writeArtifact,
    },
    engines: { listActive: vi.fn(async () => ['builder', 'reviewer']), dispatch },
  } as unknown as ModServices;
  return { state, dispatch, finish, writeArtifact, services, goal, worktrees, oracleEffects };
}

const context = (cwd: string) => ({
  invocationId: 'g', cwd, platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {},
});

describe('physical goal mod', () => {
  it('honors a separate witness cancellation signal', async () => {
    const cwd = repo(); const h = harness(); let spawned = 0;
    h.oracleEffects.spawnWithTimeout = options => engineRuntime.spawnWithTimeout({ ...options, onSpawn: () => { spawned++; } });
    const host = h.goal.open(context(cwd));
    const worktree = host.openWorktree('goal/separate-cancellation');
    writeFileSync(join(worktree.path, 'second.ts'), 'export const second = true;\n');
    const abort = new AbortController(); abort.abort();
    const witness = await host.verification!(async () => undefined).witnessVerifyCommand({
      repoRoot: cwd, baseSha: worktree.baseSha, newWorktree: worktree.path,
      verifyCmd: 'test -f second.ts', timeout: 10, signal: abort.signal });
    expect(witness).toMatchObject({ witnessed: false, baseExit: 130, newExit: 130 });
    expect(spawned).toBe(0);
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).match(/^worktree /gm)).toHaveLength(2);
  });

  it('fails closed when a legacy host lacks verification effects', async () => {
    const cwd = repo(); const h = harness({ oracleEffects: undefined });
    const out = await runGoal({ intent: 'missing witness host', gate: 'test -f base.txt',
      tasks: [{ id: 'second', source: 'second', verify: 'test -f second.ts' }],
      oracleGate: 'off', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state.tasks[0].error).toContain('verification capabilities are unavailable');
    expect(h.dispatch).toHaveBeenCalledOnce();
  });

  it.each([true, false])('checks the second task against its own accepted base (commit=%s)', async commit => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'task bases', gate: 'test -f base.txt',
      tasks: [{ id: 'first', source: 'first', verify: 'test -f first.ts' },
        { id: 'second', source: 'second', dependsOn: ['first'], verify: 'test -f first.ts' }],
      commit, oracleGate: 'off', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'failed']);
    expect((out.result as any).state.tasks[1].error).toContain('base exit 0');
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/task-bases'], { cwd, encoding: 'utf8' }).trim()).toBe(commit ? '1' : '0');
  });

  it('does not accept a test that fails on base only because its helper is missing', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'helper.mjs'), 'export const ready = true;\n');
        writeFileSync(join(invocation.cwd, 'answer.test.mjs'), "import './helper.mjs'; process.exit(0);\n");
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'missing test helper', gate: 'test ! -f answer.test.mjs || node answer.test.mjs',
      maxAttempts: 1 }, context(cwd), h.services);
    const witnessEvent = (out.result as any).state.events.find((entry: any) => entry.type === 'test-witness');
    expect(JSON.parse(witnessEvent.detail)).toMatchObject({ witnessed: false, baseInvalidReason: 'module-load' });
    expect(out.exitCode).toBe(1);
    expect(h.dispatch).toHaveBeenCalledOnce();
  });

  it('keeps accepted uncommitted tests on the next task baseline', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        const name = prompt.includes('TASK first') ? 'first' : 'second';
        writeFileSync(join(invocation.cwd, `${name}.ts`), `export const ${name} = true;\n`);
        writeFileSync(join(invocation.cwd, `${name}.test.mjs`), `import fs from 'node:fs'; if (!fs.existsSync('${name}.ts')) process.exit(1);\n`);
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'uncommitted tests',
      gate: 'for f in *.test.mjs; do test ! -f "$f" || node "$f" || exit 1; done', commit: false,
      tasks: [{ id: 'first', source: 'first' }, { id: 'second', source: 'second', dependsOn: ['first'] }],
      maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode, JSON.stringify(out)).toBe(0);
    const state = (out.result as any).state;
    expect(state.tasks.map((task: any) => task.status)).toEqual(['done', 'done']);
    expect(state.events.filter((entry: any) => entry.type === 'test-witness').map((entry: any) => JSON.parse(entry.detail).file))
      .toEqual(['first.test.mjs', 'second.test.mjs']);
    expect(state.tasks[1].verificationBase.patch).toContain('first.ts');
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/uncommitted-tests'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
  });

  it('retains the uncommitted task baseline across failed work and resume', async () => {
    const cwd = repo(); const h = harness(); let secondBuilds = 0;
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        const name = prompt.includes('TASK first') ? 'first' : 'second';
        writeFileSync(join(invocation.cwd, `${name}.ts`), `export const ${name} = true;\n`);
        if (name === 'second' && ++secondBuilds === 1) return { exitCode: 1, stdout: '', stderr: 'interrupted builder', timedOut: false };
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const input = { intent: 'resume uncommitted', gate: 'test -f base.txt', commit: false,
      tasks: [{ id: 'first', source: 'first', verify: 'test -f first.ts' },
        { id: 'second', source: 'second', dependsOn: ['first'], verify: 'test -f second.ts' }],
      oracleGate: 'off', requireTests: false, maxAttempts: 1 };
    const first = await runGoal(input, context(cwd), h.services);
    expect(first.exitCode).toBe(1);
    const baseline = (first.result as any).state.tasks[1].verificationBase;
    expect(baseline.patch).toContain('first.ts');
    expect(baseline.patch).not.toContain('second.ts');
    const resumed = await runGoal({ ...input, resume: true, maxAttempts: 2 }, context(cwd), h.services);
    expect(resumed.exitCode, JSON.stringify(resumed)).toBe(0);
    expect((resumed.result as any).state.tasks[1].verificationBase).toEqual(baseline);
    expect(secondBuilds).toBe(2);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/resume-uncommitted'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
  });

  it('rejects a timed-out base and removes its verification worktree', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'timeout witness', gate: 'test -f base.txt',
      tasks: [{ id: 'second', source: 'second', verify: 'if test -f second.ts; then exit 0; else sleep 5; fi' }],
      oracleGate: 'off', requireTests: false, gateTimeout: 1, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state.tasks[0].error).toContain('timed out');
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).match(/^worktree /gm)).toHaveLength(2);
  });

  it.each(['cancellation', 'generation', 'fence'])('stops between witness commands after %s changes', async change => {
    const cwd = repo(); const abort = new AbortController();
    let current = true, owned = true, spawned = 0;
    const h = harness({ captureAuthority: () => () => { if (!current) throw new Error('generation changed'); },
      acquireWriter: async () => ({ assertOwned: async () => { if (!owned) throw new Error('fence changed'); }, release: async () => undefined }) });
    h.oracleEffects.spawnWithTimeout = options => engineRuntime.spawnWithTimeout({ ...options, onSpawn: () => {
      spawned++;
      if (change === 'cancellation') abort.abort(new Error('cancellation changed'));
      if (change === 'generation') current = false;
      if (change === 'fence') owned = false;
    } });
    await expect(runGoal({ intent: 'witness authority', gate: 'test -f base.txt',
      tasks: [{ id: 'second', source: 'second', verify: 'test -f second.ts' }],
      oracleGate: 'off', requireTests: false, maxAttempts: 1 }, { ...context(cwd), signal: abort.signal }, h.services)).rejects.toThrow(`${change} changed`);
    expect(spawned).toBe(1);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).match(/^worktree /gm)).toHaveLength(2);
    expect(existsSync(join(cwd, 'second.ts'))).toBe(false);
  });

  it.each(['cancellation', 'generation', 'fence'])('rejects %s loss before the first witness process starts', async change => {
    const cwd = repo(); const abort = new AbortController();
    let current = true, owned = true, spawned = 0;
    const h = harness({ captureAuthority: () => () => { if (!current) throw new Error('generation changed'); },
      acquireWriter: async () => ({ assertOwned: async () => { if (!owned) throw new Error('fence changed'); }, release: async () => undefined }) });
    const create = h.oracleEffects.worktreeCreate;
    h.oracleEffects.worktreeCreate = (...args) => {
      const path = create(...args);
      if (change === 'cancellation') abort.abort(new Error('cancellation changed'));
      if (change === 'generation') current = false;
      if (change === 'fence') owned = false;
      return path;
    };
    h.oracleEffects.spawnWithTimeout = options => engineRuntime.spawnWithTimeout({ ...options, onSpawn: () => { spawned++; } });
    await expect(runGoal({ intent: 'pre-spawn authority', gate: 'test -f base.txt',
      tasks: [{ id: 'second', source: 'second', verify: 'test -f second.ts' }],
      oracleGate: 'off', requireTests: false, maxAttempts: 1 }, { ...context(cwd), signal: abort.signal }, h.services)).rejects.toThrow(`${change} changed`);
    expect(spawned).toBe(0);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).match(/^worktree /gm)).toHaveLength(2);
  });

  it.each([
    [false, 'answer.test.mjs', false], [true, 'answer.test.mjs', false],
    [false, 'über.test.mjs', false], [true, 'über.test.mjs', false],
    [false, 'answer.test.mjs', true], [true, 'answer.test.mjs', true],
    [false, 'über.test.mjs', true], [true, 'über.test.mjs', true],
  ] as const)('requires changed tests to witness the implementation (tautology=%s, file=%s, tracked=%s)', async (tautology, testFile, tracked) => {
    const cwd = repo(); const h = harness();
    writeFileSync(join(cwd, 'answer.mjs'), 'export const answer = false;\n');
    execFileSync('git', ['add', 'answer.mjs'], { cwd });
    if (tracked) {
      writeFileSync(join(cwd, testFile), '// Original check\nprocess.exit(0);\n');
      execFileSync('git', ['add', testFile], { cwd });
    }
    execFileSync('git', ['commit', '-m', 'base behavior'], { cwd });
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'answer.mjs'), 'export const answer = true;\n');
        writeFileSync(join(invocation.cwd, testFile), tautology
          ? 'process.exit(0);\n'
          : "import { answer } from './answer.mjs'; if (!answer) process.exit(1);\n");
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'test sensitivity', gate: `test ! -f '${testFile}' || node '${testFile}'`,
      engine: 'builder', reviewEngines: 'reviewer', maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode, JSON.stringify(out)).toBe(tautology ? 1 : 0);
    const witnessEvent = (out.result as any).state.events.find((entry: any) => entry.type === 'test-witness');
    expect(JSON.parse(witnessEvent.detail)).toMatchObject({ file: testFile, witnessed: !tautology,
      baseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim() });
    if (tautology) {
      expect(h.dispatch).toHaveBeenCalledOnce();
      expect((out.result as any).state.events).toContainEqual(expect.objectContaining({ type: 'witness-failed' }));
      expect(execFileSync('git', ['rev-list', '--count', 'main..goal/test-sensitivity'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    }
    expect(readFileSync(join(cwd, 'answer.mjs'), 'utf8')).toContain('false');
  });

  it('does not count a deleted test as a witnessing test', async () => {
    const cwd = repo(); const h = harness();
    writeFileSync(join(cwd, 'old.test.mjs'), 'process.exit(0);\n');
    execFileSync('git', ['add', 'old.test.mjs'], { cwd });
    execFileSync('git', ['commit', '-m', 'old test'], { cwd });
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any) => {
      unlinkSync(join(invocation.cwd, 'old.test.mjs'));
      writeFileSync(join(invocation.cwd, 'second.ts'), 'export const second = true;\n');
      return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'deleted test', gate: 'test -f base.txt', maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state.events).toContainEqual(expect.objectContaining({ type: 'witness-failed' }));
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(existsSync(join(cwd, 'old.test.mjs'))).toBe(true);
  });

  it('retries against the committed task base instead of retained failed edits', async () => {
    const cwd = repo(); const h = harness(); let builds = 0;
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        builds++;
        writeFileSync(join(invocation.cwd, 'second.ts'), 'export const second = true;\n');
        writeFileSync(join(invocation.cwd, 'check.test.mjs'), builds === 1 ? 'process.exit(0);\n'
          : "import fs from 'node:fs'; if (!fs.existsSync('second.ts')) process.exit(1);\n");
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'witness retry', gate: 'test ! -f check.test.mjs || node check.test.mjs', maxAttempts: 2 }, context(cwd), h.services);
    expect(out.exitCode, JSON.stringify(out)).toBe(0);
    expect(builds).toBe(2);
    expect((out.result as any).state.events.filter((entry: any) => entry.type === 'witness-failed')).toHaveLength(1);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/witness-retry'], { cwd, encoding: 'utf8' }).trim()).toBe('1');
  });

  it.each([false, true])('requires differential task verification even with red-team off (already green=%s)', async alreadyGreen => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'differential verification', gate: 'test -f base.txt',
      tasks: [{ id: 'second', source: 'make second', verify: alreadyGreen ? 'test -f base.txt' : 'test -f second.ts' }],
      oracleGate: 'off', requireTests: false, engine: 'builder', reviewEngines: 'reviewer', maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(alreadyGreen ? 1 : 0);
    const witnessEvent = (out.result as any).state.events.find((entry: any) => entry.type === 'verify-witness');
    expect(JSON.parse(witnessEvent.detail)).toMatchObject({ witnessed: !alreadyGreen,
      baseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim() });
    if (alreadyGreen) {
      expect(h.dispatch).toHaveBeenCalledOnce();
      expect((out.result as any).state.events).toContainEqual(expect.objectContaining({ type: 'verify-failed' }));
      expect(execFileSync('git', ['rev-list', '--count', 'main..goal/differential-verification'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    }
    expect(existsSync(join(cwd, 'second.ts'))).toBe(false);
  });

  it.each([undefined, 'exit 1'])('uses the configured mutation witness command (%s)', async witnessCmd => {
    const cwd = repo(); const h = harness();
    const assessment = vi.spyOn(worktreeSupport, 'runMutationAssessment');
    const gate = 'test -f base.txt';
    const out = await runGoal({ intent: 'witness command', gate,
      ...(witnessCmd ? { witnessCmd } : {}),
      tasks: [{ id: 'second', source: 'make second', verify: 'test -f second.ts' }],
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(assessment).toHaveBeenCalledOnce();
    expect(assessment.mock.calls[0][0].testCmd).toBe(witnessCmd ?? gate);
    expect(out.exitCode).toBe(witnessCmd ? 1 : 0);
    if (witnessCmd) {
      expect(h.dispatch).toHaveBeenCalledOnce();
      expect((out.result as any).state.tasks[0].error).toContain('tests are red before mutation');
      expect(execFileSync('git', ['rev-list', '--count', 'main..goal/witness-command'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    }
    expect(existsSync(join(cwd, 'second.ts'))).toBe(false);
  });

  it('blocks flagged mutations when no reviewer is available', async () => {
    const cwd = repo(); const h = harness();
    vi.mocked(h.services.engines.listActive!).mockResolvedValue(['builder']);
    const outcomes = Array.from({ length: 3 }, (_, index) => ({ status: 'survived', mutant: {
      file: 'second.ts', class: 'equiv-prone', id: `m${index}`, line: index + 1, operator: 'return', before: 'before', after: 'after',
    } }));
    vi.spyOn(worktreeSupport, 'runMutationAssessment').mockResolvedValue({ ok: true,
      report: { baselineOk: true, generated: outcomes.length, outcomes } });
    const out = await runGoal({ intent: 'no reviewer', gate: 'test -f base.txt', engine: 'builder',
      requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state.tasks[0].error).toContain('requires a reviewer');
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/no-reviewer'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
  });

  it('does not carry survivor evidence into a new attempt after tests are strengthened', async () => {
    const cwd = repo(); const h = harness();
    const mutant = { file: 'second.ts', class: 'high-signal', id: 'm1', line: 1, operator: 'bool:true→false', before: 'true', after: 'false' };
    vi.spyOn(worktreeSupport, 'runMutationAssessment')
      .mockResolvedValueOnce({ ok: true, report: { baselineOk: true, generated: 1, outcomes: [{ status: 'survived', mutant }] } })
      .mockResolvedValueOnce({ ok: true, report: { baselineOk: true, generated: 1, outcomes: [{ status: 'killed', mutant }] } });
    let reviews = 0;
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      let stdout = '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'second.ts'), 'export const second = true;\n');
      else if (prompt.startsWith('Adjudicate')) {
        stdout = JSON.stringify({ blocking: true, reason: 'Strengthen tests' });
      } else if (++reviews === 1) {
        stdout = '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"second.ts","problem":"Weak tests","blocking":true,"confidence":1}]\n```';
      }
      return { exitCode: 0, stdout, stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'fresh evidence', gate: 'test -f base.txt', engine: 'builder',
      reviewEngines: 'reviewer', requireTests: false, maxAttempts: 2 }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    const adjudications = h.dispatch.mock.calls.map(call => call[1]).filter(prompt => prompt.startsWith('Adjudicate'));
    expect(adjudications).toHaveLength(1);
    expect(adjudications[0]).toContain('mutationEvidence');
    expect(adjudications[0]).toContain('bool:true→false@L1');
    const prompts = h.dispatch.mock.calls.map(call => call[1]).filter(prompt => prompt.includes('REVIEW TARGET:'));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('MUTATION EVIDENCE');
    expect(prompts[1]).not.toContain('MUTATION EVIDENCE');
    expect(h.writeArtifact.mock.calls.filter(call => (call as unknown[])[1] === 'mutation-evidence.txt')).toHaveLength(1);
  });

  it.each([
    ['masked sibling', [['a.ts', 'high-signal', 'killed', 1], ['b.ts', 'equiv-prone', 'survived', 3]]],
    ['per-file survivor limits', [['a.ts', 'high-signal', 'survived', 2], ['b.ts', 'high-signal', 'survived', 2]]],
    ['equivalence fallback', [['b.ts', 'equiv-prone', 'survived', 3]]],
  ] as const)('routes %s to review with file-scoped mutation evidence', async (_name, groups) => {
    const cwd = repo(); const h = harness();
    const outcomes = groups.flatMap(([file, kind, status, count]) => Array.from({ length: count }, (_, index) => ({
      status, mutant: { file, class: kind, id: `${file}:${index}`, line: index + 1, operator: 'test-operator', before: 'before', after: 'after' },
    })));
    vi.spyOn(worktreeSupport, 'runMutationAssessment').mockResolvedValue({ ok: true,
      report: { baselineOk: true, generated: outcomes.length, outcomes, notRun: 0, invalid: 0 } });
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'a.ts'), 'export const a = true;\n');
        writeFileSync(join(invocation.cwd, 'b.ts'), 'export const b = false;\n');
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'file grading', gate: 'test -f base.txt', engine: 'builder',
      reviewEngines: 'reviewer', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    const reviewCalls = h.dispatch.mock.calls.filter(call => call[3].mode === 'review');
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0][1]).toContain('MUTATION EVIDENCE');
    expect(reviewCalls[0][1]).toContain('b.ts');
    expect(reviewCalls[0][1]).toContain('test-operator@L1');
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'mutation-evidence.txt',
      expect.stringContaining('b.ts'), expect.anything());
  });

  it.each([
    ['baseline failure', { ok: false, error: 'tests are red before mutation', report: { baselineOk: false, outcomes: [] } }],
    ['process failure', { ok: false, error: 'process unavailable', report: { baselineOk: false, outcomes: [] } }],
    ['missing report', { ok: true }],
    ['unsuccessful baseline report', { ok: true, report: { baselineOk: false, outcomes: [] } }],
    ['aborted assessment', { ok: true, report: { baselineOk: true, aborted: true, outcomes: [] } }],
    ['budget exhausted', { ok: true, report: { baselineOk: true, budgetExhausted: true, outcomes: [] } }],
    ['unexecuted mutants', { ok: true, report: { baselineOk: true, notRun: 1, outcomes: [] } }],
    ['invalid mutant', { ok: true, report: { baselineOk: true, invalid: 1, outcomes: [] } }],
    ['missing outcomes', { ok: true, report: { baselineOk: true, generated: 0 } }],
    ['missing file identity', { ok: true, report: { baselineOk: true, generated: 1, outcomes: [{ status: 'killed', mutant: { class: 'high-signal' } }] } }],
    ['inconsistent count', { ok: true, report: { baselineOk: true, generated: 1, outcomes: [] } }],
  ])('does not review or commit after mutation %s', async (_label, assessment) => {
    const cwd = repo(); const h = harness();
    const mutation = vi.spyOn(worktreeSupport, 'runMutationAssessment').mockResolvedValue(assessment as Record<string, unknown>);
    const out = await runGoal({ intent: 'failed mutation', gate: 'test -f base.txt',
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(mutation).toHaveBeenCalledOnce();
    expect(out.exitCode).toBe(1);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect((out.result as any).state.events).toContainEqual(expect.objectContaining({ type: 'mutation-assessment-failed' }));
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/failed-mutation'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    expect(readFileSync(join((out.result as any).worktree.path, 'second.ts'), 'utf8')).toContain('export const second');
    mutation.mockRestore();
    const reassessment = vi.spyOn(worktreeSupport, 'runMutationAssessment');
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        expect(invocation.cwd).toBe((out.result as any).worktree.path);
        expect(readFileSync(join(invocation.cwd, 'second.ts'), 'utf8')).toBe('export const second = true;\n');
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const resumed = await runGoal({ id: 'failed-mutation', resume: true, engine: 'builder',
      reviewEngines: 'reviewer', requireTests: false, maxAttempts: 2 }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect(reassessment).toHaveBeenCalledOnce();
    expect((resumed.result as any).worktree.path).toBe((out.result as any).worktree.path);
  });

  it('does not require mutation evidence for documentation-only changes', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'notes.md'), 'Documentation only.\n');
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const mutation = vi.spyOn(worktreeSupport, 'runMutationAssessment');
    const out = await runGoal({ intent: 'docs only', gate: 'test -f base.txt', requireTests: false }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    expect(mutation).not.toHaveBeenCalled();
    expect((out.result as any).patch).toContain('+Documentation only.');
  });

  it('does not silently skip required mutation verification without run storage', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'missing run storage', gate: 'test -f base.txt',
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false, maxAttempts: 1 },
    context(cwd), { ...h.services, runs: undefined });
    expect(out.exitCode).toBe(1);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect((out.result as any).state.tasks[0].error).toContain('run artifact storage');
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/missing-run-storage'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    expect(existsSync(join((out.result as any).worktree.path, 'second.ts'))).toBe(true);
  });

  it('blocks a real mutation baseline failure even when the candidate gate passes', async () => {
    const cwd = repo(); const h = harness();
    writeFileSync(join(cwd, '.gitignore'), 'local-proof\n');
    execFileSync('git', ['add', '.gitignore'], { cwd });
    execFileSync('git', ['commit', '-m', 'ignore local proof'], { cwd });
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any) => {
      writeFileSync(join(invocation.cwd, 'second.ts'), 'export const second = true;\n');
      writeFileSync(join(invocation.cwd, 'local-proof'), 'not part of the patch\n');
      return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'real mutation failure',
      gate: 'test ! -f second.ts || test -f local-proof',
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect((out.result as any).state.tasks[0].error).toContain('tests are red before mutation');
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/real-mutation-failure'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    expect(readFileSync(join((out.result as any).worktree.path, 'second.ts'), 'utf8')).toContain('second = true');
  });

  it('runs dependency-ordered work, gates/mutates/reviews it, commits on goal branch, and leaves source untouched', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({
      intent: 'build two', gate: 'test -f base.txt',
      tasks: [{ id: 'first', source: 'make first' }, { id: 'second', source: 'make second', dependsOn: ['first'] }],
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false,
    }, context(cwd), h.services);
    expect(out, JSON.stringify(out)).toMatchObject({ exitCode: 0 });
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'done']);
    expect((out.result as any).patch).toContain('+export const first = true;');
    expect((out.result as any).patch).toContain('+export const second = true;');
    expect(existsSync(join(cwd, 'first.ts'))).toBe(false);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/build-two'], { cwd, encoding: 'utf8' }).trim()).toBe('2');
    expect(execFileSync('git', ['log', '-1', '--pretty=%B', 'goal/build-two'], { cwd, encoding: 'utf8' })).not.toContain('Co-Authored-By');
    expect((h.services.receipts.record as any).mock.calls.filter(([kind]: [string]) => kind === 'mutation-assessment')).toHaveLength(2);
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'result.json', expect.any(String), expect.anything());
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true }), expect.anything());

    const status = await runGoal({ id: 'build-two', status: true }, context(cwd), h.services);
    expect(status).toMatchObject({ exitCode: 0, result: { counts: { done: 2 } } });
  });

  it('retains failed uncommitted work for inspection and resume', async () => {
    const cwd = repo(); const h = harness();
    let candidate = '';
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any) => {
      candidate = invocation.cwd;
      writeFileSync(join(candidate, 'partial.txt'), 'keep this work\n');
      return { exitCode: 1, stdout: '', stderr: 'fixture builder failure', timedOut: false };
    });
    const out = await runGoal({ intent: 'retain failed work', gate: 'test -f base.txt',
      engine: 'builder', requireTests: false, maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect(existsSync(join(candidate, 'partial.txt'))).toBe(true);
    expect((out.result as any).worktree.path).toBe(candidate);
    expect((out.result as any).patch).toContain('+keep this work');
    expect(existsSync(join(cwd, 'partial.txt'))).toBe(false);
    const reopened = h.goal.open(context(cwd)).openWorktree('goal/retain-failed-work', (out.result as any).state.baseSha);
    expect(reopened.path).toBe(candidate);
    expect(readFileSync(join(reopened.path, 'partial.txt'), 'utf8')).toBe('keep this work\n');
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        expect(invocation.cwd).toBe(candidate);
        expect(readFileSync(join(invocation.cwd, 'partial.txt'), 'utf8')).toBe('keep this work\n');
        writeFileSync(join(invocation.cwd, 'finished.txt'), 'finished\n');
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const resumed = await runGoal({ id: 'retain-failed-work', resume: true,
      engine: 'builder', requireTests: false, maxAttempts: 2 }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect((resumed.result as any).worktree.path).toBe(candidate);
    expect((resumed.result as any).patch).toContain('+keep this work');
    expect((resumed.result as any).patch).toContain('+finished');
  });

  it('refuses resume after the retained worktree switches branches', async () => {
    const cwd = repo(); const h = harness();
    const invocation = h.goal.open(context(cwd));
    const worktree = invocation.openWorktree('goal/identity');
    writeFileSync(join(worktree.path, 'untouched.txt'), 'preserve\n');
    execFileSync('git', ['checkout', '-b', 'different'], { cwd: worktree.path, stdio: 'ignore' });
    expect(() => invocation.openWorktree('goal/identity', worktree.baseSha)).toThrow('Git identity changed');
    expect(readFileSync(join(worktree.path, 'untouched.txt'), 'utf8')).toBe('preserve\n');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.worktrees.rehydrateSessionWorktree).not.toHaveBeenCalled();
  });

  it.each(['path', 'repository', 'detached', 'base'] as const)('refuses invalid %s identity before overlays', invalid => {
    const cwd = repo(); const h = harness(); const opened = h.goal.open(context(cwd));
    const worktree = opened.openWorktree('goal/guarded');
    const record = h.worktrees.findSessionWorktree(worktree.repoRoot, worktree.branch)!;
    let base = worktree.baseSha;
    if (invalid === 'path') vi.spyOn(h.worktrees, 'findSessionWorktree').mockReturnValue({ ...record, path: cwd });
    if (invalid === 'repository') vi.spyOn(h.worktrees, 'findSessionWorktree').mockReturnValue({ ...record, repoRoot: repo() });
    if (invalid === 'detached') execFileSync('git', ['checkout', '--detach'], { cwd: worktree.path, stdio: 'ignore' });
    if (invalid === 'base') base = 'not-a-commit';
    expect(() => opened.openWorktree(worktree.branch, base)).toThrow();
    expect(h.worktrees.rehydrateSessionWorktree).not.toHaveBeenCalled();
    expect(readFileSync(join(worktree.path, 'base.txt'), 'utf8')).toBe('base\n');
  });

  it('refuses a changed state snapshot and releases the writer for a later resume', async () => {
    const cwd = repo(); const h = harness();
    expect((await runGoal({ intent: 'state race', gate: 'true', requireTests: false }, context(cwd), h.services)).exitCode).toBe(0);
    const saved = JSON.stringify(h.state.get('goals/state-race'));
    (h.services.state.read as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const refused = await runGoal({ id: 'state-race', intent: 'race', gate: 'true', branch: 'goal/race-other' }, context(cwd), h.services);
    expect(refused).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('state changed') });
    expect(JSON.stringify(h.state.get('goals/state-race'))).toBe(saved);
    expect(execFileSync('git', ['branch', '--list', 'goal/race-other'], { cwd, encoding: 'utf8' }).trim()).toBe('');
    expect((await runGoal({ id: 'state-race', resume: true }, context(cwd), h.services)).exitCode).toBe(0);
  });

  it('releases the writer after baseline refusal and preserves that refusal on resume', async () => {
    const cwd = repo(); const h = harness();
    expect((await runGoal({ intent: 'red baseline', gate: 'false' }, context(cwd), h.services)).failure?.code).toBe('GOAL_BASELINE_RED');
    expect((await runGoal({ id: 'red-baseline', resume: true }, context(cwd), h.services)).failure?.code).toBe('GOAL_BASELINE_RED');
    const lease = await h.goal.open(context(cwd)).acquire('red-baseline');
    await lease.release();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('refuses execution without the durable host', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'host required', gate: 'true' }, context(cwd), { ...h.services, goal: undefined });
    expect(out).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('host capabilities are unavailable') });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(execFileSync('git', ['branch', '--list', 'goal/*'], { cwd, encoding: 'utf8' }).trim()).toBe('');
  });

  it('retains interrupted work and records its location before propagating cancellation', async () => {
    const cwd = repo(); const h = harness(); const controller = new AbortController();
    let candidate = '';
    h.dispatch.mockImplementation(async (_id, _prompt, invocation: any) => {
      candidate = invocation.cwd;
      writeFileSync(join(candidate, 'interrupted.txt'), 'recover me\n');
      controller.abort(new Error('fixture interruption'));
      return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    });
    await expect(runGoal({ intent: 'interrupted', gate: 'true', engine: 'builder' },
      { ...context(cwd), signal: controller.signal }, h.services)).rejects.toThrow('fixture interruption');
    expect(readFileSync(join(candidate, 'interrupted.txt'), 'utf8')).toBe('recover me\n');
    const status = await runGoal({ id: 'interrupted', status: true }, context(cwd), h.services);
    expect(status.result).toMatchObject({ state: { status: 'cancelled', worktree: { path: candidate } } });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/interrupted'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
  });

  it('refuses a second execution while a retained goal is running', async () => {
    const cwd = repo(); const h = harness();
    let release!: () => void; let started!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const running = new Promise<void>(resolve => { started = resolve; });
    h.dispatch.mockImplementation(async (_id, _prompt, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        started();
        await pending;
        writeFileSync(join(invocation.cwd, 'first.txt'), 'done\n');
      }
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const first = runGoal({ intent: 'exclusive', gate: 'true', requireTests: false }, context(cwd), h.services);
    await running;
    try {
      const second = await runGoal({ id: 'exclusive', resume: true }, context(cwd), h.services);
      expect(second).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('Cannot acquire Goal execution') });
      expect(h.dispatch).toHaveBeenCalledTimes(1);
    } finally { release(); }
    expect((await first).exitCode).toBe(0);
    const resumed = await runGoal({ id: 'exclusive', resume: true }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
  });

  it('refuses to overwrite an existing id without explicit resume', async () => {
    const cwd = repo(); const h = harness();
    expect((await runGoal({ id: 'unique', intent: 'first', gate: 'true', requireTests: false }, context(cwd), h.services)).exitCode).toBe(0);
    const saved = JSON.stringify(h.state.get('goals/unique'));
    h.dispatch.mockClear();
    const duplicate = await runGoal({ id: 'unique', intent: 'replacement', branch: 'goal/replacement', gate: 'true' }, context(cwd), h.services);
    expect(duplicate).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('already exists') });
    expect(JSON.stringify(h.state.get('goals/unique'))).toBe(saved);
    expect(execFileSync('git', ['branch', '--list', 'goal/replacement'], { cwd, encoding: 'utf8' }).trim()).toBe('');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('repairs retained failing edits on explicit resume', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id, _prompt, invocation: any) => {
      unlinkSync(join(invocation.cwd, 'base.txt'));
      return { exitCode: 1, stdout: '', stderr: 'broken candidate', timedOut: false };
    });
    const failed = await runGoal({ intent: 'repair failing', gate: 'test -f base.txt', maxAttempts: 1 }, context(cwd), h.services);
    expect(failed.exitCode).toBe(1);
    h.dispatch.mockImplementation(async (_id, _prompt, invocation: any, options: any) => {
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'base.txt'), 'repaired\n');
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const repaired = await runGoal({ id: 'repair-failing', resume: true, maxAttempts: 2 }, context(cwd), h.services);
    expect(repaired, JSON.stringify(repaired)).toMatchObject({ exitCode: 0 });
    expect(readFileSync(join((repaired.result as any).worktree.path, 'base.txt'), 'utf8')).toBe('repaired\n');
    expect(readFileSync(join(cwd, 'base.txt'), 'utf8')).toBe('base\n');
  });

  it('does not commit or persist after losing the execution fence', async () => {
    const cwd = repo(); const h = harness(); let lost = false; let candidate = '';
    const guarded = { ...h.services, goal: {
      open(invocation: Parameters<typeof h.goal.open>[0]) {
        const opened = h.goal.open(invocation);
        return { ...opened, async acquire(id: string) {
          const lease = await opened.acquire(id);
          return { ...lease, release: () => lease.release(), assertOwned: async () => {
            if (lost) throw new Error('fixture fence lost');
            await lease.assertOwned();
          } };
        } };
      },
    } };
    const writesAfterLoss: unknown[] = [];
    (h.services.state.write as ReturnType<typeof vi.fn>).mockImplementation(async (key, value) => {
      if (lost) writesAfterLoss.push(value);
      h.state.set(key, value);
    });
    h.dispatch.mockImplementation(async (_id, _prompt, invocation: any) => {
      candidate = invocation.cwd;
      writeFileSync(join(candidate, 'partial.txt'), 'preserve\n');
      lost = true;
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    await expect(runGoal({ intent: 'fenced', gate: 'true', requireTests: false }, context(cwd), guarded)).rejects.toThrow('fixture fence lost');
    expect(writesAfterLoss).toEqual([]);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/fenced'], { cwd, encoding: 'utf8' }).trim()).toBe('0');
    expect(readFileSync(join(candidate, 'partial.txt'), 'utf8')).toBe('preserve\n');
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves the original base on resume and rejects a different gate, branch or repository', async () => {
    const cwd = repo(); const h = harness();
    const first = await runGoal({ intent: 'stable identity', gate: 'test -f base.txt',
      requireTests: false, engine: 'builder' }, context(cwd), h.services);
    expect(first.exitCode).toBe(0);
    writeFileSync(join(cwd, 'later.txt'), 'source advanced\n');
    execFileSync('git', ['add', 'later.txt'], { cwd });
    execFileSync('git', ['commit', '-m', 'advance source'], { cwd, stdio: 'ignore' });
    h.dispatch.mockClear();
    const resumed = await runGoal({ id: 'stable-identity', resume: true }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect((resumed.result as any).patch).toBe((first.result as any).patch);
    expect(h.dispatch).not.toHaveBeenCalled();
    const changes: Array<Record<string, string>> = [{ gate: 'true' }, { branch: 'goal/other' }];
    for (const changed of changes) {
      const refused = await runGoal({ id: 'stable-identity', resume: true, ...changed }, context(cwd), h.services);
      expect(refused).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('cannot change') });
    }
    const other = repo();
    const wrongRepo = await runGoal({ id: 'stable-identity', resume: true }, context(other), h.services);
    expect(wrongRepo).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('different repository') });
    expect(execFileSync('git', ['branch', '--list', 'goal/*'], { cwd: other, encoding: 'utf8' }).trim()).toBe('');
  });

  it('pushes each completed task to the selected remote before starting the next task', async () => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-remote-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'selected', remote], { cwd });
    execFileSync('git', ['config', 'push.followTags', 'true'], { cwd });
    execFileSync('git', ['tag', '-a', 'private-local-tag', '-m', 'local only'], { cwd });
    const original = h.dispatch.getMockImplementation()!;
    let firstTip = '';
    h.dispatch.mockImplementation(async (...args) => {
      if (args[3].mode === 'agent' && args[1].includes('TASK second')) {
        firstTip = execFileSync('git', ['rev-parse', 'refs/heads/goal/publish'], { cwd: remote, encoding: 'utf8' }).trim();
        expect(execFileSync('git', ['show', `${firstTip}:first.ts`], { cwd: remote, encoding: 'utf8' })).toContain('first = true');
      }
      return original(...args);
    });
    const out = await runGoal({ id: 'publish', intent: 'publish tasks', gate: 'test -f base.txt', engine: 'builder', reviewEngines: 'reviewer', requireTests: false, push: true, remote: 'selected',
      tasks: [{ id: 'first', source: 'first' }, { id: 'second', source: 'second', dependsOn: ['first'] }],
    }, context(cwd), h.services);
    expect(out).toMatchObject({ exitCode: 0 });
    const result = out.result as any;
    expect(firstTip).toBe(result.state.tasks[0].commit);
    expect(execFileSync('git', ['rev-parse', 'refs/heads/goal/publish'], { cwd: remote, encoding: 'utf8' }).trim()).toBe(result.state.tasks[1].commit);
    expect(result.state.events.filter((entry: any) => entry.type === 'task-pushed')).toHaveLength(2);
    expect(execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim()).toBe('main');
    expect(existsSync(join(cwd, 'first.ts'))).toBe(false);
    expect(execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/tags'], { cwd: remote, encoding: 'utf8' }).trim()).toBe('');
  });

  it('keeps completed commits when publication fails and reports the failure', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'push failure', gate: 'test -f base.txt', engine: 'builder', reviewEngines: 'reviewer', requireTests: false, push: true,
      remote: join(cwd, 'missing-remote.git'),
    }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    const result = out.result as any;
    expect(result.state.tasks[0].status).toBe('done');
    expect(result.state.events.some((entry: any) => entry.type === 'push-failed')).toBe(true);
    expect(result.state.events.some((entry: any) => entry.type === 'task-pushed')).toBe(false);
    expect(result.publication).toMatchObject({ requested: true, failed: 1, succeeded: 0 });
    expect(execFileSync('git', ['rev-parse', 'goal/push-failure'], { cwd, encoding: 'utf8' }).trim()).toBe(result.state.tasks[0].commit);
  });

  it.each([false, true])('never pushes without execution authorization (dryRun=%s)', async dryRun => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-no-push-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    const out = await runGoal({ intent: 'stay local', gate: 'true', requireTests: false, dryRun, push: dryRun }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    expect(execFileSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: remote, encoding: 'utf8' }).trim()).toBe('');
    if (dryRun) expect(h.dispatch).not.toHaveBeenCalled();
    else expect((out.result as any).state.tasks[0].status).toBe('done');
  });

  it('recovers an interrupted push response as unknown without rerunning the completed task', async () => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-response-lost-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    let interrupted = false;
    const write = h.services.state.write as ReturnType<typeof vi.fn>;
    write.mockImplementation(async (key, value) => {
      if (value.payload.events.at(-1)?.type === 'task-pushed') interrupted = true;
      if (interrupted) throw new Error('fixture process lost before outcome persistence');
      h.state.set(key, value);
    });
    await expect(runGoal({ intent: 'response lost', gate: 'true', requireTests: false, push: true }, context(cwd), h.services)).rejects.toThrow('outcome persistence');
    const published = execFileSync('git', ['rev-parse', 'refs/heads/goal/response-lost'], { cwd: remote, encoding: 'utf8' }).trim();
    expect(h.state.get('goals/response-lost').payload.tasks[0].commit).toBe(published);
    write.mockImplementation(async (key, value) => { h.state.set(key, value); });
    h.dispatch.mockClear();
    const resumed = await runGoal({ id: 'response-lost', resume: true, push: true }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect((resumed.result as any).publication).toMatchObject({ succeeded: 0, failed: 1,
      outcomes: [expect.objectContaining({ commit: published, remote: 'origin', status: 'unknown' })] });
  });

  it('refuses push when git.write is denied before implementation', async () => {
    const cwd = repo(); const h = harness();
    (h.services.permissions.check as ReturnType<typeof vi.fn>).mockResolvedValue('deny');
    const out = await runGoal({ intent: 'denied push', gate: 'true', push: true }, context(cwd), h.services);
    expect(out).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('git.write') });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.services.runs!.start).not.toHaveBeenCalled();
  });

  it.each(['permission', 'cancellation', 'branch', 'head', 'generation', 'fence'] as const)('refuses publication after %s changes and retains the commit', async change => {
    const cwd = repo(); const h = harness(); const abort = new AbortController();
    const remote = mkdtempSync(join(tmpdir(), 'goal-revoked-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    const write = h.services.state.write as ReturnType<typeof vi.fn>;
    let changed = false;
    const guarded = { ...h.services, goal: {
      open(invocation: Parameters<typeof h.goal.open>[0]) {
        const opened = h.goal.open(invocation);
        return { ...opened,
          assertCurrent() {
            opened.assertCurrent();
            if (changed && change === 'generation') throw new Error('fixture generation changed');
          },
          async acquire(id: string) {
            const lease = await opened.acquire(id);
            return { release: () => lease.release(), assertOwned: async () => {
              if (changed && change === 'fence') throw new Error('fixture fence lost');
              await lease.assertOwned();
            } };
          },
        };
      },
    } };
    write.mockImplementation(async (key, value) => {
      h.state.set(key, value);
      const payload = value.payload;
      if (!changed && payload.events.at(-1)?.type === 'push-prepared') {
        changed = true;
        if (change === 'permission') (h.services.permissions.check as ReturnType<typeof vi.fn>).mockResolvedValue('deny');
        if (change === 'cancellation') abort.abort(new Error('cancel before push'));
        if (change === 'branch') execFileSync('git', ['checkout', '-b', 'other-local'], { cwd: payload.worktree.path });
        if (change === 'head') execFileSync('git', ['commit', '--allow-empty', '-m', 'concurrent local commit'], { cwd: payload.worktree.path });
      }
    });
    await expect(runGoal({ intent: 'revoked push', gate: 'true', requireTests: false, push: true },
      { ...context(cwd), signal: abort.signal }, guarded)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(execFileSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: remote, encoding: 'utf8' }).trim()).toBe('');
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/revoked-push'], { cwd, encoding: 'utf8' }).trim()).toBe(change === 'head' ? '2' : '1');
    expect(h.state.get('goals/revoked-push').payload.tasks[0].status).toBe('done');
  });

  it('continues after a rejected first push and publishes the next completed task', async () => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-reject-once-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nif test ! -f rejected-once; then\n  touch rejected-once\n  exit 1\nfi\nexit 0\n', { mode: 0o755 });
    const out = await runGoal({ intent: 'reject once', gate: 'true', requireTests: false, push: true,
      tasks: [{ id: 'first', source: 'first' }, { id: 'second', source: 'second', dependsOn: ['first'] }],
    }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    const result = out.result as any;
    expect(result.state.tasks.map((task: any) => task.status)).toEqual(['done', 'done']);
    expect(result.publication).toMatchObject({ succeeded: 1, failed: 1 });
    expect(execFileSync('git', ['rev-parse', 'refs/heads/goal/reject-once'], { cwd: remote, encoding: 'utf8' }).trim()).toBe(result.state.tasks[1].commit);
  });

  it.each([false, true])('prepares a selected-remote handoff and creates a PR only when requested (pr=%s)', async pr => {
    const cwd = repo();
    const draft = vi.fn(async () => ({ ok: true, title: 'feat: goal output', body: 'Verified task summary' }));
    const h = harness({ draftPullRequest: draft });
    const remote = mkdtempSync(join(tmpdir(), 'goal-pr-'));
    const fetchRemote = mkdtempSync(join(tmpdir(), 'goal-pr-fetch-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['init', '--bare', fetchRemote]);
    execFileSync('git', ['remote', 'add', 'selected', fetchRemote], { cwd });
    execFileSync('git', ['remote', 'set-url', '--push', 'selected', remote], { cwd });
    const repoUrl = vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/selected');
    vi.spyOn(worktreeSupport, 'defaultBaseBranch').mockReturnValue('release');
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({ exitCode: 0, stdout: 'https://github.com/fixture/selected/pull/1\n', stderr: '', timedOut: false, durationMs: 0 }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const out = await runGoal({ intent: 'pr handoff', gate: 'true', requireTests: false, push: true, remote: 'selected', pr }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    const result = out.result as any;
    expect(result.pullRequest).toMatchObject({ title: 'feat: goal output', body: 'Verified task summary', usedTemplate: false });
    expect(result.pullRequest.url).toContain('https://github.com/fixture/selected/compare/release...goal%2Fpr-handoff');
    expect(repoUrl).toHaveBeenCalledWith(expect.any(String), 'selected');
    expect(draft).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(pr ? 1 : 0);
    expect(execFileSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: fetchRemote, encoding: 'utf8' }).trim()).toBe('');
    if (pr) {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ args: ['pr', 'create', '--repo', 'https://github.com/fixture/selected', '--base', 'release', '--head', 'goal/pr-handoff', '--title', 'feat: goal output', '--body', 'Verified task summary'] }));
      expect(result.pullRequest.creation).toMatchObject({ status: 'created', url: 'https://github.com/fixture/selected/pull/1' });
    }
  });

  it.each(['no-push', 'dry-run', 'push-failed', 'no-draft', 'draft-failed', 'draft-cancelled', 'draft-retired', 'permission-revoked', 'gh-failed', 'gh-timeout'] as const)('Goal PR handoff boundary: %s', async mode => {
    const cwd = repo(); const abort = new AbortController(); let current = true;
    const draft = vi.fn(async () => {
      if (mode === 'draft-failed') throw new Error('optional draft failed');
      if (mode === 'draft-cancelled') abort.abort(new Error('draft cancelled'));
      if (mode === 'draft-retired') current = false;
      if (mode === 'permission-revoked') (h.services.permissions.check as ReturnType<typeof vi.fn>).mockResolvedValue('deny');
      return { ok: true, title: 'feat: reviewed goal', body: 'Known task work' };
    });
    const h = harness({ captureAuthority: () => () => { if (!current) throw new Error('generation retired'); },
      ...(mode !== 'no-draft' ? { draftPullRequest: draft } : {}) });
    const remote = mkdtempSync(join(tmpdir(), 'goal-pr-boundary-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', mode === 'push-failed' ? join(remote, 'missing') : remote], { cwd });
    vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/goal');
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({
      exitCode: mode === 'gh-failed' || mode === 'gh-timeout' ? 1 : 0,
      stdout: 'https://github.com/fixture/goal/pull/1\n', stderr: 'fixture', timedOut: mode === 'gh-timeout', durationMs: 0,
    }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const out = await runGoal({ intent: 'pr boundary', gate: 'true', requireTests: false, push: mode !== 'no-push', pr: true,
      dryRun: mode === 'dry-run' }, { ...context(cwd), signal: abort.signal }, h.services);
    expect(out.exitCode).toBe(0);
    const result = out.result as any;
    const allowed = ['no-draft', 'draft-failed', 'gh-failed', 'gh-timeout'].includes(mode);
    expect(create).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (['no-push', 'dry-run', 'push-failed'].includes(mode)) expect(result.pullRequest).toBeUndefined();
    else {
      expect(result.state.tasks[0].status).toBe('done');
      expect(result.publication.succeeded).toBe(1);
      if (['no-draft', 'draft-failed', 'draft-cancelled', 'draft-retired'].includes(mode)) expect(result.pullRequest.usedTemplate).toBe(true);
      expect(result.pullRequest.creation.status).toBe(!allowed ? 'not-attempted' : mode.startsWith('gh-') ? 'unknown' : 'created');
    }
    if (mode.startsWith('gh-') || mode === 'no-draft') {
      const resumed = await runGoal({ id: 'pr-boundary', resume: true, push: true, pr: true }, context(cwd), h.services);
      expect(resumed.exitCode).toBe(0);
      expect(create).toHaveBeenCalledTimes(1);
      expect((resumed.result as any).pullRequest.creation.status).toBe(mode.startsWith('gh-') ? 'unknown' : 'created');
    }
  });

  it.each(['destination', 'deleted', 'moved'] as const)('refuses a PR from stale publication evidence: %s', async change => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-stale-pr-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/original');
    const initial = await runGoal({ intent: 'stale pr', gate: 'true', requireTests: false, push: true }, context(cwd), h.services);
    expect(initial.exitCode).toBe(0);
    if (change === 'destination') {
      const other = mkdtempSync(join(tmpdir(), 'goal-other-pr-'));
      execFileSync('git', ['clone', '--bare', remote, other]);
      execFileSync('git', ['remote', 'set-url', '--push', 'origin', other], { cwd });
    } else if (change === 'deleted') execFileSync('git', ['update-ref', '-d', 'refs/heads/goal/stale-pr'], { cwd: remote });
    else execFileSync('git', ['update-ref', 'refs/heads/goal/stale-pr', (initial.result as any).state.baseSha], { cwd: remote });
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({ exitCode: 0, stdout: 'https://github.com/fixture/original/pull/1', stderr: '', timedOut: false, durationMs: 0 }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const resumed = await runGoal({ id: 'stale-pr', resume: true, push: true, pr: true }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect((resumed.result as any).pullRequest.creation.status).toBe('not-attempted');
  });

  it('retains unresolved PR creation across new task commits and base changes', async () => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-pr-pending-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/pending');
    const base = vi.spyOn(worktreeSupport, 'defaultBaseBranch').mockReturnValue('main');
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({ exitCode: 1, stdout: '', stderr: 'lost response', timedOut: true, durationMs: 0 }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const original = h.dispatch.getMockImplementation()!;
    h.dispatch.mockImplementation(async (...args) => args[3].mode === 'agent' && args[1].includes('TASK second')
      ? { exitCode: 1, stdout: '', stderr: 'fixture incomplete', timedOut: false } : original(...args));
    const initial = await runGoal({ intent: 'pending pr', gate: 'true', requireTests: false, push: true, pr: true, maxAttempts: 1,
      tasks: [{ id: 'first', source: 'first' }, { id: 'second', source: 'second', dependsOn: ['first'] }],
    }, context(cwd), h.services);
    expect(initial.exitCode).toBe(1);
    const pending = (initial.result as any).state.pullRequest;
    expect(pending.status).toBe('unknown');
    h.dispatch.mockImplementation(original); base.mockReturnValue('release');
    const resumed = await runGoal({ id: 'pending-pr', resume: true, push: true, pr: true, maxAttempts: 2, requireTests: false }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect((resumed.result as any).state.pullRequest).toEqual(pending);
  });

  it('does not create a second PR after remote success but failed outcome persistence', async () => {
    const cwd = repo(); const h = harness();
    const remote = mkdtempSync(join(tmpdir(), 'goal-pr-crash-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/crash');
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({ exitCode: 0, stdout: 'https://github.com/fixture/crash/pull/1', stderr: '', timedOut: false, durationMs: 0 }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const write = h.services.state.write as ReturnType<typeof vi.fn>;
    let interrupted = false;
    write.mockImplementation(async (key, value) => {
      if (value.payload.pullRequest?.status === 'created') interrupted = true;
      if (interrupted) throw new Error('PR outcome persistence lost');
      h.state.set(key, value);
    });
    await expect(runGoal({ intent: 'pr crash', gate: 'true', requireTests: false, push: true, pr: true }, context(cwd), h.services)).rejects.toThrow('PR outcome persistence lost');
    expect(h.state.get('goals/pr-crash').payload.pullRequest.status).toBe('pending');
    write.mockImplementation(async (key, value) => { h.state.set(key, value); });
    const resumed = await runGoal({ id: 'pr-crash', resume: true, push: true, pr: true }, context(cwd), h.services);
    expect(resumed.exitCode).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect((resumed.result as any).pullRequest.creation.status).toBe('unknown');
  });

  it.each(['branch', 'head', 'destination', 'fence'] as const)('refuses PR creation when %s changes during preparation', async change => {
    const cwd = repo(); let changed = false;
    const remote = mkdtempSync(join(tmpdir(), 'goal-pr-transition-'));
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd });
    const h = harness({ draftPullRequest: async () => {
      const retained = h.state.get('goals/pr-transition').payload.worktree.path;
      if (change === 'branch') execFileSync('git', ['checkout', '-b', 'other-preparation'], { cwd: retained });
      if (change === 'head') execFileSync('git', ['commit', '--allow-empty', '-m', 'changed during draft'], { cwd: retained });
      if (change === 'destination') execFileSync('git', ['remote', 'set-url', '--push', 'origin', join(remote, 'different-target')], { cwd });
      changed = true;
      return { ok: true, title: 'feat: transition', body: 'Fixture draft' };
    } });
    const guarded = { ...h.services, goal: { open(invocation: Parameters<typeof h.goal.open>[0]) {
      const opened = h.goal.open(invocation);
      return { ...opened, async acquire(id: string) {
        const lease = await opened.acquire(id);
        return { release: () => lease.release(), assertOwned: async () => {
          if (changed && change === 'fence') throw new Error('fixture lost PR fence');
          await lease.assertOwned();
        } };
      } };
    } } };
    vi.spyOn(worktreeSupport, 'githubRepoUrl').mockReturnValue('https://github.com/fixture/transition');
    const spawn = engineRuntime.spawnWithTimeout;
    const create = vi.fn(async (_options: Parameters<typeof engineRuntime.spawnWithTimeout>[0]) => ({ exitCode: 0, stdout: 'unexpected', stderr: '', timedOut: false, durationMs: 0 }));
    vi.spyOn(engineRuntime, 'spawnWithTimeout').mockImplementation(options => options.command === 'gh' ? create(options) : spawn(options));
    const run = runGoal({ intent: 'pr transition', gate: 'true', requireTests: false, push: true, pr: true }, context(cwd), guarded);
    if (change === 'fence') await expect(run).rejects.toThrow('lost PR fence');
    else expect((await run).exitCode).toBe(0);
    expect(changed).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(h.state.get('goals/pr-transition').payload.tasks[0].status).toBe('done');
  });

  it('refuses a red base, protected branch, missing resume, and invalid dependency graph', async () => {
    const cwd = repo(); const h = harness();
    expect((await runGoal({ intent: 'x', gate: 'false' }, context(cwd), h.services)).failure?.code).toBe('GOAL_BASELINE_RED');
    expect((await runGoal({ intent: 'x', gate: 'true', branch: 'main' }, context(cwd), h.services)).stderr).toContain('goal/*');
    expect((await runGoal({ id: 'missing', resume: true }, context(cwd), h.services)).stderr).toContain('unknown goal');
    expect((await runGoal({ intent: 'x', gate: 'true', tasks: [{ id: 'x', dependsOn: ['missing'] }] }, context(cwd), h.services)).stderr).toContain('unknown task');
  });

  it('stops a strict non-discriminating task oracle before spending an engine call', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'strict oracle', gate: 'true', tasks: [{ id: 'x', source: 'x', verify: 'true' }], oracleGate: 'strict' }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'strict-oracle' });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it.each(['builder', 'reviewer'])('counts %s costs before starting the next task', async (charged) => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
      return options.mode === 'agent'
        ? { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: charged === 'builder' ? 0.6 : 0.1 }
        : { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false, costUsd: charged === 'reviewer' ? 0.5 : 0 };
    });
    const out = await runGoal({ intent: 'budgeted', gate: 'true', budget: 0.5, requireTests: false, tasks: [{ id: 'first', source: 'one' }, { id: 'second', source: 'two', dependsOn: ['first'] }] }, context(cwd), h.services);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'budget' });
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'queued']);
    expect((out.result as any).state.spentUsd).toBeCloseTo(0.6);
    expect(h.dispatch.mock.calls.filter(([, , , options]) => options.mode === 'agent')).toHaveLength(1);
  });

  it('owns bounded supervised re-exec and resumes after a transient crash', async () => {
    const h = harness();
    const runChild = vi.fn()
      .mockResolvedValueOnce({ exitCode: 137, outputTail: 'killed' })
      .mockResolvedValueOnce({ exitCode: 0, outputTail: 'done' });
    const wait = vi.fn(async () => undefined);
    const out = await runGoalSupervisor(
      { intent: 'overnight', gate: 'true', supervised: true, maxRestarts: '3' },
      { nodeExec: '/node', agonEntry: '/agon.js', runChild, wait, interrupted: () => false },
    );
    expect(out.exitCode).toBe(0);
    expect(out.result).toEqual({ restarts: 1, reason: 'clean exit — terminal state reached' });
    expect(runChild).toHaveBeenCalledTimes(2);
    expect(runChild.mock.calls[0][0]).toEqual(['goal', 'overnight', '--gate', 'true', '--resume']);
    expect(wait).toHaveBeenCalledWith(5000);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('counts a billed failed seat alongside a usable review without changing the degraded verdict', async () => {
    const cwd = repo(); const h = harness();
    h.services.engines.listActive = async () => ['builder', 'reviewer', 'failed'];
    h.dispatch.mockImplementation(async (engine: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: 0.1 };
      }
      return { exitCode: engine === 'failed' ? 1 : 0,
        stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```',
        stderr: '', timedOut: false, costUsd: engine === 'failed' ? 0.3 : 0.2 };
    });
    const out = await runGoal({ intent: 'mixed costs', gate: 'true', budget: 0.5, requireTests: false,
      engine: 'builder', reviewEngines: 'reviewer,failed',
      tasks: [{ id: 'first', source: 'one' }, { id: 'second', source: 'two', dependsOn: ['first'] }],
    }, context(cwd), h.services);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'budget' });
    expect((out.result as any).state.spentUsd).toBeCloseTo(0.6);
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'queued']);
    expect(h.dispatch).toHaveBeenCalledTimes(3);
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: 'review', ok: true, summary: '1/2 reviewers produced machine-readable evidence',
    }), expect.anything());
  });

  it.each([true, false].flatMap(valid => [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY].map(costUsd => ({ valid, costUsd }))))(
    'rejects invalid adjudication cost $costUsd with valid verdict=$valid', async ({ valid, costUsd }) => {
      const cwd = repo(); const h = harness();
      h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
        if (options.mode === 'agent') {
          writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
          return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: 0.1 };
        }
        if (prompt.startsWith('Adjudicate')) return { exitCode: 0,
          stdout: valid ? '{"blocking":true,"reason":"still blocked"}' : 'not JSON',
          stderr: '', timedOut: false, costUsd };
        return { exitCode: 0,
          stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"first.txt","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"issue","minimalFix":"fix it"}]\n```',
          stderr: '', timedOut: false, costUsd: 0.2 };
      });
      const out = await runGoal({ intent: 'invalid judge cost', gate: 'true', requireTests: false,
        engine: 'builder', reviewEngines: 'reviewer', maxAttempts: 1 }, context(cwd), h.services);
      expect(out.exitCode).toBe(1);
      expect((out.result as any).state.spentUsd).toBeCloseTo(0.3);
      expect((out.result as any).state.tasks[0].status).toBe('failed');
      const saved = await runGoal({ id: 'invalid-judge-cost', status: true }, context(cwd), h.services);
      expect((saved.result as any).state.spentUsd).toBeCloseTo(0.3);
    },
  );

  it.each([true, false])('counts panel and adjudication costs with valid verdict=%s', async (valid) => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: 0.1 };
      }
      if (prompt.startsWith('Adjudicate')) return { exitCode: 0, stdout: valid ? '{"blocking":false,"reason":"false positive"}' : 'not JSON', stderr: '', timedOut: false, costUsd: 0.3 };
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"first.txt","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"claimed issue","minimalFix":"none"}]\n```', stderr: '', timedOut: false, costUsd: 0.2 };
    });
    const out = await runGoal({ intent: 'judge review', gate: 'true', requireTests: false, engine: 'builder', reviewEngines: 'reviewer', judge: 'reviewer', maxAttempts: 1 }, context(cwd), h.services);
    expect(out.exitCode).toBe(valid ? 0 : 1);
    expect((out.result as any).state.events.some((entry: any) => entry.type === 'review-adjudicated' && entry.detail.includes('cleared'))).toBe(valid);
    expect((out.result as any).state.spentUsd).toBeCloseTo(0.6);
    const saved = await runGoal({ id: 'judge-review', status: true }, context(cwd), h.services);
    expect((saved.result as any).state.spentUsd).toBeCloseTo(0.6);
    const calls = h.dispatch.mock.calls.length;
    const resumed = await runGoal({ id: 'judge-review', resume: true, maxAttempts: 2, requireTests: false,
      engine: 'builder', reviewEngines: 'reviewer', judge: 'reviewer' }, context(cwd), h.services);
    expect((resumed.result as any).state.spentUsd).toBeCloseTo(valid ? 0.6 : 1.2);
    expect(h.dispatch).toHaveBeenCalledTimes(calls + (valid ? 0 : 3));
  });
});
