import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyPatchWithUndo, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const fault = vi.hoisted(() => ({ unlink: '', removed: false, syncsAfterRemoval: 0, failSync: false, failFileSync: false }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, unlinkSync: (path: Parameters<typeof fs.unlinkSync>[0]) => {
    if (String(path) === fault.unlink) throw Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' });
    fs.unlinkSync(path);
    fault.removed = true;
  }, fsyncSync: (fd: number) => {
    if (fault.failFileSync && fs.fstatSync(fd).isFile()) throw new Error('fixture record sync denied');
    if (fault.removed && fs.fstatSync(fd).isDirectory()) {
      fault.syncsAfterRemoval++;
      if (fault.failSync) throw Object.assign(new Error('fixture retirement sync denied'), { code: 'EIO' });
    }
    fs.fsyncSync(fd);
  } };
});
const roots: string[] = [];
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-undo-lifecycle-'));
  roots.push(cwd);
  execFileSync('git', ['init', '--quiet', cwd]);
  const file = join(cwd, 'file.txt');
  writeFileSync(file, 'before\n');
  const undoDir = join(cwd, 'undo');
  const result = applyPatchWithUndo(cwd, 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n', undoDir);
  expect(result.ok).toBe(true);
  return { cwd, file, undoDir, token: result.undoToken!, record: join(undoDir, `${result.undoToken}.patch`) };
}
afterEach(() => {
  fault.unlink = '';
  fault.removed = false; fault.syncsAfterRemoval = 0; fault.failSync = false; fault.failFileSync = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('removes only the consumed record after successful undo', () => {
  const { cwd, file, undoDir, token, record } = fixture();
  const unrelated = join(undoDir, 'other.patch');
  writeFileSync(unrelated, 'retain');
  expect(undoPatch(cwd, token, undoDir)).toEqual({ ok: true });
  expect(readFileSync(file, 'utf8')).toBe('before\n');
  expect(existsSync(record)).toBe(false);
  expect(readFileSync(unrelated, 'utf8')).toBe('retain');
  expect(fault.syncsAfterRemoval).toBe(1);
});

it('reports completed reversal but uncertain retirement when directory sync fails', () => {
  const { cwd, file, undoDir, token, record } = fixture();
  fault.failSync = true;
  expect(undoPatch(cwd, token, undoDir)).toMatchObject({ ok: true, warning: expect.stringContaining('fixture retirement sync denied') });
  expect(readFileSync(file, 'utf8')).toBe('before\n');
  expect(existsSync(record)).toBe(false);
});

it.each(['Git apply', 'record sync'])('durably removes the unused record after %s failure', failure => {
  const { cwd, file, undoDir, token } = fixture();
  fault.failFileSync = failure === 'record sync';
  const oldLine = failure === 'Git apply' ? 'wrong preimage' : 'after';
  const patch = `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-${oldLine}\n+next\n`;
  const result = applyPatchWithUndo(cwd, patch, undoDir);
  expect(result.ok).toBe(false);
  expect(result.undoToken).toBeUndefined();
  expect(readFileSync(file, 'utf8')).toBe('after\n');
  expect(readdirSync(undoDir)).toEqual([`${token}.patch`]);
  expect(fault.syncsAfterRemoval).toBe(1);
});

it('retains the record and workspace when undo cannot apply', () => {
  const { cwd, file, undoDir, token, record } = fixture();
  const bytes = readFileSync(record);
  writeFileSync(file, 'operator edit\n');
  expect(undoPatch(cwd, token, undoDir).ok).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe('operator edit\n');
  expect(readFileSync(record)).toEqual(bytes);
});

it('reports successful reversal with a cleanup warning rather than a retryable failure', () => {
  const { cwd, file, undoDir, token, record } = fixture();
  fault.unlink = record;
  expect(undoPatch(cwd, token, undoDir)).toMatchObject({ ok: true, warning: expect.stringContaining('fixture cleanup denied') });
  expect(readFileSync(file, 'utf8')).toBe('before\n');
  expect(existsSync(record)).toBe(true);
});

it('applies and reverses all repository paths when invoked from a subdirectory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-undo-root-'));
  const undoDir = mkdtempSync(join(tmpdir(), 'agon-undo-root-records-'));
  roots.push(cwd, undoDir);
  execFileSync('git', ['init', '--quiet'], { cwd });
  const nested = join(cwd, 'nested');
  mkdirSync(nested);
  for (const path of ['outside.txt', 'nested/inside.txt']) writeFileSync(join(cwd, path), 'before\n');
  const patch = ['outside.txt', 'nested/inside.txt'].map(path =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`).join('');
  const result = applyPatchWithUndo(nested, patch, undoDir);
  expect(result.ok, result.error).toBe(true);
  for (const path of ['outside.txt', 'nested/inside.txt']) expect(readFileSync(join(cwd, path), 'utf8')).toBe('after\n');
  const undone = undoPatch(nested, result.undoToken!, undoDir);
  expect(undone.ok, undone.error).toBe(true);
  for (const path of ['outside.txt', 'nested/inside.txt']) expect(readFileSync(join(cwd, path), 'utf8')).toBe('before\n');
  expect(existsSync(join(undoDir, `${result.undoToken}.patch`))).toBe(false);
});
