import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const probe = vi.hoisted(() => ({ descriptors: new Set<number>(), failRead: false }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      if (String(args[0]).endsWith('.patch')) probe.descriptors.add(fd);
      return fd;
    },
    closeSync: (fd: number) => { fs.closeSync(fd); probe.descriptors.delete(fd); },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (probe.failRead && typeof args[0] === 'number' && probe.descriptors.has(args[0])) {
        throw Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
      }
      return fs.readFileSync(...args);
    },
  };
});

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agon-undo-read-'));
  roots.push(root);
  return { root, path: join(root, 'record.patch') };
}
afterEach(async () => {
  // A failed leak assertion must not leave descriptors in the test process.
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  for (const fd of probe.descriptors) fs.closeSync(fd);
  probe.descriptors.clear();
  probe.failRead = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('distinguishes a missing undo record', () => {
  const { root } = fixture();
  expect(undoPatch(root, 'record', root)).toEqual({ ok: false, error: 'Undo token not found: record' });
  expect(probe.descriptors.size).toBe(0);
});

it('rejects a directory before reading it and closes the descriptor', () => {
  const { root, path } = fixture();
  mkdirSync(path);
  for (let attempt = 0; attempt < 20; attempt++) {
    expect(undoPatch(root, 'record', root)).toMatchObject({ ok: false, error: expect.stringContaining('not a regular file') });
    expect(probe.descriptors.size).toBe(0);
  }
});

it('reports a symlink refusal without opening its target', () => {
  const { root, path } = fixture();
  const target = join(root, 'target');
  writeFileSync(target, 'not a patch');
  symlinkSync(target, path);
  expect(undoPatch(root, 'record', root)).toMatchObject({ ok: false, error: expect.stringContaining('symbolic link') });
  expect(probe.descriptors.size).toBe(0);
});

it('preserves the read failure reason and closes the descriptor', () => {
  const { root, path } = fixture();
  writeFileSync(path, 'not a patch');
  probe.failRead = true;
  for (let attempt = 0; attempt < 20; attempt++) {
    expect(undoPatch(root, 'record', root)).toMatchObject({ ok: false, error: expect.stringContaining('fixture read denied') });
    expect(probe.descriptors.size).toBe(0);
  }
});
