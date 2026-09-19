import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

async function fixture(): Promise<{ root: string; host: DurableModHost; service: ManagedLifecycleService }> {
  const root = await mkdtemp(join(tmpdir(), 'agon-managed-install-'));
  const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'installer-test' });
  return { root, host, service: new ManagedLifecycleService(host, { processIdentity: 'lifecycle-test' }) };
}

describe('managed installer', () => {
  it('builds a deterministic, dependency-ordered, exact-lock plan before mutation', async () => {
    const { root, host } = await fixture();
    const base = artifact('@test/base');
    const child = artifact('@test/child', ['@test/base']);
    const input = request([base, child]);
    const first = await createManagedLifecyclePlan(host, input);
    const second = await createManagedLifecyclePlan(host, input);
    expect(first).toEqual(second);
    expect(first.packages.map((entry) => entry.id)).toEqual(['@test/base', '@test/child']);
    expect(first.missing).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it('installs the complete closure into an immutable prefix and selects it once', async () => {
    const { host, service } = await fixture();
    const base = artifact('@test/base');
    const child = artifact('@test/child', ['@test/base']);
    const plan = await createManagedLifecyclePlan(host, request([base, child]));
    const result = await service.apply(plan, installer, verifier);
    expect(result.pointer.generation).toBe(1);
    expect(result.restartRequired).toBe(true);
    expect(result.installation.packages.map((entry) => entry.id)).toEqual(['@test/base', '@test/child']);
    expect((await service.readSelectedInstallation())?.installationId).toBe(result.installation.installationId);
    expect((await host.boot()).mode).toBe('normal');
  });

  it('reports the complete frozen-offline missing set before creating host state', async () => {
    const { root, host } = await fixture();
    const one = artifact('@test/one', [], { available: false });
    const two = artifact('@test/two', [], { available: false });
    await expect(createManagedLifecyclePlan(host, request([one, two], { requestedPackageIds: ['@test/one', '@test/two'] })))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED', details: { missing: ['@test/one', '@test/two'] } });
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects lifecycle scripts, lock drift, duplicate artifacts and linked self-overwrite', async () => {
    const { host } = await fixture();
    const scripted = artifact('@test/scripted', [], { lifecycleScripts: ['postinstall'] });
    await expect(createManagedLifecyclePlan(host, request([scripted]))).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    const duplicate = artifact('@test/duplicate');
    await expect(createManagedLifecyclePlan(host, request([duplicate, duplicate]))).rejects.toThrow('duplicate artifact');
    const linked = artifact('@test/linked', [], { source: 'linked-development', linkedRealpath: '/tmp/dev-linked' });
    await expect(createManagedLifecyclePlan(host, request([linked], {
      currentInvocation: { installationPrefix: '/tmp/dev-linked', source: 'linked-development' },
    }))).rejects.toThrow('never overwritten');
    const drifted = artifact('@test/drifted');
    await expect(createManagedLifecyclePlan(host, request([drifted], {
      artifacts: [{ ...drifted, version: '1.0.1' }],
    }))).rejects.toThrow('does not match canonical lock');
  });

  it('refuses a plausible but failing sacrificial verification result', async () => {
    const { host, service } = await fixture();
    const entry = artifact('@test/failing');
    const plan = await createManagedLifecyclePlan(host, request([entry]));
    await expect(service.apply(plan, installer, {
      verify: async () => ({ passed: true, checks: [{ id: 'activation', passed: false, detail: 'wrong surface' }] }),
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect(await host.readCurrentPointer()).toBeNull();
  });
});
