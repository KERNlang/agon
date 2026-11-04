import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyPatchWithUndo, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const roots: string[] = [];
const fault = vi.hoisted(() => ({ source: '' }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    fs.writeFileSync(...args);
    if (fault.source && typeof args[0] === 'number') {
      fs.writeFileSync(fault.source, 'concurrent source edit\n');
      fault.source = '';
    }
  } };
});
afterEach(() => {
  fault.source = '';
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['unchanged', 'edited', 'binary', 'invalid UTF-8 bytes', 'quoted path', 'source edited', 'multiple copies', 'source removed', 'destination edited', 'source changes during record write', 'undo nested scope'] as const)(
  'Apply and Undo restore exact state for a %s copy without changing the real index', kind => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-copy-undo-'));
    const undoDir = mkdtempSync(join(tmpdir(), 'agon-copy-records-'));
    roots.push(cwd, undoDir);
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    git('init', '--quiet');
    const source = kind === 'quoted path' ? 'source\tö.txt' : 'source.txt';
    const destination = kind === 'quoted path' ? 'copy\tü.txt' : 'copy.txt';
    const before = kind === 'binary'
      ? Buffer.from([0, 1, 2, 3, 255, 128, 64])
      : kind === 'invalid UTF-8 bytes' ? Buffer.from([0x61, 0xff, 0x0a])
      : Buffer.from('first unchanged line\nsecond unchanged line\nthird unchanged line\n');
    const copied = kind === 'edited' ? Buffer.concat([before, Buffer.from('new line\n')]) : before;
    writeFileSync(join(cwd, source), before);
    git('add', '--all');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    writeFileSync(join(cwd, destination), copied);
    const afterSource = kind === 'source edited' ? Buffer.concat([before, Buffer.from('source change\n')]) : before;
    writeFileSync(join(cwd, source), afterSource);
    if (kind === 'multiple copies') writeFileSync(join(cwd, 'second-copy.txt'), copied);
    git('add', '--all');
    const patch = git('diff', '--cached', '--find-copies-harder', '--binary');
    expect(patch).toContain('copy from ');
    // Restore only this test's index and newly created destination.
    git('read-tree', 'HEAD');
    unlinkSync(join(cwd, destination));
    writeFileSync(join(cwd, source), before);
    if (kind === 'multiple copies') unlinkSync(join(cwd, 'second-copy.txt'));
    const index = readFileSync(join(cwd, '.git', 'index'));
    if (kind === 'source changes during record write') fault.source = join(cwd, source);
    const applied = applyPatchWithUndo(cwd, patch, undoDir);
    if (kind === 'source changes during record write') {
      expect(applied.ok).toBe(false);
      expect(applied.error).toContain('Copy source changed during preparation');
      expect(applied.undoToken).toBeUndefined();
      expect(readFileSync(join(cwd, source), 'utf8')).toBe('concurrent source edit\n');
      expect(existsSync(join(cwd, destination))).toBe(false);
      expect(readdirSync(undoDir)).toEqual([]);
      expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
      return;
    }
    expect(applied.ok, applied.error).toBe(true);
    expect(applied.undoToken).toBeTruthy();
    expect(readFileSync(join(cwd, source))).toEqual(afterSource);
    expect(readFileSync(join(cwd, destination))).toEqual(copied);
    expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
    if (kind === 'source removed') unlinkSync(join(cwd, source));
    if (kind === 'destination edited') writeFileSync(join(cwd, destination), 'operator edit\n');
    if (kind === 'undo nested scope') mkdirSync(join(cwd, 'nested'));
    const undone = undoPatch(kind === 'undo nested scope' ? join(cwd, 'nested') : cwd, applied.undoToken!, undoDir);
    if (kind === 'destination edited') {
      expect(undone.ok).toBe(false);
      expect(readFileSync(join(cwd, destination), 'utf8')).toBe('operator edit\n');
      expect(readFileSync(join(cwd, source))).toEqual(before);
      expect(existsSync(join(undoDir, `${applied.undoToken}.patch`))).toBe(true);
      expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
      return;
    }
    expect(undone.ok, undone.error).toBe(true);
    if (kind === 'source removed') expect(existsSync(join(cwd, source))).toBe(false);
    else expect(readFileSync(join(cwd, source))).toEqual(before);
    expect(existsSync(join(cwd, destination))).toBe(false);
    expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
    expect(existsSync(join(undoDir, `${applied.undoToken}.patch`))).toBe(false);
    expect(existsSync(join(cwd, 'second-copy.txt'))).toBe(false);
    if (kind !== 'source removed') expect(git('status', '--porcelain')).toBe('');
  },
);

it.each(['empty', 'executable', 'symlink', 'nested cwd'] as const)('preserves %s copy semantics', kind => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-copy-types-'));
  const undoDir = mkdtempSync(join(tmpdir(), 'agon-copy-type-records-'));
  roots.push(cwd, undoDir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--quiet');
  git('config', 'core.fileMode', 'true');
  const directory = join(cwd, 'nested');
  mkdirSync(directory);
  const source = join(directory, 'source');
  const destination = join(directory, 'copy');
  writeFileSync(join(directory, 'target'), 'sentinel\n');
  const bytes = kind === 'empty' ? '' : 'file contents\n';
  if (kind === 'symlink') symlinkSync('target', source);
  else writeFileSync(source, bytes);
  if (kind === 'executable') chmodSync(source, 0o755);
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  if (kind === 'symlink') symlinkSync('target', destination);
  else writeFileSync(destination, bytes);
  if (kind === 'executable') chmodSync(destination, 0o755);
  git('add', '--all');
  const patch = git('diff', '--cached', '--find-copies-harder', '--rename-empty', '--binary');
  expect(patch).toContain('copy from ');
  git('read-tree', 'HEAD');
  unlinkSync(destination);
  const index = readFileSync(join(cwd, '.git', 'index'));
  const invocationCwd = kind === 'nested cwd' ? directory : cwd;
  const applied = applyPatchWithUndo(invocationCwd, patch, undoDir);
  expect(applied.ok, applied.error).toBe(true);
  if (kind === 'symlink') {
    expect(lstatSync(destination).isSymbolicLink()).toBe(true);
    expect(readlinkSync(destination)).toBe('target');
  } else {
    expect(readFileSync(destination, 'utf8')).toBe(bytes);
    if (kind === 'executable') expect(lstatSync(destination).mode & 0o777).toBe(0o755);
  }
  const undone = undoPatch(invocationCwd, applied.undoToken!, undoDir);
  expect(undone.ok, undone.error).toBe(true);
  expect(existsSync(destination)).toBe(false);
  expect(readFileSync(join(directory, 'target'), 'utf8')).toBe('sentinel\n');
  expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
  expect(git('status', '--porcelain')).toBe('');
});

it.each(['missing source', 'existing destination', 'traversal', 'malformed destination'] as const)(
  'refuses %s before target mutation or undo publication', kind => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-copy-refusal-'));
    const undoDir = mkdtempSync(join(tmpdir(), 'agon-copy-refusal-records-'));
    roots.push(cwd, undoDir);
    execFileSync('git', ['init', '--quiet'], { cwd });
    writeFileSync(join(cwd, 'source'), 'source bytes\n');
    if (kind === 'missing source') unlinkSync(join(cwd, 'source'));
    if (kind === 'existing destination') writeFileSync(join(cwd, 'copy'), 'keep destination\n');
    const destination = kind === 'traversal' ? '../escaped' : 'copy';
    const patch = `diff --git a/source b/${destination}\nsimilarity index 100%\ncopy from source\n`
      + (kind === 'malformed destination' ? '' : `copy to ${destination}\n`);
    const result = applyPatchWithUndo(cwd, patch, undoDir);
    expect(result.ok).toBe(false);
    expect(result.undoToken).toBeUndefined();
    expect(readdirSync(undoDir)).toEqual([]);
    if (kind !== 'missing source') expect(readFileSync(join(cwd, 'source'), 'utf8')).toBe('source bytes\n');
    if (kind === 'existing destination') expect(readFileSync(join(cwd, 'copy'), 'utf8')).toBe('keep destination\n');
    else expect(existsSync(join(cwd, 'copy'))).toBe(false);
  },
);
