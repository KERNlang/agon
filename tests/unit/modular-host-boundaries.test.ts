import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { SimulatedHostCrash } from '../../packages/mod-kernel/src/host-errors.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { hostLock } from '../helpers/modular-host.js';

describe('durable host boundary invariants', () => {
  it('finishes both top-level snapshots after process death behind the commit point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-snapshots-'));
    const stable = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable' });
    await stable.commitGeneration({
      operation: 'install', lock: hostLock('a'), desiredState: { version: 1 }, installedIndex: { version: 1 },
    });
    const crashed = new DurableModHost(root, {
      kernelVersion: '1.0.0', processIdentity: 'crashed',
      fault: (point) => { if (point === 'after-journal-committed') throw new SimulatedHostCrash(point); },
    });
    await expect(crashed.commitGeneration({
      operation: 'update', lock: hostLock('b'), desiredState: { version: 2 }, installedIndex: { version: 2 },
    })).rejects.toBeInstanceOf(SimulatedHostCrash);
    expect(JSON.parse(await readFile(stable.paths.desiredState, 'utf8'))).toEqual({ version: 1 });

    const recoveryFence = await WriterFence.recoverStale(stable.paths.writerLock, 'test.recovery', {
      io: stable.hostIo, isProcessAlive: async () => false, processIdentity: 'recovery',
    });
    await recoveryFence.release();
    await stable.boot();
    expect(JSON.parse(await readFile(stable.paths.desiredState, 'utf8'))).toEqual({ version: 2 });
    expect(JSON.parse(await readFile(stable.paths.installedIndex, 'utf8'))).toEqual({ version: 2 });
  });

  it('rejects a disposal list that is not in dependency order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-disposal-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await expect(host.disposeOwners([
      { id: 'child', dependencies: ['parent'], disposers: [vi.fn()] },
      { id: 'parent', dependencies: [], disposers: [vi.fn()] },
    ], 100)).rejects.toThrow('dependency order');
  });

  it('disposes dependants and registrations in reverse order, continuing after failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-disposal-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const calls: string[] = [];
    await expect(host.disposeOwners([
      { id: 'parent', dependencies: [], disposers: [() => calls.push('parent:first'), () => calls.push('parent:second')] },
      { id: 'child', dependencies: ['parent'], disposers: [() => { calls.push('child:first'); throw new Error('broken'); }, () => calls.push('child:second')] },
    ], 100)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect(calls).toEqual(['child:second', 'child:first', 'parent:second', 'parent:first']);
  });
});
