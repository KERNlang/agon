import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { DurableHostError } from '../../packages/mod-kernel/src/host-errors.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { hostLock } from '../helpers/modular-host.js';

async function fixture(): Promise<string> { return mkdtemp(join(tmpdir(), 'agon-mod-host-')); }

describe('DurableModHost', () => {
  it('commits an immutable generation and atomically selects it', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'test-process' });
    const result = await host.commitGeneration({
      operation: 'install', lock: hostLock(), desiredState: { enabled: [] }, installedIndex: { packages: [] },
      files: { 'assets/readme.txt': 'hello' },
    });
    expect(result.pointer.generation).toBe(1);
    expect((await host.boot()).mode).toBe('normal');
    expect((await readFile(join(host.generationPath(1), 'assets/readme.txt'), 'utf8'))).toBe('hello');
    await expect(writeFile(join(host.generationPath(1), 'assets/readme.txt'), 'mutated')).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('refuses concurrent writers and detects a lost fence token', async () => {
    const root = await fixture();
    const path = join(root, 'writer.json');
    const first = await WriterFence.acquire(path, 'one', { processIdentity: 'one' });
    await expect(WriterFence.acquire(path, 'two', { processIdentity: 'two' })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    await chmod(path, 0o600);
    const payload = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, `${JSON.stringify({ ...payload, fenceToken: crypto.randomUUID() })}\n`);
    await expect(first.assertOwned()).rejects.toMatchObject({ code: 'MOD_FENCE_LOST' });
  });

  it('reclaims only a confirmed dead stable owner and refuses a live or changing owner', async () => {
    const root = await fixture();
    const path = join(root, 'writer.json');
    const first = await WriterFence.acquire(path, 'one', { pid: 4242, processIdentity: 'one' });
    await expect(WriterFence.recoverStale(path, 'two', { isProcessAlive: async () => true, processIdentity: 'two' })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    const recovered = await WriterFence.recoverStale(path, 'two', { isProcessAlive: async () => false, processIdentity: 'two' });
    expect(recovered.record.ownerId).toBe('two');
    await recovered.release();
    await first.release().catch(() => undefined);
  });

  it('rejects stale dispatch and disposes dependents and registrations in reverse order', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
    await expect(host.assertHostGeneration(1)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    const calls: string[] = [];
    await host.disposeOwners([
      { id: 'base', dependencies: [], disposers: [() => calls.push('base-1'), () => calls.push('base-2')] },
      { id: 'child', dependencies: ['base'], disposers: [() => calls.push('child-1'), () => calls.push('child-2')] },
    ], 100);
    expect(calls).toEqual(['child-2', 'child-1', 'base-2', 'base-1']);
  });

  it('marks disposal failure restart-required without skipping remaining cleanup', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const after = vi.fn();
    await expect(host.disposeOwners([
      { id: 'base', dependencies: [], disposers: [after] },
      { id: 'child', dependencies: ['base'], disposers: [() => { throw new Error('broken'); }] },
    ], 100)).rejects.toBeInstanceOf(DurableHostError);
    expect(after).toHaveBeenCalledOnce();
  });

  it('journals generation leases and preserves their released record', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'lease-process' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await host.leaseGeneration(1, 'agon.mod.job');
    const released = await host.releaseGenerationLease(lease.leaseId);
    expect(released.generation).toBe(1);
    expect(released.releasedAt).not.toBeNull();
  });
});
