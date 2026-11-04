import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { GenerationLeaseStore } from '../../packages/mod-kernel/src/generation-leases.js';
import { hostLock } from '../helpers/modular-host.js';

describe('generation lease corruption', () => {
  it.each(['kind', 'hash', 'pid', 'identity'] as const)('fails closed for corrupt artifact %s in either inventory', async corrupt => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-corrupt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await host.leaseArtifactGeneration(1,
      { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` });
    const changed = corrupt === 'kind' ? { ...lease, kind: 'process' }
      : corrupt === 'hash' ? { ...lease, artifactHash: 'invalid' }
        : corrupt === 'pid' ? { ...lease, pid: 123 } : { ...lease, leaseId: randomUUID() };
    const path = join(host.paths.leases, `${lease.leaseId}.json`);
    const bytes = JSON.stringify(changed);
    await writeFile(path, bytes);
    await expect(host.activeGenerationLeases()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    await expect(host.activeArtifactGenerationLeases()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it.each(['active', 'heartbeat', 'release', 'recoverDead'] as const)('rejects a file/record identity mismatch during %s', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lease-identity-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'reader',
      validateGeneration: generation => host.validateGeneration(generation),
    });
    const lease = await store.acquire(1, 'job');
    const path = join(host.paths.leases, `${lease.leaseId}.json`);
    const bytes = JSON.stringify({ ...lease, leaseId: randomUUID() });
    await writeFile(path, bytes);
    const result = action === 'active' ? store.active()
      : action === 'recoverDead' ? store.recoverDead(lease.leaseId, async () => false)
        : store[action](lease.leaseId);
    await expect(result).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it.each(['symlink', 'directory'] as const)('does not silently omit a %s lease from the active inventory', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lease-entry-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const store = new GenerationLeaseStore({
      directory: host.paths.leases, writerLockPath: host.paths.writerLock, processIdentity: 'reader',
      validateGeneration: generation => host.validateGeneration(generation),
    });
    const lease = await store.acquire(1, 'job');
    const path = join(host.paths.leases, `${lease.leaseId}.json`);
    const retained = join(root, 'retained-lease.json');
    const bytes = await readFile(path);
    await rename(path, retained);
    if (kind === 'symlink') await symlink(retained, path);
    else await mkdir(path);
    await expect(store.active()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(await readFile(retained)).toEqual(bytes);
  });

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
