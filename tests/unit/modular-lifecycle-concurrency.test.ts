import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

describe('managed lifecycle concurrency', () => {
  it('rejects update when activation changes away and back during staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-aba-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const stable = new ManagedLifecycleService(host);
    await stable.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const update = artifact('@test/app', [], { version: '2.0.0', contentHash: `sha256:${'2'.repeat(64)}` });
    const plan = await createManagedLifecyclePlan(host, request([update], { operation: 'update', lock: lifecycleLock([update], '9') }));
    const service = new ManagedLifecycleService(host, { fault: async point => {
      if (point !== 'after-candidate-verified') return;
      await host.commitGeneration({ operation: 'enable', lock: plan.lock, desiredState: plan.desiredState, installedIndex: {} });
      await rollbackGeneration(host, 1);
    } });
    await expect(service.apply(plan, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await host.readCurrentPointer())?.generation).toBe(1);
    expect((await stable.readSelectedInstallation())?.packages[0]?.version).toBe('1.0.0');
    expect(await readdir(stable.installationsRoot)).toHaveLength(1);
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual(plan.desiredState);
  });

  it('permits one lifecycle writer and rejects every concurrent competitor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-concurrency-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'host' });
    const entry = artifact('@test/app');
    const plan = await createManagedLifecyclePlan(host, request([entry]));
    let entered!: () => void;
    let release!: () => void;
    const didEnter = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const leader = new ManagedLifecycleService(host, {
      processIdentity: 'leader',
      fault: async (point) => { if (point === 'after-lifecycle-lock') { entered(); await hold; } },
    });
    const leading = leader.apply(plan, installer, verifier);
    await didEnter;
    const competitors = await Promise.allSettled(Array.from({ length: 16 }, async (_, index) => {
      const competitorHost = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: `host-${index}` });
      const service = new ManagedLifecycleService(competitorHost, { processIdentity: `competitor-${index}` });
      return service.apply(plan, installer, verifier);
    }));
    expect(competitors.every((result) => result.status === 'rejected' && (result.reason as { code?: string }).code === 'MOD_HOST_BUSY')).toBe(true);
    release();
    expect((await leading).pointer.generation).toBe(1);
  });

  it('does not let two stale plans create two selected generations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-race-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'host' });
    const entry = artifact('@test/app');
    const plan = await createManagedLifecyclePlan(host, request([entry]));
    const one = new ManagedLifecycleService(host, { processIdentity: 'one' });
    const two = new ManagedLifecycleService(new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'host-two' }), { processIdentity: 'two' });
    const results = await Promise.allSettled([one.apply(plan, installer, verifier), two.apply(plan, installer, verifier)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
