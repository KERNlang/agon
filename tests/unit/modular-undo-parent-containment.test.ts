import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyPatchWithUndo, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const git = vi.hoisted(() => vi.fn(() => ''));
vi.mock('node:child_process', () => ({ execSync: git, execFileSync: vi.fn(() => '/fixture') }));
const roots: string[] = [];
afterEach(() => {
  git.mockClear();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agon-undo-parent-')));
  roots.push(root);
  const target = join(root, 'outside');
  mkdirSync(target);
  return { root, target };
}
const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n';

it.each(['directory', 'parent', 'grandparent'])('refuses undo through a linked %s before Git runs', level => {
  const { root, target } = fixture();
  symlinkSync(target, join(root, 'linked'));
  const suffix = level === 'directory' ? '' : level === 'parent' ? 'undo' : 'nested/undo';
  const destination = join(target, suffix);
  mkdirSync(destination, { recursive: true });
  const record = join(destination, 'legacy-token.patch');
  writeFileSync(record, patch);
  const result = undoPatch(root, 'legacy-token', join(root, 'linked', suffix));
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('symbolic link') });
  expect(git).not.toHaveBeenCalled();
  expect(readFileSync(record, 'utf8')).toBe(patch);
});

it.each(['directory', 'parent', 'grandparent'])('refuses publication through a linked %s before creating state', level => {
  const { root, target } = fixture();
  symlinkSync(target, join(root, 'linked'));
  const suffix = level === 'directory' ? '' : level === 'parent' ? 'undo' : 'nested/undo';
  const result = applyPatchWithUndo(root, patch, join(root, 'linked', suffix));
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('symbolic link') });
  expect(git).not.toHaveBeenCalled();
  expect(readdirSync(target)).toEqual([]);
});

it('preserves ordinary nested storage and historical token names', () => {
  const { root } = fixture();
  const directory = join(root, 'state', 'undo');
  const applied = applyPatchWithUndo(root, patch, directory);
  expect(applied.ok).toBe(true);
  expect(git).toHaveBeenCalledTimes(1);
  writeFileSync(join(directory, 'undo-1700000000000.patch'), patch);
  expect(undoPatch(root, 'undo-1700000000000', directory)).toEqual({ ok: true });
  expect(git).toHaveBeenCalledTimes(2);
});

it('preserves the operating-system temporary-directory alias', () => {
  // /tmp is a standard symlink on macOS. It is an ordinary directory on Linux.
  const root = mkdtempSync('/tmp/agon-undo-os-alias-');
  roots.push(root);
  const applied = applyPatchWithUndo(root, patch, join(root, 'undo'));
  expect(applied.ok).toBe(true);
  expect(undoPatch(root, applied.undoToken!, join(root, 'undo'))).toEqual({ ok: true });
});
