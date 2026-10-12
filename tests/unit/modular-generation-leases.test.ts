import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { GenerationLeaseStore } from '../../packages/mod-kernel/src/generation-leases.js';
import { hostLock } from '../helpers/modular-host.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';

describe('fenced generation leases', () => {
  it.each(['before-rename', 'changed-identity'] as const)('handles pending artifact publication safely: %s', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-pending-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const store = new GenerationLeaseStore({ directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'artifact-owner', validateGeneration: generation => host.validateGeneration(generation), io: { ...nodeHostIo,
        rename: async (from, to) => {
          if (fault === 'before-rename' && to.startsWith(`${host.paths.leases}/`)) throw new Error('fixture interrupted rename');
          return nodeHostIo.rename(from, to);
        },
        syncDirectory: async path => {
          if (fault === 'changed-identity' && path === host.paths.leases) throw new Error('fixture interrupted sync');
          return nodeHostIo.syncDirectory(path);
        },
      } });
    await expect(store.acquireArtifact(1, { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` })).rejects.toThrow('fixture interrupted');
    if (fault === 'before-rename') {
      await store.retryPendingCleanup();
      expect(await readdir(host.paths.leases)).toEqual([]);
    } else {
      const [lease] = await store.activeArtifacts();
      const path = join(host.paths.leases, `${lease.leaseId}.json`);
      const changed = JSON.stringify({ ...lease, artifactId: 'changed' });
      await writeFile(path, changed);
      const failure = await store.retryPendingCleanup().catch(error => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors).toEqual([expect.objectContaining({ code: 'MOD_FENCE_LOST' })]);
      expect(await readFile(path, 'utf8')).toBe(changed);
    }
  });

  it.each(['entry', 'validation'] as const)('does not publish an artifact lease cancelled at %s', async phase => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-cancel-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const controller = new AbortController();
    const reason = new Error('fixture artifact cancelled');
    const store = new GenerationLeaseStore({ directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'artifact-owner', validateGeneration: async generation => {
        await host.validateGeneration(generation);
        if (phase === 'validation') controller.abort(reason);
      } });
    if (phase === 'entry') controller.abort(reason);
    await expect(store.acquireArtifact(1,
      { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` }, controller.signal)).rejects.toBe(reason);
    expect(await readdir(host.paths.leases)).toEqual([]);
  });

  it.each(['empty-owner', 'empty-artifact', 'bad-hash', 'override-generation'] as const)('rejects invalid artifact identity before writing: %s', async invalid => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-invalid-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const artifact = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const input = invalid === 'empty-owner' ? { ...artifact, ownerId: '' }
      : invalid === 'empty-artifact' ? { ...artifact, artifactId: '' }
        : invalid === 'bad-hash' ? { ...artifact, artifactHash: 'sha256:invalid' as const } : { ...artifact, generation: 2 };
    await expect(host.leaseArtifactGeneration(1, input)).rejects.toBeInstanceOf(TypeError);
    expect(await readdir(host.paths.leases)).toEqual([]);
  });

  it.each(['ownerId', 'artifactId', 'artifactHash'] as const)('requires matching artifact %s before release', async key => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-identity-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const artifact = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const lease = await host.leaseArtifactGeneration(1, artifact);
    const changed = { ...artifact, [key]: key === 'artifactHash' ? `sha256:${'b'.repeat(64)}` : 'other' };
    await expect(host.releaseArtifactGenerationLease(lease.leaseId, changed)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    expect(await host.activeArtifactGenerationLeases()).toEqual([lease]);
  });

  it('keeps process and artifact operations separate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-process-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const identity = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const artifact = await host.leaseArtifactGeneration(1, identity);
    const processLease = await host.leaseGeneration(1, 'job:example');
    await expect(host.heartbeatGenerationLease(artifact.leaseId)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    await expect(host.releaseGenerationLease(artifact.leaseId)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    await expect(host.releaseArtifactGenerationLease(processLease.leaseId, identity)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    await host.retryGenerationLeaseCleanup();
    expect(await host.activeGenerationLeases()).toEqual([processLease]);
    expect(await host.activeArtifactGenerationLeases()).toEqual([artifact]);
  });

  it.each(['lease-sync', 'lock-remove'] as const)('keeps published artifact protection after %s failure and cleanup', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-fault-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    let broken = true;
    const failure = new Error(`fixture ${fault}`);
    const store = new GenerationLeaseStore({ directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'artifact-owner', validateGeneration: generation => host.validateGeneration(generation), io: { ...nodeHostIo,
        syncDirectory: async path => {
          if (broken && fault === 'lease-sync' && path === host.paths.leases) throw failure;
          return nodeHostIo.syncDirectory(path);
        },
        rm: async (path, options) => {
          if (broken && fault === 'lock-remove' && path === host.paths.writerLock) throw failure;
          return nodeHostIo.rm(path, options);
        },
      } });
    const identity = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    await expect(store.acquireArtifact(1, identity)).rejects.toBe(failure);
    const retained = await store.activeArtifacts();
    expect(retained).toHaveLength(1);
    await expect(store.retryPendingCleanup()).rejects.toBeInstanceOf(AggregateError);
    broken = false;
    await store.retryPendingCleanup();
    expect(await store.activeArtifacts()).toEqual(retained);
    await store.releaseArtifact(retained[0].leaseId, identity);
    expect(await store.activeArtifacts()).toEqual([]);
  });

  it('resyncs a released artifact record when publication durability previously failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-release-sync-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    let broken = false;
    const synced: string[] = [];
    const store = new GenerationLeaseStore({ directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'artifact-owner', validateGeneration: generation => host.validateGeneration(generation), io: { ...nodeHostIo,
        syncDirectory: async path => {
          if (path === host.paths.leases) {
            if (broken) throw new Error('fixture directory sync failed');
            synced.push(path);
          }
          return nodeHostIo.syncDirectory(path);
        },
      } });
    const identity = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const lease = await store.acquireArtifact(1, identity);
    synced.length = 0;
    broken = true;
    await expect(store.releaseArtifact(lease.leaseId, identity)).rejects.toThrow('fixture directory sync failed');
    broken = false;
    await store.releaseArtifact(lease.leaseId, identity);
    expect(synced).toEqual([host.paths.leases]);
  });

  it('retains artifact identity across host restarts and refuses process recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'first', now: () => new Date('2000-01-01T00:00:00Z') });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const artifact = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const lease = await host.leaseArtifactGeneration(1, artifact);
    const reopened = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'second' });
    expect(await reopened.activeArtifactGenerationLeases()).toEqual([lease]);
    expect(await reopened.activeGenerationLeases()).toEqual([]);
    const alive = vi.fn(async () => false);
    await expect(reopened.recoverDeadGenerationLease(lease.leaseId, alive)).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    expect(alive).not.toHaveBeenCalled();
    await expect(reopened.releaseArtifactGenerationLease(lease.leaseId, { ...artifact, artifactHash: `sha256:${'b'.repeat(64)}` }))
      .rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
    expect(await reopened.activeArtifactGenerationLeases()).toEqual([lease]);
    const released = await reopened.releaseArtifactGenerationLease(lease.leaseId, artifact);
    expect(released).toMatchObject({ ...lease, releasedAt: expect.any(String) });
    expect(await reopened.activeArtifactGenerationLeases()).toEqual([]);
    expect(await reopened.releaseArtifactGenerationLease(lease.leaseId, artifact)).toEqual(released);
  });

  it('does not start another acquisition after a delayed retry exceeds its budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const fence = await WriterFence.acquire(host.paths.writerLock, 'lifecycle');
    let attempts = 0;
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'delayed-job',
      validateGeneration: generation => host.validateGeneration(generation), writerWaitMs: 30,
      io: { ...host.hostIo, writeFile: async (path, data, options) => {
        if (path === host.paths.writerLock) attempts++;
        await host.hostIo.writeFile(path, data, options);
      } },
    });
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1_000);
    try {
      await expect(store.acquire(1, 'job')).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(attempts).toBe(1);
    } finally { clock.mockRestore(); await fence.release(); }
  });

  it('shares recovery when two callers retry the same retained writer fence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    let broken = true;
    let holdRead = false;
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const failure = new Error('fixture lock removal failed');
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'parallel-recovery',
      validateGeneration: generation => host.validateGeneration(generation),
      io: { ...host.hostIo,
        rm: async (path, options) => {
          if (broken && path === host.paths.writerLock) throw failure;
          return host.hostIo.rm(path, options);
        },
        readFile: async path => {
          const bytes = await host.hostIo.readFile(path);
          if (holdRead && path === host.paths.writerLock) { entered(); await paused; }
          return bytes;
        },
      },
    });
    await expect(store.acquire(1, 'job')).rejects.toBe(failure);
    broken = false;
    holdRead = true;
    const first = store.retryPendingCleanup();
    await started;
    const second = store.retryPendingCleanup();
    resume();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await store.active()).toEqual([]);
  });

  it('retries a release after the contending lifecycle writer leaves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'completed-job', validateGeneration: generation => host.validateGeneration(generation),
      writerWaitMs: 30,
    });
    const lease = await store.acquire(1, 'job');
    const fence = await WriterFence.acquire(host.paths.writerLock, 'lifecycle');
    try {
      await expect(store.release(lease.leaseId)).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect((await store.active()).map(item => item.leaseId)).toEqual([lease.leaseId]);
      expect(JSON.parse(await readFile(host.paths.writerLock, 'utf8'))).toEqual(fence.record);
    } finally { await fence.release(); }
    await store.retryPendingCleanup();
    expect(await store.active()).toEqual([]);
  });

  it('retains failed releases in the durable host across method calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    let broken = false;
    const failure = new Error('fixture lease rename failed');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: {
      ...nodeHostIo,
      rename: async (from, to) => {
        if (broken && to.startsWith(join(root, 'leases') + '/')) throw failure;
        await nodeHostIo.rename(from, to);
      },
    } });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await host.leaseGeneration(1, 'job');
    broken = true;
    await expect(host.releaseGenerationLease(lease.leaseId)).rejects.toBe(failure);
    const leasePath = join(host.paths.leases, `${lease.leaseId}.json`);
    expect(JSON.parse(await readFile(leasePath, 'utf8')).releasedAt).toBeNull();
    await expect(host.retryGenerationLeaseCleanup()).rejects.toBeInstanceOf(AggregateError);
    broken = false;
    await host.retryGenerationLeaseCleanup();
    expect(JSON.parse(await readFile(leasePath, 'utf8')).releasedAt).not.toBeNull();
    await host.retryGenerationLeaseCleanup();
  });

  it.each(['lease-sync', 'lock-remove', 'lock-sync'])('retains recoverable ownership after acquisition fails at %s', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    let broken = true;
    let lockSyncs = 0;
    const failure = new Error(`fixture ${fault}`);
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'recovery-job',
      validateGeneration: generation => host.validateGeneration(generation),
      io: { ...host.hostIo,
        rm: async (path, options) => {
          if (broken && fault === 'lock-remove' && path === host.paths.writerLock) throw failure;
          return host.hostIo.rm(path, options);
        },
        syncDirectory: async path => {
          if (path === join(root, 'locks')) lockSyncs++;
          if (broken && ((fault === 'lease-sync' && path === host.paths.leases)
            || (fault === 'lock-sync' && path === join(root, 'locks') && lockSyncs > 1))) throw failure;
          return host.hostIo.syncDirectory(path);
        },
      },
    });
    await expect(store.acquire(1, 'job')).rejects.toBe(failure);
    expect((await store.active()).length).toBe(1);
    broken = false;
    await store.retryPendingCleanup();
    expect(await store.active()).toEqual([]);
    const next = await WriterFence.acquire(host.paths.writerLock, 'next');
    await next.release();
  });

  it.each(['live', 'malformed'])('bounds the wait without replacing a %s writer lock', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const fence = kind === 'live' ? await WriterFence.acquire(host.paths.writerLock, 'lifecycle') : undefined;
    if (!fence) await writeFile(host.paths.writerLock, 'incomplete lock');
    const original = await readFile(host.paths.writerLock, 'utf8');
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'waiting-job', validateGeneration: generation => host.validateGeneration(generation),
      writerWaitMs: 30,
    });
    try {
      await expect(store.acquire(1, 'job')).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(await readFile(host.paths.writerLock, 'utf8')).toBe(original);
      expect(await readdir(host.paths.leases)).toEqual([]);
    } finally {
      if (fence) await fence.release();
    }
  });

  it.each([false, true])('reports writer cleanup failure without losing an action failure: %s', async actionFails => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const cleanupError = new Error('fixture cleanup failed');
    const actionError = new Error('fixture validation failed');
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'cleanup-job',
      validateGeneration: generation => actionFails ? Promise.reject(actionError) : host.validateGeneration(generation),
      io: { ...host.hostIo, rm: async (path, options) => {
        if (path === host.paths.writerLock) throw cleanupError;
        return host.hostIo.rm(path, options);
      } },
    });
    if (actionFails) await expect(store.acquire(1, 'job')).rejects.toMatchObject({ errors: [actionError, cleanupError] });
    else await expect(store.acquire(1, 'job')).rejects.toBe(cleanupError);
    expect(JSON.parse(await readFile(host.paths.writerLock, 'utf8')).processIdentity).toBe('cleanup-job');
  });

  it('preserves a cancelled admission reason while a lifecycle writer owns the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const fence = await WriterFence.acquire(host.paths.writerLock, 'lifecycle');
    const parent = new AbortController();
    const reason = new Error('fixture admission cancelled');
    let attempts = 0;
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock,
      processIdentity: 'cancelled-job', validateGeneration: generation => host.validateGeneration(generation),
      writerWaitMs: 50,
      io: { ...host.hostIo, writeFile: async (path, data, options) => {
        if (path === host.paths.writerLock) { attempts++; parent.abort(reason); }
        return host.hostIo.writeFile(path, data, options);
      } },
    });
    try {
      // The optional signal is the required admission boundary.
      await expect(store.acquire(1, 'job', parent.signal)).rejects.toBe(reason);
      expect(attempts).toBe(1);
      expect(await readdir(host.paths.leases)).toEqual([]);
    } finally { await fence.release(); }
  });

  it('admits concurrent invocation leases without treating peer jobs as lifecycle writers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-generation-lease-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'parallel-jobs' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      host.leaseGeneration(1, `job-${index}`)));
    const acquired = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    // Release successful acquisitions before checking the concurrent outcome.
    for (const lease of acquired) await host.releaseGenerationLease(lease.leaseId);
    expect(results.map(result => result.status)).toEqual(Array(8).fill('fulfilled'));
    expect(new Set(acquired.map(lease => lease.leaseId)).size).toBe(8);
  });

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
