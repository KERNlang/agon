import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { invertPatch, parsePatch } from '../../packages/support-worktree/src/patch-parser.js';
import { applyPatchWithUndo, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each([
  ['create', null, 'created\n'],
  ['delete', 'deleted\n', null],
  ['create empty', null, ''],
  ['delete empty', '', null],
  ['header-like content', '-- a/before\n++ b/before\n', '++ b/after\n-- a/after\n'],
  ['no final newline', 'before', 'after'],
  ['ordinary change', 'before\n', 'after\n'],
] as const)('Git accepts the inverse of %s and restores exact bytes', (_name, before, after) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-invert-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  writeFileSync(join(cwd, 'sentinel'), 'unchanged\n');
  if (before !== null) writeFileSync(join(cwd, 'file.txt'), before);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  if (after === null) unlinkSync(join(cwd, 'file.txt'));
  else writeFileSync(join(cwd, 'file.txt'), after);
  git('add', '--all');
  const patch = git('diff', '--cached', '--binary');
  expect(patch).not.toBe('');
  const inverse = invertPatch(patch);
  expect(invertPatch(inverse)).toBe(patch);
  execFileSync('git', ['apply', '--check', '-'], { cwd, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync('git', ['apply', '-'], { cwd, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  if (before === null) expect(existsSync(join(cwd, 'file.txt'))).toBe(false);
  else expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe(before);
  expect(readFileSync(join(cwd, 'sentinel'), 'utf8')).toBe('unchanged\n');
  // A restored deletion is untracked against the staged deletion. Include it
  // before comparing the complete resulting tree, not just tracked entries.
  git('add', '--all');
  expect(git('diff', '--cached', 'HEAD')).toBe('');
});

it.each(['create', 'delete', 'change', 'delta', 'large change'])('restores binary bytes after %s', kind => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-invert-binary-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  });
  git('init', '--quiet');
  writeFileSync(join(cwd, 'sentinel'), 'unchanged\n');
  // Two incompressible 6 MiB payloads exceed V8's function-argument limit.
  // The larger output buffer belongs only to this real-Git fixture.
  const before = Buffer.alloc(kind === 'large change' ? 6 * 1024 * 1024 : 8192);
  let seed = 12345;
  for (let i = 1; i < before.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    before[i] = seed >>> 24;
  }
  if (kind !== 'create') writeFileSync(join(cwd, 'data.bin'), before);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const after = Buffer.from(before);
  if (kind === 'delta') after[100] ^= 0xff;
  else for (let i = 1; i < after.length; i++) after[i] ^= 0xff;
  if (kind === 'delete') unlinkSync(join(cwd, 'data.bin'));
  else writeFileSync(join(cwd, 'data.bin'), after);
  git('add', '--all');
  const patch = git('diff', '--cached', '--binary');
  expect(patch).toContain('GIT binary patch');
  if (kind === 'delta') expect(patch).toContain('\ndelta ');
  const inverse = invertPatch(patch);
  expect(invertPatch(inverse)).toBe(patch);
  // Git can bypass binary payloads when the target blob already exists in its
  // object database. A fresh recipient proves the inverse payload itself works.
  const recipient = join(cwd, 'recipient');
  mkdirSync(recipient);
  execFileSync('git', ['init', '--quiet'], { cwd: recipient });
  if (kind !== 'delete') writeFileSync(join(recipient, 'data.bin'), after);
  writeFileSync(join(recipient, 'sentinel'), 'unchanged\n');
  execFileSync('git', ['apply', '--check', '-'], { cwd: recipient, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync('git', ['apply', '-'], { cwd: recipient, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  if (kind === 'create') expect(existsSync(join(recipient, 'data.bin'))).toBe(false);
  else expect(readFileSync(join(recipient, 'data.bin')).equals(before), 'restored binary bytes').toBe(true);
  expect(readFileSync(join(recipient, 'sentinel'), 'utf8')).toBe('unchanged\n');
});

it('counts header-like hunk lines as changed content', () => {
  const patch = 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- a/content\n+++ b/content\n';
  expect(parsePatch(patch)).toMatchObject([{ additions: 1, deletions: 1,
    hunks: [{ additions: 1, deletions: 1, lines: expect.arrayContaining(['--- a/content', '+++ b/content']) }] }]);
});

it.each(['change', 'create', 'delete'] as const)('restores a forward-only binary %s without producer objects', kind => {
  const producer = mkdtempSync(join(tmpdir(), 'agon-binary-forward-'));
  const recipient = mkdtempSync(join(tmpdir(), 'agon-binary-recipient-'));
  roots.push(producer, recipient);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: producer, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  const before = Buffer.from([0, 1, 2, 3]);
  const after = Buffer.from([0, 4, 5, 6]);
  writeFileSync(join(producer, 'sentinel'), 'unchanged\n');
  if (kind !== 'create') writeFileSync(join(producer, 'data.bin'), before);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  if (kind === 'delete') unlinkSync(join(producer, 'data.bin'));
  else writeFileSync(join(producer, 'data.bin'), after);
  git('add', '--all');
  const complete = git('diff', '--cached', '--binary');
  expect(complete).toContain('GIT binary patch');
  const patch = complete.slice(0, complete.indexOf('\n\n', complete.indexOf('GIT binary patch')) + 2);
  execFileSync('git', ['init', '--quiet'], { cwd: recipient });
  if (kind !== 'create') writeFileSync(join(recipient, 'data.bin'), before);
  execFileSync('git', ['apply', '-'], { cwd: recipient, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
  if (kind === 'delete') expect(existsSync(join(recipient, 'data.bin'))).toBe(false);
  else expect(readFileSync(join(recipient, 'data.bin'))).toEqual(after);
  expect(() => invertPatch(patch)).toThrow('Binary inversion requires a reverse payload or workspace context');
  if (kind === 'create') unlinkSync(join(recipient, 'data.bin'));
  else writeFileSync(join(recipient, 'data.bin'), before);
  const undoDir = mkdtempSync(join(tmpdir(), 'agon-binary-records-'));
  roots.push(undoDir);
  const applied = applyPatchWithUndo(recipient, patch, undoDir);
  expect(applied.ok, applied.error).toBe(true);
  if (kind === 'delete') expect(existsSync(join(recipient, 'data.bin'))).toBe(false);
  else expect(readFileSync(join(recipient, 'data.bin'))).toEqual(after);
  const undone = undoPatch(recipient, applied.undoToken!, undoDir);
  expect(undone.ok, undone.error).toBe(true);
  if (kind === 'create') expect(existsSync(join(recipient, 'data.bin'))).toBe(false);
  else expect(readFileSync(join(recipient, 'data.bin'))).toEqual(before);
});

it('requires context for copy inversion and proves Git shortcuts cannot replace it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-invert-copy-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  const content = 'original content\n';
  writeFileSync(join(cwd, 'source.txt'), content);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  writeFileSync(join(cwd, 'copy.txt'), content);
  git('add', '--all');
  const patch = git('diff', '--cached', '--find-copies-harder', '--binary');
  expect(patch).toContain('copy from source.txt');
  expect(() => invertPatch(patch)).toThrow('Copy inversion requires workspace context');
  const deletion = `diff --git a/copy.txt b/copy.txt\ndeleted file mode 100644\nindex ${git('hash-object', 'copy.txt').trim()}..${'0'.repeat(40)}\n`;
  expect(() => execFileSync('git', ['apply', '--reverse', '-'], {
    cwd, input: patch,
    stdio: ['pipe', 'pipe', 'pipe'],
  })).toThrow('already exists');
  expect(() => execFileSync('git', ['apply', '-'], {
    cwd, input: deletion, stdio: ['pipe', 'pipe', 'pipe'],
  })).toThrow('removal patch leaves file contents');
  expect(readFileSync(join(cwd, 'source.txt'), 'utf8')).toBe(content);
  expect(readFileSync(join(cwd, 'copy.txt'), 'utf8')).toBe(content);
});

it.each([
  ['mode only', 'original.txt', 'original.txt', false],
  ['rename', 'original.txt', 'renamed.txt', false],
  ['rename with edit', 'original.txt', 'renamed.txt', true],
  ['spaces', 'old name.txt', 'new name.txt', false],
  ['quoted names', 'old\tname.txt', 'new\tname.txt', true],
  ['Unicode names', 'alt-ä.txt', 'neu-ö.txt', false],
] as const)('restores names, bytes and modes after %s', (kind, oldName, newName, edited) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-invert-metadata-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  git('config', 'core.fileMode', 'true');
  const before = 'first unchanged line\nsecond unchanged line\nthird unchanged line\nfourth unchanged line\n';
  writeFileSync(join(cwd, oldName), before, { mode: 0o644 });
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  if (kind === 'mode only') chmodSync(join(cwd, oldName), 0o755);
  else renameSync(join(cwd, oldName), join(cwd, newName));
  if (edited) writeFileSync(join(cwd, newName), before + 'additional line\n');
  git('add', '--all');
  const patch = git('diff', '--cached', '--find-renames', '--binary');
  expect(patch).toContain(kind === 'mode only' ? 'old mode 100644' : 'rename from ');
  expect(parsePatch(patch)[0].path).toBe(newName);
  const inverse = invertPatch(patch);
  expect(parsePatch(inverse)[0].path).toBe(oldName);
  expect(invertPatch(inverse)).toBe(patch);
  execFileSync('git', ['apply', '--check', '-'], { cwd, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync('git', ['apply', '-'], { cwd, input: inverse, stdio: ['pipe', 'pipe', 'pipe'] });
  expect(readFileSync(join(cwd, oldName), 'utf8')).toBe(before);
  expect(statSync(join(cwd, oldName)).mode & 0o777).toBe(0o644);
  if (oldName !== newName) expect(existsSync(join(cwd, newName))).toBe(false);
  git('add', '--all');
  expect(git('diff', '--cached', 'HEAD')).toBe('');
});
