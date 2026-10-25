import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  classifyMutateTarget, GENERIC_SOURCE_MAX_BYTES, mutationTargetsFromDiff, resolveMutateTargets,
} from '../../packages/forge/src/mutate-targets.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function repo(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'mutate-targets-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

function diffFor(file: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i}`).join('\n');
  return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

describe('classifyMutateTarget', () => {
  it('classifies a plain unprofiled text file as generic', () => {
    const root = repo({ 'src/page.php': '<?php echo 1;\n' });
    expect(classifyMutateTarget(root, 'src/page.php')).toBe('generic');
  });

  it('classifies a profiled source as profiled', () => {
    const root = repo({ 'src/a.ts': 'export const a = 1;\n' });
    expect(classifyMutateTarget(root, 'src/a.ts')).toBe('profiled');
  });

  it('treats a file with a NUL byte as binary', () => {
    const root = repo({ 'src/blob.php': Buffer.from([0x61, 0x00, 0x62]) });
    expect(classifyMutateTarget(root, 'src/blob.php')).toBe('none');
  });

  it('treats an unreadable file as binary', () => {
    const root = repo({ 'src/secret.php': 'ok\n' });
    chmodSync(join(root, 'src/secret.php'), 0o000);
    try {
      expect(classifyMutateTarget(root, 'src/secret.php')).toBe('none');
    } finally {
      chmodSync(join(root, 'src/secret.php'), 0o644);
    }
  });

  it('excludes a file inside a dot directory at depth 2', () => {
    const root = repo({ 'src/.cache/x.php': 'a\n' });
    expect(classifyMutateTarget(root, 'src/.cache/x.php')).toBe('none');
  });

  it('excludes a file inside a dot directory at depth 1', () => {
    const root = repo({ '.cache/x.php': 'a\n' });
    expect(classifyMutateTarget(root, '.cache/x.php')).toBe('none');
  });

  it('excludes a file inside a skip directory at depth 2', () => {
    const root = repo({ 'a/node_modules/b.php': 'a\n' });
    expect(classifyMutateTarget(root, 'a/node_modules/b.php')).toBe('none');
  });

  it('excludes a file inside a skip directory at depth 1', () => {
    const root = repo({ 'node_modules/b.php': 'a\n' });
    expect(classifyMutateTarget(root, 'node_modules/b.php')).toBe('none');
  });

  it('does not exclude a file whose basename starts with a dot', () => {
    const root = repo({ 'src/.hidden.php': 'a\n' });
    expect(classifyMutateTarget(root, 'src/.hidden.php')).toBe('generic');
  });

  it('does not exclude a file whose basename equals a skip directory name', () => {
    const root = repo({ 'src/vendor.php': 'a\n' });
    expect(classifyMutateTarget(root, 'src/vendor.php', ['vendor.php'])).toBe('generic');
  });

  it('rejects an extensionless file', () => {
    const root = repo({ Makefile: 'all:\n' });
    expect(classifyMutateTarget(root, 'Makefile')).toBe('none');
  });

  it('rejects a lockfile name whose extension is not otherwise excluded', () => {
    const root = repo({ 'package-lock.json': '{}\n', 'bun.lockb': 'x\n' });
    expect(classifyMutateTarget(root, 'package-lock.json')).toBe('none');
    expect(classifyMutateTarget(root, 'bun.lockb')).toBe('none');
  });

  it('rejects well-known lockfiles', () => {
    const root = repo({ 'Cargo.lock': 'x\n', 'yarn.lock': 'x\n' });
    expect(classifyMutateTarget(root, 'Cargo.lock')).toBe('none');
    expect(classifyMutateTarget(root, 'yarn.lock')).toBe('none');
  });

  it('rejects prose extensions case-insensitively', () => {
    const root = repo({ 'notes.md': 'x\n', 'NOTES.MD': 'x\n' });
    expect(classifyMutateTarget(root, 'notes.md')).toBe('none');
    expect(classifyMutateTarget(root, 'NOTES.MD')).toBe('none');
  });

  it('rejects a directory with a source-looking name', () => {
    const root = repo({ 'src/dir.php/inner.txt': 'x\n' });
    expect(classifyMutateTarget(root, 'src/dir.php')).toBe('none');
  });

  it('rejects a missing file', () => {
    const root = repo({});
    expect(classifyMutateTarget(root, 'src/missing.php')).toBe('none');
  });

  it('rejects a file over the size limit but accepts one at the limit', () => {
    const root = repo({
      'big.php': Buffer.alloc(GENERIC_SOURCE_MAX_BYTES + 1, 0x61),
      'edge.php': Buffer.alloc(GENERIC_SOURCE_MAX_BYTES, 0x61),
    });
    expect(classifyMutateTarget(root, 'big.php')).toBe('none');
    expect(classifyMutateTarget(root, 'edge.php')).toBe('generic');
  });

  it('classifies a test file as none', () => {
    const root = repo({ 'src/a.test.ts': 'x\n' });
    expect(classifyMutateTarget(root, 'src/a.test.ts')).toBe('none');
  });
});

describe('mutationTargetsFromDiff', () => {
  it('returns changed lines for a profiled source', () => {
    expect(mutationTargetsFromDiff(diffFor('src/a.ts', 2))).toEqual({ 'src/a.ts': [1, 2] });
  });

  it('drops test files', () => {
    expect(mutationTargetsFromDiff(diffFor('src/a.test.ts', 2))).toEqual({});
  });

  it('drops unprofiled files', () => {
    expect(mutationTargetsFromDiff(diffFor('src/page.php', 2))).toEqual({});
  });

  it('yields nothing for a pure-deletion hunk', () => {
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +0,0 @@\n-one\n-two\n';
    expect(mutationTargetsFromDiff(diff)).toEqual({});
  });

  it('keeps the source and drops the test file in a mixed diff', () => {
    const diff = diffFor('src/a.ts', 1) + diffFor('src/a.test.ts', 1);
    expect(mutationTargetsFromDiff(diff)).toEqual({ 'src/a.ts': [1] });
  });
});

describe('resolveMutateTargets', () => {
  it('ignores generic and test files without wantGeneric and records no skipped entry', () => {
    const root = repo({ 'src/page.php': 'a\n', 'src/a.test.ts': 'x\n' });
    const diff = diffFor('src/page.php', 1) + diffFor('src/a.test.ts', 1);
    expect(resolveMutateTargets({ repoRoot: root, diff, allowGeneric: true, wantGeneric: false })).toEqual({ targets: {}, skippedGeneric: [] });
  });

  it('lists generic files as skipped when wantGeneric but not allowGeneric', () => {
    const root = repo({ 'src/page.php': 'a\n' });
    const result = resolveMutateTargets({ repoRoot: root, diff: diffFor('src/page.php', 1), allowGeneric: false, wantGeneric: true });
    expect(result).toEqual({ targets: {}, skippedGeneric: ['src/page.php'] });
  });

  it('targets generic files when wantGeneric and allowGeneric', () => {
    const root = repo({ 'src/page.php': 'a\n' });
    const result = resolveMutateTargets({ repoRoot: root, diff: diffFor('src/page.php', 1), allowGeneric: true, wantGeneric: true });
    expect(result).toEqual({ targets: { 'src/page.php': [1] }, skippedGeneric: [] });
  });

  it('targets every line of a plain file path argument', () => {
    const root = repo({ 'src/a.ts': 'one\ntwo\nthree' });
    const result = resolveMutateTargets({ repoRoot: root, files: ['src/a.ts'], allowGeneric: false, wantGeneric: false });
    expect(result.targets).toEqual({ 'src/a.ts': [1, 2, 3] });
    expect(result.error).toBeUndefined();
  });

  it('walks a directory argument and skips dot and skip directories', () => {
    const root = repo({
      'src/a.ts': 'one\ntwo',
      'src/.hidden/b.ts': 'x',
      'src/node_modules/c.ts': 'x',
      'src/nested/d.ts': 'x',
    });
    const result = resolveMutateTargets({ repoRoot: root, files: ['src'], allowGeneric: false, wantGeneric: false });
    expect(result.targets).toEqual({ 'src/a.ts': [1, 2], 'src/nested/d.ts': [1] });
  });

  it('rejects a test file path argument', () => {
    const root = repo({ 'src/a.test.ts': 'x\n' });
    const result = resolveMutateTargets({ repoRoot: root, files: ['src/a.test.ts'], allowGeneric: false, wantGeneric: false });
    expect(result.error).toMatch(/is a test file/);
  });

  it('reports a missing path argument', () => {
    const root = repo({});
    const result = resolveMutateTargets({ repoRoot: root, files: ['nope.ts'], allowGeneric: false, wantGeneric: false });
    expect(result.error).toMatch(/target not found/);
  });
});
