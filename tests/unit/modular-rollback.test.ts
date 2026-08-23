import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { hostLock } from '../helpers/modular-host.js';

describe('durable generation rollback', () => {
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
