import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WriterFence, withSynchronousWriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { fsyncSync, writeFileSync } from 'node:fs';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});

describe('writer liveness fails closed', () => {
  it('reports a completed action when release durability fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-release-sync-'));
    const path = join(root, 'writer.json');
    const output = join(root, 'config.json');
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    let calls = 0;
    vi.mocked(fsyncSync).mockImplementation(descriptor => {
      if (++calls === 3) throw Object.assign(new Error('release directory sync failed'), { code: 'EIO' });
      return actual.fsyncSync(descriptor);
    });
    try {
      expect(() => withSynchronousWriterFence(path, 'config', () => { writeFileSync(output, 'changed'); }))
        .toThrowError(expect.objectContaining({ code: 'MOD_RESTART_REQUIRED', details: expect.objectContaining({ outcome: 'action-completed' }) }));
      expect(await readFile(output, 'utf8')).toBe('changed');
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { vi.mocked(fsyncSync).mockImplementation(actual.fsyncSync); }
  });

  it('rejects an async callback before running it or acquiring a lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-async-callback-'));
    const path = join(root, 'writer.json');
    let called = false;
    const callback = async () => { called = true; };
    expect(() => withSynchronousWriterFence(path, 'config', callback as unknown as () => undefined)).toThrow('must be synchronous');
    expect(called).toBe(false);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([1, 2])('removes its complete record when sync acquisition fails at fsync %s', async failAt => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-sync-fsync-'));
    const path = join(root, 'writer.json');
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const failure = Object.assign(new Error('fixture fsync failed'), { code: 'EIO' });
    let calls = 0;
    vi.mocked(fsyncSync).mockImplementation(descriptor => {
      if (++calls === failAt) throw failure;
      return actual.fsyncSync(descriptor);
    });
    try {
      expect(() => WriterFence.acquireSync(path, 'config')).toThrow(failure);
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      const next = await WriterFence.acquire(path, 'next');
      await next.release();
    } finally { vi.mocked(fsyncSync).mockImplementation(actual.fsyncSync); }
  });

  it.each(['syncFile', 'syncDirectory'] as const)('removes its complete record when async acquisition fails at %s', async operation => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-async-fsync-'));
    const path = join(root, 'writer.json');
    const failure = Object.assign(new Error('fixture fsync failed'), { code: 'EIO' });
    let failed = false;
    const io = { ...nodeHostIo, [operation]: async (selected: string) => {
      if (!failed) { failed = true; throw failure; }
      await nodeHostIo[operation](selected);
    } };
    await expect(WriterFence.acquire(path, 'config', { io })).rejects.toBe(failure);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    const next = await WriterFence.acquire(path, 'next');
    await next.release();
  });

  it('retains both a write failure and ownership-loss cleanup failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-double-error-'));
    const path = join(root, 'writer.json');
    const failure = new Error('original config write failure');
    const replacement = { fenceToken: 'foreign', processIdentity: 'foreign' };
    let caught: unknown;
    try {
      withSynchronousWriterFence(path, 'config', () => {
        writeFileSync(path, JSON.stringify(replacement));
        throw failure;
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([failure, expect.objectContaining({ code: 'MOD_FENCE_LOST' })]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement);
  });

  it('uses one exclusion protocol for synchronous and asynchronous clients', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-sync-'));
    const path = join(root, 'writer.json');
    const asyncOwner = await WriterFence.acquire(path, 'async-owner');
    try {
      expect(() => WriterFence.acquireSync(path, 'sync-contender')).toThrowError(expect.objectContaining({ code: 'MOD_HOST_BUSY' }));
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(asyncOwner.record);
    } finally { await asyncOwner.release(); }
    const syncOwner = WriterFence.acquireSync(path, 'sync-owner');
    try {
      await expect(WriterFence.acquire(path, 'async-contender')).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(syncOwner.record);
    } finally { syncOwner.releaseSync(); }
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases its synchronous lock when the config write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-sync-error-'));
    const path = join(root, 'writer.json');
    const failure = new Error('fixture write failed');
    expect(() => withSynchronousWriterFence(path, 'config', () => { throw failure; })).toThrow(failure);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    const next = await WriterFence.acquire(path, 'next');
    await next.release();
  });

  it('never deletes a replacement owner when synchronous release loses its fence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-sync-replaced-'));
    const path = join(root, 'writer.json');
    const owner = WriterFence.acquireSync(path, 'config');
    const replacement = { ...owner.record, fenceToken: 'replacement-fence' };
    await writeFile(path, JSON.stringify(replacement));
    expect(() => owner.releaseSync()).toThrowError(expect.objectContaining({ code: 'MOD_FENCE_LOST' }));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement);
  });

  it('does not reclaim an old or malformed lock during synchronous acquisition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-sync-stale-'));
    const path = join(root, 'writer.json');
    for (const bytes of ['{broken', JSON.stringify({ schemaVersion: 1, pid: process.pid, heartbeatAt: '2000-01-01T00:00:00.000Z' })]) {
      await writeFile(path, bytes);
      expect(() => WriterFence.acquireSync(path, 'config')).toThrowError(expect.objectContaining({ code: 'MOD_HOST_BUSY' }));
      expect(await readFile(path, 'utf8')).toBe(bytes);
    }
  });

  it('treats an unexpected liveness error as possibly alive and refuses reclaim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-liveness-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'owner', { processIdentity: 'owner-process' });
    const kill = vi.spyOn(process, 'kill').mockImplementation((() => {
      throw Object.assign(new Error('unsupported liveness probe'), { code: 'EINVAL' });
    }) as typeof process.kill);
    try {
      await expect(WriterFence.recoverStale(path, 'recovery', { processIdentity: 'recovery-process' }))
        .rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    } finally {
      kill.mockRestore();
      await owner.release();
    }
  });
});
