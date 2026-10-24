import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'agon-managed-update-'));
  const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'updater-test' });
  const service = new ManagedLifecycleService(host, { processIdentity: 'updater-lifecycle' });
  return { root, host, service };
}

describe('managed updater and rollback', () => {
  it('retains the previous qualified prefix and rolls back package, lock and state together', async () => {
    const { host, service } = await setup();
    const v1 = artifact('@test/app');
    const first = await service.apply(await createManagedLifecyclePlan(host, request([v1])), installer, verifier);
    const v2 = artifact('@test/app', [], {
      version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
    });
    const updateRequest = request([v2], {
      operation: 'update',
      lock: lifecycleLock([v2], '9'),
      desiredState: { schemaVersion: 1, enabled: ['@test/app'], version: 2 },
    });
    const second = await service.apply(await createManagedLifecyclePlan(host, updateRequest), installer, verifier);
    expect(second.pointer.generation).toBe(2);
    expect(second.installation.prefix).not.toBe(first.installation.prefix);
    const rolledBack = await service.rollback(1);
    expect(rolledBack.pointer.generation).toBe(1);
    expect((await service.readSelectedInstallation())?.installationId).toBe(first.installation.installationId);
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ schemaVersion: 1, enabled: ['@test/app'] });
  });

  it('fails closed when retained rollback bytes are missing or corrupt', async () => {
    const { root, host, service } = await setup();
    const v1 = artifact('@test/app');
    const first = await service.apply(await createManagedLifecyclePlan(host, request([v1])), installer, verifier);
    const v2 = artifact('@test/app', [], {
      version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
    });
    await service.apply(await createManagedLifecyclePlan(host, request([v2], {
      operation: 'update', lock: lifecycleLock([v2], '9'),
    })), installer, verifier);
    const recordPath = join(root, first.installation.prefix, 'agon-installation.json');
    await chmod(recordPath, 0o600);
    await readFile(recordPath);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(recordPath, '{}'));
    await expect(service.rollback(1)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect((await host.readCurrentPointer())?.generation).toBe(2);
  });

  it('rejects stale preview plans after another generation wins', async () => {
    const { host, service } = await setup();
    const entry = artifact('@test/app');
    const stale = await createManagedLifecyclePlan(host, request([entry]));
    await service.apply(await createManagedLifecyclePlan(host, request([entry])), installer, verifier);
    await expect(service.apply(stale, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
  });
});
