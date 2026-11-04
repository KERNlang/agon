import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

describe('managed lifecycle approval binding', () => {
  it.each([
    { payloadHash: 'sha256:bad' as const },
    { version: '2.0.0' },
    { sourceLocator: '' },
    { unexpected: true },
  ])('rejects malformed launcher identity: %j', async change => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-launcher-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const launcher = { version: '1.0.0', sourceLocator: '@kernlang/agon@1.0.0',
      payloadHash: `sha256:${'1'.repeat(64)}` as const, ...change };
    await expect(createManagedLifecyclePlan(host, { ...request([artifact('@test/app')]), launcher }))
      .rejects.toThrow(/launcher identity|source locator/);
  });

  it('binds launcher bytes to approval and retained installation state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-launcher-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const launcher = { version: '1.0.0', sourceLocator: '@kernlang/agon@1.0.0',
      payloadHash: `sha256:${'1'.repeat(64)}` as const };
    const input = { ...request([artifact('@test/app')]), launcher };
    const first = await createManagedLifecyclePlan(host, input);
    const second = await createManagedLifecyclePlan(host, { ...input,
      launcher: { ...launcher, payloadHash: `sha256:${'2'.repeat(64)}` as const } });
    expect(first).toHaveProperty('launcher', launcher);
    expect(first.planHash).not.toBe(second.planHash);
    const service = new ManagedLifecycleService(host);
    await expect(service.apply({ ...first, launcher: second.launcher }, installer, verifier))
      .rejects.toThrow('plan hash mismatch');
    const result = await service.apply(first, installer, verifier);
    expect(result.installation).toHaveProperty('launcher', launcher);
    expect(await service.readSelectedInstallation()).toHaveProperty('launcher', launcher);
  });

  it('binds installed payload identity to the approved plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-payload-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const first = { ...artifact('@test/app'), payloadHash: `sha256:${'1'.repeat(64)}` as const };
    const second = { ...first, payloadHash: `sha256:${'2'.repeat(64)}` as const };
    const a = await createManagedLifecyclePlan(host, request([first]));
    const b = await createManagedLifecyclePlan(host, request([second]));
    expect(a.packages[0]).toMatchObject({ payloadHash: first.payloadHash });
    expect(a.planHash).not.toBe(b.planHash);
    await expect(createManagedLifecyclePlan(host, request([{ ...first, payloadHash: 'sha256:bad' }])))
      .rejects.toThrow('integrity metadata');
  });

  it('requires exact plan approval when provenance or source changes need a decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-approval-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const entry = artifact('@test/app', [], { provenance: 'unavailable' });
    const plan = await createManagedLifecyclePlan(host, request([entry], { networkPolicy: 'online' }));
    expect(plan.approvalReasons).toEqual(['provenance-unavailable:@test/app']);
    await expect(service.apply(plan, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    await expect(service.apply(plan, installer, verifier, { approvedPlanHash: `sha256:${'0'.repeat(64)}` }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await service.apply(plan, installer, verifier, { approvedPlanHash: plan.planHash })).pointer.generation).toBe(1);
  });
});
