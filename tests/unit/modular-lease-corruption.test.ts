import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { GenerationLeaseStore } from '../../packages/mod-kernel/src/generation-leases.js';

describe('generation lease corruption', () => {
  it('returns a typed fail-closed error for malformed lease JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lease-corrupt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'reader' });
    await host.initialize();
    await writeFile(join(host.paths.leases, '00000000-0000-4000-8000-000000000000.json'), '{broken');
    await expect(host.recoverDeadGenerationLease('00000000-0000-4000-8000-000000000000', async () => false))
      .rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });

  it('rejects syntactically valid leases with missing or unknown fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lease-corrupt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'reader' });
    await host.initialize();
    await writeFile(join(host.paths.leases, '00000000-0000-4000-8000-000000000001.json'), JSON.stringify({
      schemaVersion: 1, leaseId: '00000000-0000-4000-8000-000000000001', generation: 1, injected: true,
    }));
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'reader',
      validateGeneration: async () => undefined, io: host.hostIo,
    });
    await expect(store.active()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });
});
