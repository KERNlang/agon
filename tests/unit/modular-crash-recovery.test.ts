import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost, type HostFaultPoint } from '../../packages/mod-kernel/src/durable-host.js';
import { hostLock } from '../helpers/modular-host.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';

async function fixture(): Promise<string> { return mkdtemp(join(tmpdir(), 'agon-mod-crash-')); }

describe('durable host crash and safe-mode recovery', () => {
  it.each<HostFaultPoint>([
    'after-lock', 'after-journal-preparing', 'after-staging', 'after-journal-verified', 'after-generation-rename',
  ])('leaves the prior generation selected on pre-commit failure at %s', async (point) => {
    const root = await fixture();
    const base = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await base.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', fault: (seen) => { if (seen === point) throw new Error(`crash:${point}`); } });
    await expect(failing.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await base.readCurrentPointer())?.generation).toBe(1);
    expect((await base.boot()).mode).toBe('normal');
  });

  it.each<HostFaultPoint>(['after-pointer-switch', 'after-journal-committed', 'after-installed-index', 'after-final-journal'])('keeps the committed generation recoverable at %s', async (point) => {
    const root = await fixture();
    const base = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await base.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const failing = new DurableModHost(root, { kernelVersion: '1.0.0', fault: (seen) => { if (seen === point) throw new Error(`crash:${point}`); } });
    await expect(failing.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} })).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await base.readCurrentPointer())?.generation).toBe(2);
    expect((await base.boot()).pointer?.generation).toBe(2);
  });

  it('selects a verified previous generation in safe mode and never by timestamp alone', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {}, files: { 'payload.txt': 'valid' } });
    const payload = join(host.generationPath(2), 'payload.txt');
    await chmod(payload, 0o600);
    await writeFile(payload, 'corrupt');
    const boot = await host.boot();
    expect(boot.mode).toBe('safe-mode');
    expect(boot.pointer?.generation).toBe(1);
  });

  it('recovers an explicitly selected verified generation from a malformed pointer without importing mods', async () => {
    const root = await fixture(); const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
    await writeFile(host.paths.current, '{malformed');
    const recovered = await rollbackGeneration(host, 1, { allowInvalidCurrent: true });
    expect(recovered.pointer.generation).toBe(1); expect((await host.boot()).mode).toBe('normal');
  });

  it('boots kernel-only when the pointer and every immutable generation are corrupt', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const manifest = join(host.generationPath(1), 'generation.json');
    await chmod(manifest, 0o600);
    await writeFile(manifest, `${(await readFile(manifest, 'utf8')).slice(0, 20)}broken`);
    expect((await host.boot()).mode).toBe('kernel-only');
  });
});
