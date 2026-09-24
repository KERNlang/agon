import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { DurableHostError } from '../../packages/mod-kernel/src/host-errors.js';
import { nodeHostIo, type HostIo } from '../../packages/mod-kernel/src/host-io.js';
import {
  ManagedLifecycleService,
  createManagedLifecyclePlan,
  type ManagedLifecycleFaultPoint,
} from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

async function base(root: string) {
  const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable-host' });
  const stable = new ManagedLifecycleService(host, { processIdentity: 'stable-lifecycle' });
  const entry = artifact('@test/app');
  await stable.apply(await createManagedLifecyclePlan(host, request([entry])), installer, verifier);
  return { host, stable };
}

function updateRequest() {
  const entry = artifact('@test/app', [], {
    version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
  });
  return request([entry], { operation: 'update', lock: lifecycleLock([entry], '9') });
}

describe('managed lifecycle fault injection', () => {
  it.each<ManagedLifecycleFaultPoint>([
    'after-lifecycle-lock',
    'after-lifecycle-journal',
    'after-prefix-created',
    'after-packages-staged',
    'after-candidate-verified',
    'after-prefix-promoted',
  ])('keeps the previous generation bootable when failure occurs at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-fault-'));
    const { host } = await base(root);
    const service = new ManagedLifecycleService(host, {
      processIdentity: `fault-${point}`,
      fault: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
    });
    const plan = await createManagedLifecyclePlan(host, updateRequest());
    await expect(service.apply(plan, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await host.boot()).pointer?.generation).toBe(1);
    expect((await readdir(service.installationsRoot)).length).toBe(1);
  });

  it.each<ManagedLifecycleFaultPoint>(['after-generation-selected', 'after-lifecycle-receipt'])
  ('marks restart-required but leaves the new selected generation valid at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-postcommit-'));
    const { host } = await base(root);
    const service = new ManagedLifecycleService(host, {
      processIdentity: `fault-${point}`,
      fault: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
    });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await host.boot()).pointer?.generation).toBe(2);
    expect((await service.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
  });

  it.each(['ENOSPC', 'EACCES', 'EIO'])('preserves prior state when prefix promotion fails with %s', async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-errno-'));
    const { host } = await base(root);
    const failingIo: HostIo = {
      ...nodeHostIo,
      rename: async (from, to) => {
        if (from.includes('installation-staging') && to.includes('installations')) {
          throw Object.assign(new Error(code), { code });
        }
        await nodeHostIo.rename(from, to);
      },
    };
    const failingHost = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: `io-${code}`, io: failingIo });
    const service = new ManagedLifecycleService(failingHost, { processIdentity: `lifecycle-${code}`, io: failingIo });
    await expect(service.apply(await createManagedLifecyclePlan(failingHost, updateRequest()), installer, verifier))
      .rejects.toBeInstanceOf(DurableHostError);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
