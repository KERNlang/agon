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
    const git = vi.fn(async () => ok).mockResolvedValueOnce({ ...ok, stdout: 'conquer/feature\n' });
    expect(await publishConquerBranch(opts, git)).toEqual({ ok: true, branch: 'conquer/feature' });
    expect(git.mock.calls).toEqual([
      [['rev-parse', '--abbrev-ref', 'HEAD'], 15_000],
      [['add', '-A'], 30_000],
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

  it('formats the commit body only after successful staging', async () => {
    const git = vi.fn(async () => ok).mockResolvedValueOnce({ ...ok, stdout: 'conquer/feature' });
    const commitBody = vi.fn(() => {
      expect(git).toHaveBeenCalledTimes(2);
      return 'formatted claim';
    });
    await publishConquerBranch({ ...opts, commitBody }, git);
    expect(commitBody).toHaveBeenCalledTimes(1);
    expect(git).toHaveBeenNthCalledWith(3, ['commit', '-m', 'conquer: build feature', '-m', 'formatted claim'], 30_000);
  });

  it.each(['branch', 'add', 'commit', 'push'] as const)('stops at failed %s', async stage => {
    const index = ['branch', 'add', 'commit', 'push'].indexOf(stage);
    let calls = 0;
    const git = vi.fn(async () => calls++ === index
      ? { exitCode: 1, stdout: 'conquer/feature', stderr: 'x'.repeat(300) }
      : { ...ok, stdout: 'conquer/feature' });
    const result = await publishConquerBranch(opts, git);
    expect(result).toMatchObject({ ok: false, stage });
    expect(git).toHaveBeenCalledTimes(index + 1);
    if (!result.ok && stage !== 'branch') {
      expect(result.message).toContain('x'.repeat(200));
      expect(result.message).not.toContain('x'.repeat(201));
    }
  });

  it('publishes only to a local bare remote and leaves the source branch unchanged', async () => {
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
    const out = await publishConquerBranch({ ...opts, cwd: worktree },
      (args, timeout) => spawnWithTimeout({ command: 'git', args: [...prefix, ...args], cwd: worktree, timeout }));
    expect(out).toEqual({ ok: true, branch: 'conquer/feature' });
    expect(git(['rev-parse', 'main'])).toBe(base);
    expect(git(['status', '--porcelain'])).toBe('');
    expect(git(['rev-parse', 'refs/heads/conquer/feature'], remote)).toBe(git(['rev-parse', 'HEAD'], worktree));
    expect(git(['show', 'conquer/feature:feature.txt'], remote)).toBe('feature');
    expect(git(['log', '-1', '--format=%B', 'conquer/feature'], remote).includes('Co-Authored-By')).toBe(false);
  });
});
