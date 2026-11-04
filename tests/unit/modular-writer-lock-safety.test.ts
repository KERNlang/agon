import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WriterFence, withSynchronousWriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { fsyncSync, readFileSync, writeFileSync } from 'node:fs';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { randomUUID } from 'node:crypto';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});

describe('writer liveness fails closed', () => {
  it.each(['relative', 'redundant'] as const)('recovers a stale writer with a %s path', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-path-'));
    const path = kind === 'relative' ? `./${relative(process.cwd(), root)}/writer.json` : `${root}/./writer.json`;
    await WriterFence.acquire(path, 'old', { pid: 999999 });
    const recovered = await WriterFence.recoverStale(path, 'next', { isProcessAlive: async () => false });
    await recovered.assertOwned();
    await recovered.release();
    expect(await readdir(root)).toEqual([]);
  });

  it('retains the primary refusal when recovery cleanup also fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-error-chain-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'live');
    const before = await readFile(path, 'utf8');
    const failure = Object.assign(new Error('fixture fsync failed'), { code: 'EIO' });
    const io = { ...nodeHostIo, async syncDirectory() { throw failure; } };
    try {
      const result = await WriterFence.recoverStale(path, 'next', { io }).catch(error => error);
      expect(result).toBeInstanceOf(AggregateError);
      expect(result.errors[0]).toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(result.errors[1]).toBe(failure);
      expect(await readFile(path, 'utf8')).toBe(before);
      expect(await readdir(root)).toEqual(['writer.json']);
    } finally { await owner.release(); }
  });

  it('shares overlapping releases instead of deleting a successor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-release-overlap-'));
    const path = join(root, 'writer.json');
    let successor: WriterFence | undefined;
    let successorReady!: () => void;
    const ready = new Promise<void>(resolve => { successorReady = resolve; });
    let removals = 0;
    const io = { ...nodeHostIo,
      async readFile(target: string) { return readFileSync(target); },
      async rm(...args: Parameters<typeof nodeHostIo.rm>) {
        if (++removals === 1) {
          await nodeHostIo.rm(...args);
          successor = await WriterFence.acquire(path, 'successor');
          successorReady();
        } else {
          await ready;
          await nodeHostIo.rm(...args);
        }
      },
    };
    const owner = await WriterFence.acquire(path, 'old', { io });
    try {
      await Promise.all([owner.release(), owner.release()]);
      expect(successor).toBeDefined();
      await successor!.assertOwned();
      expect(removals).toBe(1);
    } finally { await successor?.release().catch(() => undefined); }
  });

  it('refuses synchronous release while asynchronous removal is in flight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-release-mixed-'));
    const path = join(root, 'writer.json');
    let entered!: () => void;
    let resume!: () => void;
    const removing = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { resume = resolve; });
    const io = { ...nodeHostIo, async rm(...args: Parameters<typeof nodeHostIo.rm>) {
      entered();
      await hold;
      await nodeHostIo.rm(...args);
    } };
    const owner = await WriterFence.acquire(path, 'owner', { io });
    const pending = owner.release();
    await removing;
    try {
      expect(() => owner.releaseSync()).toThrow(expect.objectContaining({ code: 'MOD_HOST_BUSY' }));
      await owner.assertOwned();
    } finally {
      resume();
      await pending;
    }
  });

  it('removes its own partial recovery marker when publication fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-partial-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'old', { pid: 999999 });
    const before = await readFile(path, 'utf8');
    const failure = Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    const io = { ...nodeHostIo, async writeFile(target: string, data: string | Uint8Array, options?: { flag?: string; mode?: number }) {
      if (target.startsWith(`${path}.reclaim`)) {
        await nodeHostIo.writeFile(target, '{partial', options);
        throw failure;
      }
      await nodeHostIo.writeFile(target, data, options);
    } };
    await expect(WriterFence.recoverStale(path, 'next', { io })).rejects.toBe(failure);
    expect(await readdir(root)).toEqual(['writer.json']);
    expect(await readFile(path, 'utf8')).toBe(before);
    await owner.release();
  });

  it.each(['async', 'sync'] as const)('refuses %s admission under a live or unknown recovery marker', async mode => {
    for (const suffix of ['', `.${process.pid}.${randomUUID()}`, '.malformed']) {
      const root = await mkdtemp(join(tmpdir(), 'agon-live-reclaim-'));
      const path = join(root, 'writer.json');
      const marker = `${path}.reclaim${suffix}`;
      await writeFile(marker, '');
      await expect(Promise.resolve().then(() => mode === 'async'
        ? WriterFence.acquire(path, 'next') : WriterFence.acquireSync(path, 'next'))).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(await readFile(marker, 'utf8')).toBe('');
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each(['async', 'sync'] as const)('removes only dead unique markers on %s admission', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'agon-dead-reclaim-'));
    const path = join(root, 'writer.json');
    const marker = `${path}.reclaim.999999.${randomUUID()}`;
    await writeFile(marker, '{partial');
    const fence = mode === 'async' ? await WriterFence.acquire(path, 'next') : WriterFence.acquireSync(path, 'next');
    try {
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      await fence.assertOwned();
    } finally { await fence.release(); }
  });

  it('backs out when recovery starts after its lock write but before admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-admission-race-'));
    const path = join(root, 'writer.json');
    const marker = `${path}.reclaim.${process.pid}.${randomUUID()}`;
    const io = { ...nodeHostIo, async syncFile(target: string) {
      await nodeHostIo.syncFile(target);
      if (target === path) await writeFile(marker, '');
    } };
    await expect(WriterFence.acquire(path, 'next', { io })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([marker.slice(root.length + 1)]);
  });

  it('fails closed when the recovery marker inventory cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-inventory-'));
    const path = join(root, 'writer.json');
    const failure = Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
    const io = { ...nodeHostIo, async readdir() { throw failure; } };
    await expect(WriterFence.acquire(path, 'next', { io })).rejects.toBe(failure);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks ownership after the last recovery marker disappears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-admission-identity-'));
    const path = join(root, 'writer.json');
    let replacement = '';
    const io = { ...nodeHostIo, async readdir() {
      replacement = JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), fenceToken: randomUUID() });
      await writeFile(path, replacement);
      return [];
    } };
    await expect(WriterFence.acquire(path, 'next', { io })).rejects.toBeInstanceOf(AggregateError);
    expect(await readFile(path, 'utf8')).toBe(replacement);
  });

  it('refuses stale recovery while a live unique reclaimer exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaim-contention-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'old', { pid: 999999 });
    const before = await readFile(path, 'utf8');
    const marker = `${path}.reclaim.${process.pid}.${randomUUID()}`;
    await writeFile(marker, '');
    const isProcessAlive = vi.fn(async () => false);
    await expect(WriterFence.recoverStale(path, 'next', { isProcessAlive })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    expect(isProcessAlive).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await readdir(root)).toHaveLength(2);
    await owner.release();
  });

  it.each(['async', 'sync', 'recovery'].flatMap(mode => [
    { name: 'empty owner', ownerId: '', options: {} },
    { name: 'empty process identity', ownerId: 'next', options: { processIdentity: '' } },
    { name: 'zero PID', ownerId: 'next', options: { pid: 0 } },
    { name: 'negative PID', ownerId: 'next', options: { pid: -1 } },
    { name: 'fractional PID', ownerId: 'next', options: { pid: 1.5 } },
  ].map(value => ({ mode, ...value }))))('refuses $mode acquisition with $name before changing a lock', async ({ mode, ownerId, options }) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-invalid-identity-'));
    const path = join(root, 'writer.json');
    const prior = mode === 'recovery' ? await WriterFence.acquire(path, 'original', { pid: 999_999 }) : undefined;
    const before = prior ? await readFile(path, 'utf8') : undefined;
    const isProcessAlive = vi.fn(async () => false);
    await expect(Promise.resolve().then(() => mode === 'async' ? WriterFence.acquire(path, ownerId, options)
      : mode === 'sync' ? WriterFence.acquireSync(path, ownerId, options)
      : WriterFence.recoverStale(path, ownerId, { ...options, isProcessAlive }))).rejects.toBeInstanceOf(TypeError);
    expect(isProcessAlive).not.toHaveBeenCalled();
    if (prior) {
      expect(await readFile(path, 'utf8')).toBe(before);
      await prior.release();
    } else await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).filter(name => name.startsWith('writer.json.reclaim'))).toEqual([]);
  });

  it.each(['{broken', 'null', '[]', '{}', '{"pid":999999}'])('preserves malformed recovery lock %s without probing its PID', async bytes => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-lock-shape-'));
    const path = join(root, 'writer.json');
    await writeFile(path, bytes);
    const isProcessAlive = vi.fn(async () => false);
    await expect(WriterFence.recoverStale(path, 'recovery', { isProcessAlive })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    expect(isProcessAlive).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe(bytes);
    expect((await readdir(root)).filter(name => name.startsWith('writer.json.reclaim'))).toEqual([]);
  });

  it('preserves the lock if the second liveness observation is alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-lock-reprobe-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'owner');
    const bytes = await readFile(path, 'utf8');
    const isProcessAlive = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(WriterFence.recoverStale(path, 'recovery', { isProcessAlive })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(await readFile(path, 'utf8')).toBe(bytes);
    await owner.release();
  });

  it.each([
    ['schemaVersion', 2], ['pid', 0], ['pid', -1], ['pid', 1.5], ['pid', '999999'],
    ['ownerId', ''], ['processIdentity', null], ['fenceToken', false],
    ['createdAt', 'invalid'], ['heartbeatAt', 42], ['unknown', true],
  ])('refuses invalid recovery field %s=%s before liveness checks', async (field, value) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-lock-field-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'owner');
    const bytes = JSON.stringify({ ...owner.record, [field as string]: value });
    await writeFile(path, bytes);
    const isProcessAlive = vi.fn(async () => false);
    await expect(WriterFence.recoverStale(path, 'recovery', { isProcessAlive })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    expect(isProcessAlive).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe(bytes);
    expect((await readdir(root)).filter(name => name.startsWith('writer.json.reclaim'))).toEqual([]);
  });

  it.each([1, 2])('preserves a replacement record written during liveness probe %s', async replacedAt => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-lock-replaced-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'owner');
    const replacement = JSON.stringify({ ...owner.record, fenceToken: randomUUID() });
    let calls = 0;
    const isProcessAlive = async () => {
      if (++calls === replacedAt) await writeFile(path, replacement);
      return false;
    };
    await expect(WriterFence.recoverStale(path, 'recovery', { isProcessAlive })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    expect(calls).toBe(replacedAt);
    expect(await readFile(path, 'utf8')).toBe(replacement);
  });

  it('retries synchronous release durability without removing a successor lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-release-sync-retry-'));
    const path = join(root, 'writer.json');
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const owner = WriterFence.acquireSync(path, 'first');
    const failure = new Error('fixture release fsync failed');
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw failure; });
    try {
      expect(() => owner.releaseSync()).toThrow(failure);
      const next = await WriterFence.acquire(path, 'next');
      try {
        owner.releaseSync();
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next.record);
      } finally { await next.release(); }
    } finally { vi.mocked(fsyncSync).mockImplementation(actual.fsyncSync); }
  });

  it('retries release directory sync without removing the next writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-release-retry-'));
    const path = join(root, 'writer.json');
    let failRelease = false;
    const failure = new Error('fixture release sync failed');
    const owner = await WriterFence.acquire(path, 'first', { io: {
      ...nodeHostIo,
      syncDirectory: async directory => {
        if (failRelease) { failRelease = false; throw failure; }
        await nodeHostIo.syncDirectory(directory);
      },
    } });
    failRelease = true;
    await expect(owner.release()).rejects.toBe(failure);
    const next = await WriterFence.acquire(path, 'next');
    try {
      await owner.release();
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next.record);
      await expect(owner.heartbeat()).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    } finally { await next.release(); }
  });

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
