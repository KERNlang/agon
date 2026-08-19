// Pins the ONE path-containment primitive (packages/core/src/kern/blocks/paths.kern).
// Every surface that writes a file whose path came from somewhere untrusted goes
// through it: the mutant runner, `agon mutate`'s target resolution, and goal's
// worktree writes.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath, isInsideRealpath, resolveWithinRoot } from '../../packages/core/src/generated/blocks/paths.js';

const dirs: string[] = [];
const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-paths-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('resolveWithinRoot — containment is decided on CANONICAL paths', () => {
  // macOS: os.tmpdir() hands back /var/... which is a symlink to /private/var.
  // A caller that realpath'd its root and a caller that did not are naming the
  // SAME directory, and an absolute target spelled either way must be accepted.
  it('accepts an absolute target spelled through a symlinked ancestor of the root', () => {
    const raw = sandbox();
    const real = realpathSync(raw);
    writeFileSync(join(raw, 'f.ts'), 'x');
    // root canonical, candidate not
    expect(resolveWithinRoot(real, join(raw, 'f.ts'))).toBe(join(raw, 'f.ts'));
    // root not canonical, candidate canonical
    expect(resolveWithinRoot(raw, join(real, 'f.ts'))).toBe(join(real, 'f.ts'));
    // both the same spelling still works
    expect(resolveWithinRoot(raw, join(raw, 'f.ts'))).toBe(join(raw, 'f.ts'));
  });

  it('accepts a not-yet-existing absolute target under a symlink-spelled root', () => {
    const raw = sandbox();
    const real = realpathSync(raw);
    expect(resolveWithinRoot(real, join(raw, 'nested/new.ts'))).toBe(join(raw, 'nested/new.ts'));
  });

  it('still rejects a real escape — the canonical fallback is not a loophole', () => {
    const root = realpathSync(sandbox());
    const outside = realpathSync(sandbox());
    expect(() => resolveWithinRoot(root, '../outside.ts')).toThrow(/escapes/);
    expect(() => resolveWithinRoot(root, join(outside, 'f.ts'))).toThrow(/escapes/);
  });

  it('still refuses a symlinked final component', () => {
    const root = realpathSync(sandbox());
    const outside = realpathSync(sandbox());
    writeFileSync(join(outside, 'target.ts'), 'x');
    symlinkSync(join(outside, 'target.ts'), join(root, 'link.ts'));
    expect(() => resolveWithinRoot(root, 'link.ts')).toThrow(/symlink/);
  });

  it('still refuses a path whose PARENT is a symlink out of the root', () => {
    const root = realpathSync(sandbox());
    const outside = realpathSync(sandbox());
    mkdirSync(join(outside, 'sub'));
    symlinkSync(join(outside, 'sub'), join(root, 'sub'));
    expect(() => resolveWithinRoot(root, 'sub/f.ts')).toThrow(/escapes/);
  });
});

describe('isInsideRealpath / canonicalPath', () => {
  it('resolves both sides before comparing', () => {
    const raw = sandbox();
    const real = realpathSync(raw);
    expect(isInsideRealpath(real, join(raw, 'f.ts'))).toBe(true);
    expect(isInsideRealpath(raw, real)).toBe(true);
    expect(isInsideRealpath(real, realpathSync(sandbox()))).toBe(false);
  });

  it('canonicalizes a missing path through its deepest existing ancestor', () => {
    const raw = sandbox();
    const real = realpathSync(raw);
    expect(canonicalPath(join(raw, 'a/b/c.ts'))).toBe(join(real, 'a/b/c.ts'));
  });
});
