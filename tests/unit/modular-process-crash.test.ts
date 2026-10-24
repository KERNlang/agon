import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost, type HostFaultPoint } from '../../packages/mod-kernel/src/durable-host.js';
import { SimulatedHostCrash } from '../../packages/mod-kernel/src/host-errors.js';
import { hostLock } from '../helpers/modular-host.js';

async function reclaimDeadWriter(host: DurableModHost): Promise<void> {
  await host.recoverStaleWriter(async () => false);
}

describe('process-death recovery at every transaction boundary', () => {
  it.each<HostFaultPoint>([
    'after-lock', 'after-journal-preparing', 'after-staging', 'after-journal-verified', 'after-generation-rename',
  ])('reclaims and rolls back an actual pre-commit crash at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-process-crash-'));
    const stable = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable' });
    await stable.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { version: 1 }, installedIndex: { version: 1 } });
    const crashed = new DurableModHost(root, {
      kernelVersion: '1.0.0', processIdentity: 'crashed',
      fault: (seen) => { if (seen === point) throw new SimulatedHostCrash(point); },
    });
    await expect(crashed.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { version: 2 }, installedIndex: { version: 2 } })).rejects.toBeInstanceOf(SimulatedHostCrash);
    await expect(stable.boot()).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    await reclaimDeadWriter(stable);
    const boot = await stable.boot();
    expect(boot.mode).toBe('normal');
    expect(boot.pointer?.generation).toBe(1);
  });

  it.each<HostFaultPoint>([
    'after-pointer-switch', 'after-journal-committed', 'after-installed-index', 'after-final-journal',
  ])('reclaims and completes an actual post-commit crash at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-process-crash-'));
    const stable = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable' });
    await stable.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { version: 1 }, installedIndex: { version: 1 } });
    const crashed = new DurableModHost(root, {
      kernelVersion: '1.0.0', processIdentity: 'crashed',
      fault: (seen) => { if (seen === point) throw new SimulatedHostCrash(point); },
    });
    await expect(crashed.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { version: 2 }, installedIndex: { version: 2 } })).rejects.toBeInstanceOf(SimulatedHostCrash);
    await reclaimDeadWriter(stable);
    const boot = await stable.boot();
    expect(boot.mode).toBe('normal');
    expect(boot.pointer?.generation).toBe(2);
  });

  it('rejects a corrupt selected journal and chooses the verified previous generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-journal-corrupt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
    const pointer = await host.readCurrentPointer();
    const journal = host.journalPath(pointer!.transactionId);
    await chmod(journal, 0o600);
    await writeFile(journal, '{broken');
    const boot = await host.boot();
    expect(boot.mode).toBe('safe-mode');
    expect(boot.pointer?.generation).toBe(1);
  });
});
