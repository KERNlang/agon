import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishConquerBranch } from '@kernlang/agon-mod-conquer';
import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';

const opts = { cwd: '/isolated/worktree', task: 'build feature', commitBody: () => 'verified claim' };
const ok = { exitCode: 0, stdout: '', stderr: '' };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Conquer publication owner', () => {
  it('preserves the guarded Git sequence and timeouts', async () => {
    const git = vi.fn(async (args: string[]) => ({ ...ok, exitCode: args[0] === 'diff' ? 1 : 0 }))
      .mockResolvedValueOnce({ ...ok, stdout: 'conquer/feature\n' });
    expect(await publishConquerBranch(opts, git)).toEqual({ ok: true, branch: 'conquer/feature' });
    expect(git.mock.calls).toEqual([
      [['rev-parse', '--abbrev-ref', 'HEAD'], 15_000],
      [['add', '-A'], 30_000],
      [['diff', '--cached', '--quiet', '--exit-code'], 15_000],
      [['commit', '-m', 'conquer: build feature', '-m', 'verified claim'], 30_000],
      [['push', '-u', 'origin', 'conquer/feature'], 120_000],
    ]);
  });

  it.each(['', 'HEAD', 'main', 'master', ' MAIN '])('refuses unsafe HEAD %j before mutation', async branch => {
    const git = vi.fn(async () => ({ ...ok, stdout: branch }));
    const commitBody = vi.fn(opts.commitBody);
    expect(await publishConquerBranch({ ...opts, commitBody }, git)).toMatchObject({ ok: false });
    expect(git).toHaveBeenCalledTimes(1);
    expect(commitBody).not.toHaveBeenCalled();
  });

  it('preserves configured protected branches', async () => {
    const git = vi.fn(async () => ({ ...ok, stdout: 'release' }));
    expect(await publishConquerBranch({ ...opts, protectedPushBranches: ['release'] }, git))
      .toMatchObject({ ok: false, stage: 'branch', branch: 'release' });
    expect(git).toHaveBeenCalledTimes(1);
  });

  it.each(['changed', 'failed', 'timedOut', 'aborted'] as const)('refuses publication when the final branch check is %s', async condition => {
    let reads = 0;
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && ++reads === 2) return {
        ...ok, stdout: condition === 'changed' ? 'other-branch' : 'conquer/feature',
        exitCode: condition === 'failed' ? 128 : 0,
        timedOut: condition === 'timedOut', aborted: condition === 'aborted',
      };
      return { ...ok, stdout: args[0] === 'rev-parse' ? 'conquer/feature' : '',
        exitCode: args[0] === 'diff' ? 1 : 0 };
    });
    expect(await publishConquerBranch({ ...opts, expectedBranch: 'conquer/feature' }, git))
      .toMatchObject({ ok: false, stage: 'branch' });
    expect(git.mock.calls.some(([args]) => args[0] === 'push')).toBe(false);
  });

  it.each([
    ['add', 'timedOut'], ['add', 'aborted'], ['commit', 'timedOut'],
    ['commit', 'aborted'], ['push', 'timedOut'], ['push', 'aborted'],
  ] as const)('rejects %s with zero exit and %s', async (stage, flag) => {
    const git = vi.fn(async (args: string[]) => ({ ...ok,
      stdout: args[0] === 'rev-parse' ? 'conquer/feature' : '',
      exitCode: args[0] === 'diff' ? 1 : 0,
      ...(args[0] === stage ? { [flag]: true } : {}),
    }));
    expect(await publishConquerBranch(opts, git)).toMatchObject({ ok: false, stage });
    expect(git.mock.calls.at(-1)![0][0]).toBe(stage);
  });

  it.each(['branch', 'add', 'status', 'commit', 'push', 'formatter'] as const)('records a thrown %s failure without retry', async fault => {
    const stage = fault === 'formatter' ? 'commit' : fault;
    const command = { branch: 'rev-parse', add: 'add', status: 'diff', commit: 'commit', push: 'push' }[stage];
    const git = vi.fn(async (args: string[]) => {
      if (fault !== 'formatter' && args[0] === command) throw new Error('fixture failure');
      return { ...ok, stdout: args[0] === 'rev-parse' ? 'conquer/feature' : '', exitCode: args[0] === 'diff' ? 1 : 0 };
    });
    const result = await publishConquerBranch({ ...opts, expectedBranch: 'conquer/feature',
      commitBody: () => { if (fault === 'formatter') throw new Error('fixture failure'); return 'claim'; },
    }, git);
    expect(result).toMatchObject({ ok: false, stage, branch: 'conquer/feature',
      remoteOutcome: stage === 'push' ? 'unknown' : 'not-attempted' });
    if (!result.ok) expect(result.message).toContain('fixture failure');
    expect(git.mock.calls.filter(([args]) => args[0] === 'push')).toHaveLength(stage === 'push' ? 1 : 0);
  });

  it('formats the commit body only after successful staging', async () => {
    const git = vi.fn(async (args: string[]) => ({ ...ok, exitCode: args[0] === 'diff' ? 1 : 0 }))
      .mockResolvedValueOnce({ ...ok, stdout: 'conquer/feature' });
    const commitBody = vi.fn(() => {
      expect(git).toHaveBeenCalledTimes(3);
      return 'formatted claim';
    });
    await publishConquerBranch({ ...opts, commitBody }, git);
    expect(commitBody).toHaveBeenCalledTimes(1);
    expect(git).toHaveBeenNthCalledWith(4, ['commit', '-m', 'conquer: build feature', '-m', 'formatted claim'], 30_000);
  });

  it.each(['branch', 'add', 'status', 'commit', 'push'] as const)('stops at failed %s', async stage => {
    const index = ['branch', 'add', 'status', 'commit', 'push'].indexOf(stage);
    let calls = 0;
    const git = vi.fn(async (args: string[]) => calls++ === index
      ? { exitCode: 128, stdout: 'conquer/feature', stderr: 'x'.repeat(300) }
      : { ...ok, exitCode: args[0] === 'diff' ? 1 : 0, stdout: 'conquer/feature' });
    const result = await publishConquerBranch(opts, git);
    expect(result).toMatchObject({ ok: false, stage });
    expect(git).toHaveBeenCalledTimes(index + 1);
    if (!result.ok && stage !== 'branch') {
      expect(result.message).toContain('x'.repeat(200));
      expect(result.message).not.toContain('x'.repeat(201));
    }
  });

  it.each([['timedOut', 0], ['timedOut', 1], ['aborted', 0], ['aborted', 1]] as const)('rejects a %s diff with exit %i', async (flag, exitCode) => {
    const git = vi.fn(async (args: string[]) => ({ ...ok, stdout: 'conquer/feature',
      ...(args[0] === 'diff' ? { exitCode, [flag]: true } : {}) }));
    const commitBody = vi.fn(opts.commitBody);
    expect(await publishConquerBranch({ ...opts, commitBody }, git)).toMatchObject({ ok: false, stage: 'status' });
    expect(git).toHaveBeenCalledTimes(3);
    expect(commitBody).not.toHaveBeenCalled();
  });

  it('skips formatting and commit when the index matches HEAD', async () => {
    const git = vi.fn(async (args: string[]) => ({ ...ok, stdout: args[0] === 'rev-parse' ? 'conquer/feature' : '' }));
    const commitBody = vi.fn(opts.commitBody);
    expect(await publishConquerBranch({ ...opts, commitBody }, git)).toEqual({ ok: true, branch: 'conquer/feature' });
    expect(commitBody).not.toHaveBeenCalled();
    expect(git.mock.calls.map(call => call[0][0])).toEqual(['rev-parse', 'add', 'diff', 'push']);
  });

  it('reports push failure after skipping an empty commit', async () => {
    const git = vi.fn(async (args: string[]) => args[0] === 'push'
      ? { exitCode: 128, stdout: '', stderr: 'remote rejected' }
      : { ...ok, stdout: args[0] === 'rev-parse' ? 'conquer/feature' : '' });
    const commitBody = vi.fn(opts.commitBody);
    expect(await publishConquerBranch({ ...opts, commitBody }, git)).toMatchObject({
      ok: false, stage: 'push', branch: 'conquer/feature',
      remoteOutcome: 'unknown',
      message: 'git push failed: remote rejected — remote outcome is unknown. Inspect origin and local branch conquer/feature before retrying.',
    });
    expect(commitBody).not.toHaveBeenCalled();
    expect(git.mock.calls.map(call => call[0][0])).toEqual(['rev-parse', 'add', 'diff', 'push']);
  });

  it.each(['uncommitted', 'committed', 'mixed', 'reply-lost'] as const)('publishes %s work only to a local bare remote and leaves the source branch unchanged', async state => {
    const root = mkdtempSync(join(tmpdir(), 'agon-conquer-publication-'));
    roots.push(root);
    const cwd = join(root, 'source');
    const hooks = join(root, 'empty-hooks');
    mkdirSync(cwd); mkdirSync(hooks);
    const prefix = ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false'];
    const git = (args: string[], target = cwd) => execFileSync('git', [...prefix, ...args],
      { cwd: target, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    writeFileSync(join(cwd, 'base.txt'), 'base\n');
    git(['add', 'base.txt']); git(['commit', '-m', 'base']);
    const base = git(['rev-parse', 'main']);
    const remote = join(root, 'remote.git');
    git(['init', '--bare', remote]);
    git(['remote', 'add', 'origin', remote]);
    const worktree = join(root, 'candidate');
    git(['worktree', 'add', '-b', 'conquer/feature', worktree]);
    writeFileSync(join(worktree, 'feature.txt'), 'feature\n');
    if (state !== 'uncommitted') {
      git(['add', 'feature.txt'], worktree);
      git(['commit', '-m', 'builder implementation'], worktree);
    }
    const beforePublication = git(['rev-parse', 'HEAD'], worktree);
    if (state === 'mixed') writeFileSync(join(worktree, 'followup.txt'), 'remaining work\n');
    let pushes = 0;
    const out = await publishConquerBranch({ ...opts, cwd: worktree }, async (args, timeout) => {
      const result = await spawnWithTimeout({ command: 'git', args: [...prefix, ...args], cwd: worktree, timeout });
      if (args[0] === 'push') {
        pushes += 1;
        if (state === 'reply-lost') throw new Error('fixture lost reply after remote update');
      }
      return result;
    });
    if (state === 'reply-lost') expect(out).toMatchObject({ ok: false, stage: 'push', remoteOutcome: 'unknown' });
    else expect(out).toEqual({ ok: true, branch: 'conquer/feature' });
    expect(pushes).toBe(1);
    expect(git(['rev-parse', 'main'])).toBe(base);
    expect(git(['status', '--porcelain'])).toBe('');
    expect(git(['rev-parse', 'refs/heads/conquer/feature'], remote)).toBe(git(['rev-parse', 'HEAD'], worktree));
    expect(git(['show', 'conquer/feature:feature.txt'], remote)).toBe('feature');
    expect(git(['rev-list', '--count', 'main..conquer/feature'])).toBe(state === 'mixed' ? '2' : '1');
    if (state === 'mixed') expect(git(['show', 'conquer/feature:followup.txt'], remote)).toBe('remaining work');
    if (state === 'committed') expect(git(['rev-parse', 'HEAD'], worktree)).toBe(beforePublication);
    expect(git(['log', '-1', '--format=%B', 'conquer/feature'], remote).includes('Co-Authored-By')).toBe(false);
  });
});
