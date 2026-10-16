import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

function harness() {
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
  const goal = createGoalHostServices({
    acquireWriter: id => WriterFence.acquire(join(home, `${id}.lock`), `agon.goal:${id}`),
    captureAuthority: () => () => undefined,
    worktrees,
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
  return { state, dispatch, finish, writeArtifact, services, goal, worktrees };
}

const context = (cwd: string) => ({
  invocationId: 'g', cwd, platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {},
});

describe('physical goal mod', () => {
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
    for (const changed of [{ gate: 'true' }, { branch: 'goal/other' }]) {
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

  it('honors the metered budget before starting the next task', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
      return options.mode === 'agent'
        ? { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: 0.6 }
        : { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'budgeted', gate: 'true', budget: 0.5, requireTests: false, tasks: [{ id: 'first', source: 'one' }, { id: 'second', source: 'two', dependsOn: ['first'] }] }, context(cwd), h.services);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'budget' });
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'queued']);
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

  it('lets an independent judge clear a panel finding before commit', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
      }
      if (prompt.startsWith('Adjudicate')) return { exitCode: 0, stdout: '{"blocking":false,"reason":"false positive"}', stderr: '', timedOut: false };
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"first.txt","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"claimed issue","minimalFix":"none"}]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'judge review', gate: 'true', requireTests: false, engine: 'builder', reviewEngines: 'reviewer', judge: 'reviewer' }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    expect((out.result as any).state.events.some((entry: any) => entry.type === 'review-adjudicated' && entry.detail.includes('cleared'))).toBe(true);
  });
});
