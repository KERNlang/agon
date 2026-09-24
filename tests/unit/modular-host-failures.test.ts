import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { nodeHostIo, type HostIo } from '../../packages/mod-kernel/src/host-io.js';
import { hostLock } from '../helpers/modular-host.js';

async function fixture(): Promise<string> { return mkdtemp(join(tmpdir(), 'agon-mod-failure-')); }
function errno(code: string): NodeJS.ErrnoException { return Object.assign(new Error(code), { code }); }

describe('durable host hostile filesystem and concurrency controls', () => {
  it('rejects reserved generation-file overrides before selecting anything', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await expect(host.commitGeneration({
      operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {}, files: { 'mods.lock.json': '{}' },
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect(await host.readCurrentPointer()).toBeNull();
  });

  it('treats undeclared bytes as generation corruption', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    await chmod(host.generationPath(1), 0o755);
    await writeFile(join(host.generationPath(1), 'injected.js'), 'unexpected');
    await expect(host.validateGeneration(1)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect((await host.boot()).mode).toBe('kernel-only');
  });

  it('keeps one writer fenced while many competitors fail closed', async () => {
    const root = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const leader = new DurableModHost(root, { kernelVersion: '1.0.0', fault: async (point) => { if (point === 'after-lock') { entered(); await hold; } } });
    const leading = leader.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    await enteredPromise;
    const competitors = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => new DurableModHost(root, {
      kernelVersion: '1.0.0', ownerId: `competitor-${index}`,
    }).commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} })));
    expect(competitors.every((result) => result.status === 'rejected' && (result.reason as any).code === 'MOD_HOST_BUSY')).toBe(true);
    release();
    expect((await leading).pointer.generation).toBe(1);
  });

  it.each(['ENOSPC', 'EACCES', 'EIO'])('preserves the prior pointer when pointer promotion fails with %s', async (code) => {
    const root = await fixture();
    const base = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await base.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const failingIo: HostIo = {
      ...nodeHostIo,
      rename: async (from, to) => {
        if (to === base.paths.current) throw errno(code);
        await nodeHostIo.rename(from, to);
      },
    };
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: failingIo });
    await expect(failing.commitGeneration({
      operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {}, files: { 'nested/payload': 'bytes' },
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await base.readCurrentPointer())?.generation).toBe(1);
    await expect(stat(base.generationPath(2))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a torn temporary pointer and retains the old pointer bytes', async () => {
    const root = await fixture();
    const base = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await base.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const failingIo: HostIo = {
      ...nodeHostIo,
      writeFile: async (path, data, options) => {
        if (path.includes('.current-generation.json.')) {
          await nodeHostIo.writeFile(path, String(data).slice(0, 8), options);
          throw errno('ENOSPC');
        }
        await nodeHostIo.writeFile(path, data, options);
      },
    };
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', io: failingIo });
    await expect(failing.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await base.readCurrentPointer())?.generation).toBe(1);
  });
});
