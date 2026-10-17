import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';

import { runWorkspace, runWorktree } from './implementation.js';

const originalHome = process.env.AGON_HOME;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = originalHome;
});

function fixture(): { repo: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'wt-fixture-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo);
  process.env.AGON_HOME = home;
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@e'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });
  writeFileSync(join(repo, 'a'), 'a');
  execFileSync('git', ['add', 'a'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'a'], { cwd: repo });
  return { repo, home };
}

function context(cwd: string): InvocationContext {
  return { invocationId: 'wt', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
}

function services(decision: 'allow' | 'deny' = 'allow'): ModServices {
  return {
    permissions: { check: vi.fn(async () => decision) },
    receipts: { record: vi.fn(async () => 'receipt-wt') },
    workspace: { setSessionRoot: vi.fn() },
  } as unknown as ModServices;
}

describe('physical worktrees mod', () => {
  it('creates, lists, protects dirty state, and removes an isolated worktree', async () => {
    const { repo } = fixture();
    const made = await runWorktree({ action: 'new', branch: 'feature/x', deps: 'none' }, context(repo), services());
    expect(made.exitCode).toBe(0);
    const path = (made.result as any).path;
    expect((await runWorktree({ action: 'list' }, context(repo), services()).then((result) => (result.result as any).worktrees))).toHaveLength(1);
    writeFileSync(join(path, 'dirty'), 'x');
    expect((await runWorktree({ action: 'rm', branch: 'feature/x' }, context(repo), services())).exitCode).toBe(1);
    expect((await runWorktree({ action: 'rm', branch: 'feature/x', force: true }, context(repo), services())).exitCode).toBe(0);
    expect(execFileSync('git', ['show-ref', '--verify', 'refs/heads/feature/x'], { cwd: repo, encoding: 'utf8' })).toContain('refs/heads/feature/x');
  });

  it('prune dry-run is age-aware and rehydrate restores dependency/artifact overlays', async () => {
    const { repo } = fixture();
    mkdirSync(join(repo, 'node_modules'));
    mkdirSync(join(repo, 'packages', 'p', 'dist'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'p', 'package.json'), '{"name":"p"}');
    writeFileSync(join(repo, 'packages', 'p', 'dist', 'index.js'), 'export {}');
    writeFileSync(join(repo, 'package-lock.json'), '{}');
    writeFileSync(join(repo, '.gitignore'), 'node_modules\npackages/*/dist\n');
    execFileSync('git', ['add', 'packages/p/package.json', 'package-lock.json', '.gitignore'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'package fixture'], { cwd: repo });
    const made = await runWorktree({ action: 'new', branch: 'feature/old', deps: 'none' }, context(repo), services());
    const path = (made.result as any).path;
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(path, old, old);
    const preview = await runWorktree({ action: 'prune', 'older-than': '1d', 'dry-run': true }, context(repo), services());
    expect((preview.result as any).session).toEqual(['feature/old']);
    expect(existsSync(path)).toBe(true);
    const rehydrated = await runWorktree({ action: 'rehydrate', branch: 'feature/old' }, context(repo), services());
    expect(rehydrated.exitCode).toBe(0);
    expect(existsSync(join(path, 'node_modules'))).toBe(true);
    expect(existsSync(join(path, 'packages', 'p', 'dist', 'index.js'))).toBe(true);
  });

  it('requires an explicit network grant for dependency installation', async () => {
    const { repo } = fixture();
    const denied = services();
    (denied.permissions.check as ReturnType<typeof vi.fn>).mockImplementation(async (capability: string) => capability === 'network' ? 'deny' : 'allow');
    const result = await runWorktree({ action: 'new', branch: 'feature/install', deps: 'install' }, context(repo), denied);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('network') });
  });

  it.each(['clean', 'dirty'])('does not prune a young %s ephemeral worktree omitted from the preview', async (state) => {
    const { repo } = fixture();
    const path = join(repo, '.agon', 'goals', 'active-task');
    execFileSync('git', ['worktree', 'add', '--detach', path, 'HEAD'], { cwd: repo, stdio: 'pipe' });
    if (state === 'dirty') writeFileSync(join(path, 'unsaved.txt'), 'operator work\n');
    const input = { action: 'prune', 'older-than': '7d' };
    const preview = await runWorktree({ ...input, 'dry-run': true }, context(repo), services());
    expect(preview.exitCode).toBe(0);
    expect((preview.result as any).ephemeral).toEqual([]);
    const applied = await runWorktree(input, context(repo), services());
    expect(applied.exitCode).toBe(0);
    expect(existsSync(join(path, 'a'))).toBe(true);
    if (state === 'dirty') expect(existsSync(join(path, 'unsaved.txt'))).toBe(true);
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toContain(path);
    await runWorktree({ ...input, force: true }, context(repo), services());
    expect(existsSync(path)).toBe(true);
  });

  it.each(['agent-worktrees', 'speculate-worktrees', 'runs', 'goals'])('previews exact stale removals under %s and preserves dirty and locked paths', async (directory) => {
    const { repo } = fixture();
    const paths = ['clean', 'dirty', 'locked'].map((leaf) => join(repo, '.agon', directory, leaf));
    for (const path of paths) execFileSync('git', ['worktree', 'add', '--detach', path, 'HEAD'], { cwd: repo, stdio: 'pipe' });
    writeFileSync(join(paths[1], 'unsaved.txt'), 'keep\n');
    execFileSync('git', ['worktree', 'lock', paths[2]], { cwd: repo });
    const old = new Date('2020-01-01T00:00:00Z');
    for (const path of paths) utimesSync(path, old, old);
    const canonicalPaths = paths.map((path) => realpathSync(path));
    const input = { action: 'prune', 'older-than': '7d' };
    const preview = await runWorktree({ ...input, 'dry-run': true }, context(repo), services());
    expect((preview.result as any).ephemeral).toEqual([canonicalPaths[0]]);
    expect(paths.every((path) => existsSync(path))).toBe(true);
    const applied = await runWorktree(input, context(repo), services());
    expect((applied.result as any).ephemeral).toEqual((preview.result as any).ephemeral);
    expect(existsSync(paths[0])).toBe(false);
    expect(existsSync(join(paths[1], 'unsaved.txt'))).toBe(true);
    expect(existsSync(paths[2])).toBe(true);
    const forced = await runWorktree({ ...input, force: true }, context(repo), services());
    expect((forced.result as any).ephemeral).toEqual([canonicalPaths[1]]);
    expect(existsSync(paths[2])).toBe(true);
  });

  it.each(['nested-root', 'sibling-prefix', 'symlink-parent'])('refuses ephemeral pruning through %s', async (kind) => {
    const { repo } = fixture();
    let path = kind === 'nested-root'
      ? join(repo, 'notes', '.agon', 'goals', 'keep')
      : join(repo, '.agon', 'goals-extra', 'keep');
    if (kind === 'symlink-parent') {
      const outside = join(repo, '..', 'outside');
      mkdirSync(outside);
      mkdirSync(join(repo, '.agon'));
      symlinkSync(outside, join(repo, '.agon', 'goals'), 'dir');
      path = join(repo, '.agon', 'goals', 'keep');
    }
    execFileSync('git', ['worktree', 'add', '--detach', path, 'HEAD'], { cwd: repo, stdio: 'pipe' });
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(path, old, old);
    const result = await runWorktree({ action: 'prune', 'older-than': '7d', force: true }, context(repo), services());
    expect(result.exitCode).toBe(0);
    expect((result.result as any).ephemeral).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  it('reports earlier removals when Git refuses a later populated submodule worktree', async () => {
    const { repo } = fixture();
    const local = join(repo, '..', 'local-submodule');
    mkdirSync(local);
    const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    git(local, ['init', '-q', '-b', 'main']);
    git(local, ['config', 'user.email', 't@e']);
    git(local, ['config', 'user.name', 'T']);
    writeFileSync(join(local, 'file'), 'submodule\n');
    git(local, ['add', 'file']);
    git(local, ['commit', '-qm', 'submodule']);
    git(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', local, 'dependency']);
    git(repo, ['commit', '-qm', 'add submodule']);
    const clean = join(repo, '.agon', 'goals', 'a-clean');
    const blocked = join(repo, '.agon', 'goals', 'b-submodule');
    for (const path of [clean, blocked]) git(repo, ['worktree', 'add', '--detach', path, 'HEAD']);
    git(blocked, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init']);
    const old = new Date('2020-01-01T00:00:00Z');
    for (const path of [clean, blocked]) utimesSync(path, old, old);
    const canonical = [realpathSync(clean), realpathSync(blocked)];
    const host = services();
    const result = await runWorktree({ action: 'prune', 'older-than': '7d' }, context(repo), host);
    expect(result.exitCode).toBe(1);
    expect((result.result as any).ephemeral).toEqual([canonical[0]]);
    expect((result.result as any).ephemeralErrors).toEqual([expect.objectContaining({ path: canonical[1] })]);
    expect(host.receipts.record).toHaveBeenCalledWith('worktrees-pruned', expect.objectContaining({ ephemeral: [canonical[0]] }));
    expect(existsSync(clean)).toBe(false);
    expect(existsSync(join(blocked, 'dependency', 'file'))).toBe(true);
  });

  it('physically owns workspace bookmark add/list/switch/remove and asks the host to ground switch', async () => {
    const { repo } = fixture();
    const host = services();
    expect((await runWorkspace({ action: 'add', path: repo }, context(repo), host)).exitCode).toBe(0);
    const listed = await runWorkspace({ action: 'list' }, context(repo), host);
    expect((listed.result as any).workspaces[0].path).toBe(repo);
    expect((await runWorkspace({ action: 'switch', path: repo }, context(repo), host)).exitCode).toBe(0);
    expect(host.workspace!.setSessionRoot).toHaveBeenCalledWith(repo, expect.objectContaining({ cwd: repo }));
    expect((await runWorkspace({ action: 'remove', path: repo }, context(repo), host)).exitCode).toBe(0);
  });
});
