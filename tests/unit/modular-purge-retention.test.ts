import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { previewManagedPurge } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

describe('managed purge generation retention', () => {
  it('cannot purge a non-selected installation while any retained generation references it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-retained-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const v1 = artifact('@test/app');
    const first = await service.apply(await createManagedLifecyclePlan(host, request([v1])), installer, verifier);
    const v2 = artifact('@test/app', [], {
      version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0',
      contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
    });
    await service.apply(await createManagedLifecyclePlan(host, request([v2], {
      operation: 'update', lock: lifecycleLock([v2], '9'),
    })), installer, verifier);
    await expect(previewManagedPurge(host, { installationIds: [first.installation.installationId] }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED', details: { installationIds: [first.installation.installationId] } });
  });
});
