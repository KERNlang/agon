import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { GenerationLeaseStore } from '../../packages/mod-kernel/src/generation-leases.js';
import { hostLock } from '../helpers/modular-host.js';

describe('fenced generation leases', () => {
  it('heartbeats and releases only from the owning process identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    let now = new Date('2026-01-01T00:00:00.000Z');
    const owner = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'owner', now: () => now });
    await owner.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await owner.leaseGeneration(1, 'agon.mod.worker');
    now = new Date('2026-01-01T00:00:05.000Z');
    expect((await owner.heartbeatGenerationLease(lease.leaseId)).heartbeatAt).toBe(now.toISOString());
    const stranger = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stranger', now: () => now });
    await expect(stranger.releaseGenerationLease(lease.leaseId)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    expect((await owner.releaseGenerationLease(lease.leaseId)).releasedAt).toBe(now.toISOString());
  });

  it('never reclaims by age and refuses PID reuse while the observed PID is alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const owner = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'dead-owner' });
    await owner.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await owner.leaseGeneration(1, 'agon.mod.job');
    const recovery = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'recovery' });
    await expect(recovery.recoverDeadGenerationLease(lease.leaseId, async () => true)).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    const released = await recovery.recoverDeadGenerationLease(lease.leaseId, async () => false);
    expect(released.releasedAt).not.toBeNull();
  });

  it('lists only active leases for a pinned generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'listing' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const one = await host.leaseGeneration(1, 'one');
    const two = await host.leaseGeneration(1, 'two');
    await host.releaseGenerationLease(one.leaseId);
    const store = new GenerationLeaseStore({
      directory: host.paths.leases,
      writerLockPath: host.paths.writerLock,
      processIdentity: 'listing',
      validateGeneration: (generation) => host.validateGeneration(generation),
      io: host.hostIo,
    });
    expect((await store.active(1)).map(({ leaseId }) => leaseId)).toEqual([two.leaseId]);
  });
});
