// Pins the ONE path-containment primitive (packages/core/src/blocks/paths.ts).
// Every surface that writes a file whose path came from somewhere untrusted goes
// through it: the mutant runner, `agon mutate`'s target resolution, and goal's
// worktree writes.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath, isInsideRealpath, resolveWithinRoot } from '../../packages/core/src/blocks/paths.js';
import { runMutationAssessment } from '../../packages/support-worktree/src/mutation-runner.js';

const dirs: string[] = [];
const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-paths-'));
  dirs.push(dir);
  return dir;
};

describe('mutation assessment containment', () => {
  it('rechecks candidate paths after the baseline command changes them', async () => {
    const root = sandbox(), outside = sandbox();
    const original = 'export const value = 2 + 3;\n';
    const external = join(outside, 'value.mjs');
    writeFileSync(external, original);
    writeFileSync(join(root, 'value.mjs'), original);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-m', 'fixture');
    const before = git('worktree', 'list', '--porcelain');
    const command = `const fs=require('node:fs');fs.unlinkSync('value.mjs');fs.symlinkSync(${JSON.stringify(external)},'value.mjs');`;
    const result = await runMutationAssessment({ repoRoot: root, files: ['value.mjs'],
      testCmd: `node -e ${JSON.stringify(command)}`, outputDir: join(root, 'out') },
    { cwd: root, signal: new AbortController().signal }, { engines: { dispatch() { throw new Error('Unexpected provider'); } } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/symlink/);
    expect(readFileSync(external, 'utf8')).toBe(original);
    expect(readFileSync(join(root, 'value.mjs'), 'utf8')).toBe(original);
    expect(git('worktree', 'list', '--porcelain')).toBe(before);
  });

  it.each(['file', 'parent'] as const)('rejects a tracked %s symlink before mutation', async kind => {
    const root = sandbox(), outside = sandbox();
    const original = 'export const value = 2 + 3;\n';
    writeFileSync(join(outside, 'value.mjs'), original);
    const target = kind === 'file' ? 'linked.mjs' : 'linked/value.mjs';
    symlinkSync(kind === 'file' ? join(outside, 'value.mjs') : outside, join(root, kind === 'file' ? target : 'linked'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-m', 'fixture');
    const before = git('worktree', 'list', '--porcelain');
    for (const selection of [{ files: [target] }, { diff: `diff --git a/${target} b/${target}\n--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-old\n+${original}` }]) {
      const result = await runMutationAssessment({ repoRoot: root, ...selection, testCmd: 'true', outputDir: join(root, 'out') },
        { cwd: root, signal: new AbortController().signal }, { engines: { dispatch() { throw new Error('Unexpected provider'); } } })
        .catch(error => ({ ok: false, error: String(error) }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/symlink|escapes/);
      expect(readFileSync(join(outside, 'value.mjs'), 'utf8')).toBe(original);
      expect(git('worktree', 'list', '--porcelain')).toBe(before);
    }
  });
});

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
