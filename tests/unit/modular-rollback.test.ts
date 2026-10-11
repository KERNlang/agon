import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { hostLock } from '../helpers/modular-host.js';

describe('durable generation rollback', () => {
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
