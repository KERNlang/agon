import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

describe('managed lifecycle approval binding', () => {
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
