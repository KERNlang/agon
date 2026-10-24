import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPatchWithUndo, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const fault = vi.hoisted(() => ({ directory: '', uuid: '', descriptors: new Set<number>() }));
vi.mock('node:crypto', async importOriginal => {
  const crypto = await importOriginal<typeof import('node:crypto')>();
  return { ...crypto, randomUUID: () => fault.uuid || crypto.randomUUID() };
});
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const descriptor = fs.openSync(...args);
      if (fault.directory && String(args[0]).startsWith(`${fault.directory}/`)) fault.descriptors.add(descriptor);
      return descriptor;
    },
    closeSync: (descriptor: number) => {
      fault.descriptors.delete(descriptor);
      return fs.closeSync(descriptor);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const isUndoDescriptor = typeof args[0] === 'number' && fault.descriptors.has(args[0]);
      if (fault.directory && (isUndoDescriptor || String(args[0]).startsWith(`${fault.directory}/`))) {
        throw Object.assign(new Error('fixture: undo storage refused'), { code: 'EACCES' });
      }
      return fs.writeFileSync(...args);
    },
  };
});

const roots: string[] = [];
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-undo-publication-'));
  roots.push(cwd);
  execFileSync('git', ['init', '--quiet', cwd]);
  writeFileSync(join(cwd, 'file.txt'), 'before\n');
  return { cwd, undoDir: join(cwd, 'undo') };
}
function patch(before: string, after: string) {
  return `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}
afterEach(() => {
  fault.directory = '';
  fault.uuid = '';
  fault.descriptors.clear();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('undo publication before mutation', () => {
  it('keeps independent undo records when operations share a clock tick', () => {
    const { cwd, undoDir } = fixture();
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const first = applyPatchWithUndo(cwd, patch('before', 'middle'), undoDir);
    const second = applyPatchWithUndo(cwd, patch('middle', 'after'), undoDir);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.undoToken).not.toBe(second.undoToken);
    expect(undoPatch(cwd, second.undoToken!, undoDir)).toEqual({ ok: true });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('middle\n');
    expect(undoPatch(cwd, first.undoToken!, undoDir)).toEqual({ ok: true });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });

  it('leaves workspace bytes unchanged when undo storage refuses the record', () => {
    const { cwd, undoDir } = fixture();
    fault.directory = undoDir;
    let outcome: ReturnType<typeof applyPatchWithUndo> | undefined;
    let failure: unknown;
    try { outcome = applyPatchWithUndo(cwd, patch('before', 'after'), undoDir); }
    catch (error) { failure = error; }
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
    expect(failure).toBeUndefined();
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('undo') });
    expect(fault.descriptors.size).toBe(0);
    expect(readdirSync(undoDir)).toEqual([]);
  });

  it('refuses an identifier collision without overwriting the previous record', () => {
    const { cwd, undoDir } = fixture();
    fault.uuid = '11111111-1111-4111-8111-111111111111';
    const first = applyPatchWithUndo(cwd, patch('before', 'middle'), undoDir);
    expect(first.ok).toBe(true);
    const recordPath = join(undoDir, `${first.undoToken}.patch`);
    const saved = readFileSync(recordPath);
    const second = applyPatchWithUndo(cwd, patch('middle', 'after'), undoDir);
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining('no patch applied') });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('middle\n');
    expect(readFileSync(recordPath)).toEqual(saved);
    expect(undoPatch(cwd, first.undoToken!, undoDir)).toEqual({ ok: true });
  });

  it('does not retain an undo record for a refused patch', () => {
    const { cwd, undoDir } = fixture();
    expect(applyPatchWithUndo(cwd, patch('wrong', 'after'), undoDir).ok).toBe(false);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
    expect(readdirSync(undoDir)).toEqual([]);
  });
});
