import { mkdtemp, readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { DurableHostError } from '../../packages/mod-kernel/src/host-errors.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { hostLock } from '../helpers/modular-host.js';
import { makeTreeRemovable } from '../../packages/mod-kernel/src/removable-tree.js';

describe('durable generation rollback', () => {
  it.each(['none', 'preflight', 'setup', 'before-pointer', 'after-pointer'] as const)(
    'preserves rollback state and reports writer cleanup errors after %s failure', async failurePhase => {
      for (const cleanupPhase of ['none', 'remove', 'sync'] as const) {
        const root = await mkdtemp(join(tmpdir(), 'agon-rollback-cleanup-'));
        try {
          const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
          await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: { packages: ['old'] } });
          await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: { packages: ['new'] } });
          const operationFailure = failurePhase === 'preflight'
            ? new DurableHostError('MOD_GENERATION_CORRUPT', 'fixture rollback preflight')
            : new Error(`fixture rollback ${failurePhase}`);
          const cleanupFailure = new Error(`fixture release ${cleanupPhase}`);
          let removed = false;
          let clockReads = 0;
          const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
            readFile: async path => {
              if (failurePhase === 'preflight' && path === join(host.generationPath(1), 'generation.json')) throw operationFailure;
              return nodeHostIo.readFile(path);
            },
            rename: async (from, to) => {
              if (failurePhase === 'before-pointer' && to === host.paths.current) throw operationFailure;
              await nodeHostIo.rename(from, to);
            },
            rm: async (path, options) => {
              if (path === host.paths.writerLock && cleanupPhase === 'remove') throw cleanupFailure;
              await nodeHostIo.rm(path, options);
              if (path === host.paths.writerLock) removed = true;
            },
            syncDirectory: async path => {
              if (removed && path === dirname(host.paths.writerLock) && cleanupPhase === 'sync') throw cleanupFailure;
              await nodeHostIo.syncDirectory(path);
            },
          } });
          const failure = await rollbackGeneration(failing, 1, {
            now: () => {
              if (++clockReads === 2 && failurePhase === 'setup') throw operationFailure;
              return new Date();
            },
            faultAfterPointer: () => { if (failurePhase === 'after-pointer') throw operationFailure; },
          }).then(() => undefined, error => error);
          if (cleanupPhase !== 'none') {
            if (failurePhase === 'none') expect(failure).toBe(cleanupFailure);
            else {
              expect(failure).toBeInstanceOf(AggregateError);
              if (failurePhase === 'after-pointer') {
                expect(failure.errors).toHaveLength(2);
                expect(failure.errors[0]).toMatchObject({ code: 'MOD_RESTART_REQUIRED', cause: operationFailure,
                  details: { targetGeneration: 1, transactionId: expect.any(String) } });
                expect(failure.errors[1]).toBe(cleanupFailure);
              } else expect(failure.errors).toEqual([operationFailure, cleanupFailure]);
            }
          } else if (failurePhase === 'after-pointer') {
            expect(failure).toMatchObject({ code: 'MOD_RESTART_REQUIRED', cause: operationFailure });
          } else expect(failure).toBe(failurePhase === 'none' ? undefined : operationFailure);
          if (cleanupPhase === 'remove') await expect(readFile(host.paths.writerLock)).resolves.toBeDefined();
          else await expect(readFile(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
          const selected = failurePhase === 'none' || failurePhase === 'after-pointer' ? 1 : 2;
          expect((await host.readCurrentPointer())?.generation).toBe(selected);
          const snapshot = failurePhase === 'none' ? 'old' : 'new';
          expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: snapshot });
          expect(JSON.parse(await readFile(host.paths.installedIndex, 'utf8'))).toEqual({ packages: [snapshot] });
          await expect(host.validateGeneration(1)).resolves.toBeDefined();
          await expect(host.validateGeneration(2)).resolves.toBeDefined();
          if (failurePhase === 'after-pointer') {
            const reported = cleanupPhase === 'none' ? failure : failure.errors[0];
            expect(Object.getOwnPropertyDescriptor(reported, 'cause')?.enumerable).toBe(false);
          }
        } finally {
          await makeTreeRemovable(nodeHostIo, root);
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  );

  it('does not reuse a journaled generation after its directory is retired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-retired-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const second = await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
    await rollbackGeneration(host, 1);
    const retiredJournal = await readFile(host.journalPath(second.journal.transactionId));
    // Model future GC only inside this owned fixture. Keep durable evidence.
    await makeTreeRemovable(nodeHostIo, host.generationPath(2));
    await rm(host.generationPath(2), { recursive: true });
    const next = await host.commitGeneration({ operation: 'update', lock: hostLock('c'), desiredState: {}, installedIndex: {} });
    expect(next.pointer.generation).toBe(3);
    expect(await readFile(host.journalPath(second.journal.transactionId))).toEqual(retiredJournal);
    expect((await host.boot()).pointer?.generation).toBe(3);
  });

  it('refuses allocation when a retained journal cannot establish historical identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-corrupt-history-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const first = await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const pointer = await readFile(host.paths.current);
    await writeFile(host.journalPath(first.journal.transactionId), '{broken');
    await expect(host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} }))
      .rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(await readFile(host.paths.current)).toEqual(pointer);
    expect(await readdir(host.paths.generations)).toEqual(['0000000000000001']);
    expect(await readFile(host.journalPath(first.journal.transactionId), 'utf8')).toBe('{broken');
  });

  it.each(['9007199254740991', '9007199254740992'])('refuses generation exhaustion at %s without changing selection', async number => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-limit-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const pointer = await readFile(host.paths.current);
    await mkdir(join(host.paths.generations, number));
    await expect(host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} })).rejects.toMatchObject({
      code: number === '9007199254740991' ? 'MOD_TRANSACTION_FAILED' : 'MOD_GENERATION_CORRUPT',
    });
    expect(await readFile(host.paths.current)).toEqual(pointer);
    expect(await readdir(join(host.paths.generations, number))).toEqual([]);
  });

  it('allocates above retained generations after rollback and preserves old bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-reentry-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: {} });
    const previousManifest = await readFile(join(host.generationPath(2), 'generation.json'));
    await rollbackGeneration(host, 1);
    // A higher incomplete entry must not be overwritten or reused either.
    await mkdir(host.generationPath(7));
    const result = await host.commitGeneration({ operation: 'update', expectedBaseGeneration: 1, lock: hostLock('c'), desiredState: { profile: 'reentered' }, installedIndex: {} });
    expect(result.pointer.generation).toBe(8);
    expect(result.journal.baseGeneration).toBe(1);
    expect(await readFile(join(host.generationPath(2), 'generation.json'))).toEqual(previousManifest);
    expect(await readdir(host.generationPath(7))).toEqual([]);
    expect((await host.boot()).pointer?.generation).toBe(8);
    await rollbackGeneration(host, 2);
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'new' });
    await expect(host.commitGeneration({ operation: 'update', expectedBaseGeneration: 1, lock: hostLock('d'), desiredState: {}, installedIndex: {} })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
  });

  it.each([false, true])('does not delete a rollback target after an uncommitted attempt (retried=%s)', async retried => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-target-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: {} });
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rename: async (from, to) => {
        if (to === host.paths.current) throw Object.assign(new Error('fixture before rename'), { code: 'EIO' });
        await nodeHostIo.rename(from, to);
      },
    } });
    await expect(rollbackGeneration(failing, 1)).rejects.toThrow('fixture before rename');
    if (retried) await rollbackGeneration(host, 1);
    const boot = await host.boot();
    expect(boot.mode).toBe('normal');
    expect(boot.pointer?.generation).toBe(retried ? 1 : 2);
    expect(await readdir(host.paths.generations)).toHaveLength(2);
    await expect(host.validateGeneration(1)).resolves.toBeDefined();
    expect((await host.boot()).mode).toBe('normal');
  });

  it.each([false, true])('recovers a renamed rollback pointer after sync failure (unreadable=%s)', async unreadable => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-sync-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: { packages: ['old'] } });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: { packages: ['new'] } });
    let renamed = false;
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rename: async (from, to) => { await nodeHostIo.rename(from, to); if (to === host.paths.current) renamed = true; },
      syncDirectory: async path => {
        if (renamed && path === root) throw Object.assign(new Error('fixture sync failure'), { code: 'EIO' });
        await nodeHostIo.syncDirectory(path);
      },
      readFile: async path => {
        if (renamed && unreadable && path === host.paths.current) throw Object.assign(new Error('fixture read failure'), { code: 'EACCES' });
        return nodeHostIo.readFile(path);
      },
    } });
    await expect(rollbackGeneration(failing, 1)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await host.boot()).pointer?.generation).toBe(1);
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'old' });
    expect(JSON.parse(await readFile(host.paths.installedIndex, 'utf8'))).toEqual({ packages: ['old'] });
  });

  it.each([false, true])('preserves ambiguous rollback context with cleanup failure (unreadable=%s)', async unreadable => {
    for (const cleanupPhase of ['remove', 'sync'] as const) {
      const root = await mkdtemp(join(tmpdir(), 'agon-rollback-context-'));
      try {
        const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
        await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
        await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
        const publishError = new Error('fixture pointer sync');
        const cleanupError = new Error('fixture cleanup');
        let renamed = false;
        let removed = false;
        const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
          rename: async (from, to) => { await nodeHostIo.rename(from, to); if (to === host.paths.current) renamed = true; },
          syncDirectory: async path => {
            if (renamed && path === root) throw publishError;
            if (removed && path === dirname(host.paths.writerLock)) throw cleanupError;
            await nodeHostIo.syncDirectory(path);
          },
          readFile: async path => {
            if (renamed && unreadable && path === host.paths.current) throw new Error('fixture pointer unreadable');
            return nodeHostIo.readFile(path);
          },
          rm: async (path, options) => {
            if (path === host.paths.writerLock && cleanupPhase === 'remove') throw cleanupError;
            await nodeHostIo.rm(path, options);
            if (path === host.paths.writerLock) removed = true;
          },
        } });
        const failure = await rollbackGeneration(failing, 1).then(() => undefined, error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.errors).toHaveLength(2);
        expect(failure.errors[0]).toMatchObject({ code: 'MOD_RESTART_REQUIRED', cause: publishError,
          details: { targetGeneration: 1, transactionId: expect.any(String), ...(unreadable ? { outcome: 'unknown' } : {}) } });
        expect(Object.getOwnPropertyDescriptor(failure.errors[0], 'cause')?.enumerable).toBe(false);
        expect(failure.errors[1]).toBe(cleanupError);
        expect((await host.readCurrentPointer())?.generation).toBe(1);
        if (cleanupPhase === 'remove') await expect(readFile(host.paths.writerLock)).resolves.toBeDefined();
        else expect((await host.boot()).pointer?.generation).toBe(1);
      } finally {
        await makeTreeRemovable(nodeHostIo, root);
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('repairs partial snapshot restoration on boot and supports re-entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-partial-'));
    try {
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: { packages: ['old'] } });
      await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: { packages: ['new'] } });
      const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
        rename: async (from, to) => {
          if (to === host.paths.desiredState) throw new Error('fixture snapshot failure');
          await nodeHostIo.rename(from, to);
        },
      } });
      await expect(rollbackGeneration(failing, 1)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
      expect(JSON.parse(await readFile(host.paths.installedIndex, 'utf8'))).toEqual({ packages: ['old'] });
      expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'new' });
      const boot = await host.boot();
      expect(boot.mode).toBe('normal');
      expect(boot.pointer?.generation).toBe(1);
      expect(boot.recoveredTransactions).toHaveLength(1);
      expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'old' });
      const next = await host.commitGeneration({ operation: 'update', lock: hostLock('c'), desiredState: {}, installedIndex: {} });
      expect(next.pointer.generation).toBe(3);
    } finally {
      await makeTreeRemovable(nodeHostIo, root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never releases a replacement writer after losing rollback ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-fence-'));
    try {
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
      await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
      let replacement = '';
      await expect(rollbackGeneration(host, 1, { faultAfterPointer: async () => {
        const record = JSON.parse(await readFile(host.paths.writerLock, 'utf8'));
        replacement = JSON.stringify({ ...record, fenceToken: 'replacement-owner' });
        await writeFile(host.paths.writerLock, replacement);
      } })).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
      expect(await readFile(host.paths.writerLock, 'utf8')).toBe(replacement);
      expect((await host.readCurrentPointer())?.generation).toBe(1);
    } finally {
      await makeTreeRemovable(nodeHostIo, root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['absent', 'malformed', 'already-selected'] as const)('releases the writer after %s preflight under either recovery policy', async state => {
    for (const allowInvalidCurrent of [false, true]) {
      const root = await mkdtemp(join(tmpdir(), 'agon-rollback-preflight-'));
      try {
        const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
        await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
        if (state === 'absent') await rm(host.paths.current);
        if (state === 'malformed') await writeFile(host.paths.current, '{broken');
        const original = await readFile(host.paths.current).catch(() => null);
        const journals = await readdir(host.paths.transactions);
        const receipts = await readdir(host.paths.receipts);
        const succeeds = allowInvalidCurrent && state !== 'already-selected';
        const attempt = rollbackGeneration(host, 1, { allowInvalidCurrent });
        if (succeeds) {
          await expect(attempt).resolves.toMatchObject({ pointer: { generation: 1 } });
          expect((await host.boot()).mode).toBe('normal');
        } else {
          await expect(attempt).rejects.toBeInstanceOf(DurableHostError);
          expect(await readFile(host.paths.current).catch(() => null)).toEqual(original);
          expect(await readdir(host.paths.transactions)).toEqual(journals);
          expect(await readdir(host.paths.receipts)).toEqual(receipts);
        }
        await expect(readFile(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await makeTreeRemovable(nodeHostIo, root);
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('selects a verified prior generation and restores its exact desired/index snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: { packages: ['old'] } });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: { packages: ['new'] } });
    const result = await rollbackGeneration(host, 1, { processIdentity: 'rollback-test' });
    expect(result.pointer.generation).toBe(1);
    expect(result.journal.operation).toBe('rollback');
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'old' });
    expect(JSON.parse(await readFile(host.paths.installedIndex, 'utf8'))).toEqual({ packages: ['old'] });
    const boot = await host.boot();
    expect(boot.mode).toBe('normal');
    expect(boot.recoveredTransactions).toEqual([]);
  });

  it('reports restart-required when the pointer commits before snapshot restoration fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-rollback-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
    await expect(rollbackGeneration(host, 1, { faultAfterPointer: () => { throw new Error('power loss'); } })).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
