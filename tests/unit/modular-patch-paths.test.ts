import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parsePatch, patchSummary } from '../../packages/support-worktree/src/patch-parser.js';
import { evaluateDoneEvidence } from '../../packages/mod-conquer/src/completion-policy.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const names = ['with space.txt', 'name b/inside.txt', 'tab\tname.txt', 'quote"name.txt', 'Grüezi-🦒.txt', 'back\\slash.txt'];
const cases = names.flatMap(name => ['edit', 'delete', 'mode'].map(action => ({ name, action })));

it.each(cases)('decodes the real Git path for $action: $name', ({ name, action }) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-patch-path-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  git('config', 'core.fileMode', 'true');
  git('config', 'core.quotePath', 'true');
  const path = join(cwd, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'before\n', { mode: 0o644 });
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  if (action === 'delete') unlinkSync(path);
  else if (action === 'mode') chmodSync(path, 0o755);
  else writeFileSync(path, 'after\n');
  const patch = git('diff');
  expect(patch).not.toBe('');
  const files = parsePatch(patch);
  expect(files).toHaveLength(1);
  expect(files[0].path).toBe(name);
  expect(files[0].additions).toBe(action === 'edit' ? 1 : 0);
  expect(files[0].deletions).toBe(action === 'mode' ? 0 : 1);
});

it('renders control characters in filenames as visible escapes', () => {
  const summary = patchSummary([{ path: 'line\n\x1b[31m\x9bname', hunks: [], additions: 0, deletions: 0 }]);
  expect(summary).not.toContain('\x1b');
  expect(summary).not.toContain('\x9b');
  expect(summary.split('\n')).toHaveLength(2);
  expect(summary).toContain('\\n');
  expect(summary).toContain('\\u001b');
});

it.each([
  { name: 'guard.test.ts', operation: 'rename', blocked: true },
  { name: 'tests/with space.ts', operation: 'rename', blocked: true },
  { name: 'tests/tab\tquoted.ts', operation: 'rename', blocked: true },
  { name: 'tests/Grüezi-🦒.ts', operation: 'rename-edit', blocked: true },
  { name: 'source.ts', operation: 'rename', blocked: false },
  { name: 'guard.test.ts', operation: 'copy', blocked: false },
])('preserves test protection for $operation of $name', ({ name, operation, blocked }) => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-patch-rename-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  git('config', 'core.quotePath', 'true');
  mkdirSync(dirname(join(cwd, name)), { recursive: true });
  const before = Array.from({ length: 20 }, (_, index) => `assertion ${index}\n`).join('');
  writeFileSync(join(cwd, name), before);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const destination = 'implementation.ts';
  if (operation === 'copy') copyFileSync(join(cwd, name), join(cwd, destination));
  else renameSync(join(cwd, name), join(cwd, destination));
  if (operation === 'rename-edit') writeFileSync(join(cwd, destination), before + 'changed\n');
  git('add', '--all');
  const patch = git('diff', '--cached', '--find-renames', '--find-copies-harder');
  expect(patch).toContain(operation === 'copy' ? 'copy from ' : 'rename from ');
  const files = parsePatch(patch);
  expect(files).toHaveLength(1);
  expect(files[0].path).toBe(destination);
  expect(files[0].renamedFrom).toBe(operation === 'copy' ? undefined : name);
  expect(evaluateDoneEvidence({ diff: patch, gateOk: true, oracleTampered: false,
    claim: 'feature works', neroFalsified: false }).passed).toBe(!blocked);
});

it.each(['"b/unterminated', '"b/bad\\q"', '"b/bad\\777"', '"b/inner"quote"', '"b/trailing\\"', '"b/bad\\377"'])
('rejects a malformed quoted file header %s', path => {
  expect(() => parsePatch(`diff --git a/file b/file\n--- a/file\n+++ ${path}\n`)).toThrow();
});
