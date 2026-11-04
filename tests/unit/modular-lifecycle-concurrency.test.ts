import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { readMigrationSourceRevision } from '../../packages/mod-kernel/src/migration-engine.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

describe('managed lifecycle concurrency', () => {
  it.each(['remove', 'replace'] as const)('retains the approved binding when a caller tries to %s it during verification', async mutation => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-plan-mutation-'));
    const path = join(root, 'config.json');
    await writeFile(path, '{"value":1}\n');
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const plan = JSON.parse(JSON.stringify(await createManagedLifecyclePlan(host, request([artifact('@test/app')], {
      configSource: await readMigrationSourceRevision(path),
    }))));
    await expect(service.apply(plan, installer, { async verify(prefix, verified) {
      await writeFile(path, '{"value":2}\n');
      if (mutation === 'remove') delete plan.configSource;
      else plan.configSource = await readMigrationSourceRevision(path);
      return verifier.verify(prefix, verified);
    } })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(await host.readCurrentPointer()).toBeNull();
    expect(await readdir(service.installationsRoot)).toEqual([]);
    expect(await readdir(service.stagingRoot)).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('{"value":2}\n');
  });

  it.each(['after-packages-staged', 'after-prefix-promoted'] as const)('refuses a changed config source at %s and permits a fresh plan', async boundary => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-config-'));
    const sourcePath = join(root, 'config.json');
    await writeFile(sourcePath, '{"value":1}\n');
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const stable = new ManagedLifecycleService(host);
    const entry = artifact('@test/app');
    await stable.apply(await createManagedLifecyclePlan(host, request([entry])), installer, verifier);
    const installedBefore = await readdir(stable.installationsRoot);
    const pointerBefore = await readFile(host.paths.current);
    const source = { path: sourcePath, contentHash: `sha256:${createHash('sha256').update(await readFile(sourcePath)).digest('hex')}` as const };
    const plan = await createManagedLifecyclePlan(host, request([entry], { operation: 'update', configSource: source }));
    const racing = new ManagedLifecycleService(host, { fault: async point => {
      if (point === boundary) await writeFile(sourcePath, '{"value":2}\n');
    } });
    await expect(racing.apply(plan, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(await readFile(host.paths.current)).toEqual(pointerBefore);
    expect(await readFile(sourcePath, 'utf8')).toBe('{"value":2}\n');
    expect(await readdir(stable.installationsRoot)).toEqual(installedBefore);
    expect(await readdir(stable.stagingRoot)).toEqual([]);
    const refreshed = { path: sourcePath, contentHash: `sha256:${createHash('sha256').update(await readFile(sourcePath)).digest('hex')}` as const };
    const next = await createManagedLifecyclePlan(host, request([entry], { operation: 'update', configSource: refreshed }));
    expect(next.planHash).not.toBe(plan.planHash);
    await expect(stable.apply({ ...plan, configSource: refreshed }, installer, verifier)).rejects.toThrow('plan hash mismatch');
    await expect(stable.apply(next, installer, verifier)).resolves.toMatchObject({ pointer: { generation: 2 } });
  });

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
