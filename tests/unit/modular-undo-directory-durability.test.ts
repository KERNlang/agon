import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyPatchWithUndo } from '../../packages/support-worktree/src/patch-apply.js';

const state = vi.hoisted(() => ({ paths: new Map<number, string>(), synced: [] as string[], failPath: '', workspace: '' }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      state.paths.set(fd, String(args[0]));
      return fd;
    },
    closeSync: (fd: number) => { state.paths.delete(fd); fs.closeSync(fd); },
    fsyncSync: (fd: number) => {
      if (state.workspace) expect(fs.readFileSync(join(state.workspace, 'file.txt'), 'utf8')).toBe('before\n');
      const path = state.paths.get(fd)!;
      state.synced.push(path);
      if (path === state.failPath) throw Object.assign(new Error('fixture directory sync failure'), { code: 'EIO' });
      fs.fsyncSync(fd);
    },
  };
});
const roots: string[] = [];
afterEach(() => {
  state.paths.clear(); state.synced.length = 0; state.failPath = ''; state.workspace = '';
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-undo-durable-'));
  roots.push(cwd);
  execFileSync('git', ['init', '--quiet', cwd]);
  writeFileSync(join(cwd, 'file.txt'), 'before\n');
  state.workspace = cwd;
  return { cwd, undoDir: join(cwd, 'state', 'undo') };
}
const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n';

it('syncs the inverse record and every newly published directory before applying', () => {
  const { cwd, undoDir } = fixture();
  const result = applyPatchWithUndo(cwd, patch, undoDir);
  expect(result.ok).toBe(true);
  expect(state.synced).toEqual([
    join(undoDir, `${result.undoToken}.patch`), undoDir, join(cwd, 'state'), cwd,
  ]);
  expect(state.paths.size).toBe(0);
  expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
});

it.each(['undo', 'state', 'root'])('refuses workspace mutation when directory sync fails at %s', level => {
  const { cwd, undoDir } = fixture();
  state.failPath = level === 'undo' ? undoDir : level === 'state' ? join(cwd, 'state') : cwd;
  const result = applyPatchWithUndo(cwd, patch, undoDir);
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('no patch applied') });
  expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  expect(readdirSync(undoDir)).toEqual([]);
  expect(state.paths.size).toBe(0);
});

it.each(['state', 'undo'])('syncs publication when %s already exists', existing => {
  const { cwd, undoDir } = fixture();
  mkdirSync(existing === 'state' ? join(cwd, 'state') : undoDir, { recursive: true });
  const result = applyPatchWithUndo(cwd, patch, undoDir);
  expect(result.ok).toBe(true);
  expect(state.synced).toEqual([
    join(undoDir, `${result.undoToken}.patch`), undoDir,
    ...(existing === 'state' ? [join(cwd, 'state')] : []),
  ]);
  expect(state.paths.size).toBe(0);
});

it('syncs a newly created directory directly under the OS temporary alias', () => {
  const { cwd } = fixture();
  const undoDir = `/tmp/agon-undo-first-${randomUUID()}`;
  roots.push(undoDir);
  const result = applyPatchWithUndo(cwd, patch, undoDir);
  expect(result.ok, result.error).toBe(true);
  expect(state.synced).toContain(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
  expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
});
