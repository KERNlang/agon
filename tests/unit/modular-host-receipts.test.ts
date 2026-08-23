import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { SimulatedHostCrash } from '../../packages/mod-kernel/src/host-errors.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { hostLock } from '../helpers/modular-host.js';

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agon-host-receipts-'));
}

async function receipts(root: string): Promise<Array<Record<string, unknown>>> {
  const directory = join(root, 'receipts');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(directory, file), 'utf8'))));
}

describe('durable host transaction receipts', () => {
  it('records one redacted, transaction-scoped receipt for every ordinary terminal outcome', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', secrets: ['swordfish'] });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });

    const failing = new DurableModHost(root, {
      kernelVersion: '1.0.0', secrets: ['swordfish'],
      fault: (point) => { if (point === 'after-staging') throw new Error('swordfish must not escape'); },
    });
    await expect(failing.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });

    const stored = await receipts(root);
    expect(stored.map(({ outcome }) => outcome).sort()).toEqual(['committed', 'rolled-back']);
    expect(JSON.stringify(stored)).not.toContain('swordfish');
    expect(stored.every(({ events }) => Array.isArray(events) && events.length === 2)).toBe(true);
  });

  it('records restart-required and preserves separate recovered-committed evidence', async () => {
    const root = await fixture();
    const stable = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await stable.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const failing = new DurableModHost(root, {
      kernelVersion: '1.0.0', fault: (point) => { if (point === 'after-pointer-switch') throw new Error('reload failed'); },
    });
    await expect(failing.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} }))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await receipts(root)).some(({ outcome }) => outcome === 'restart-required')).toBe(true);
    await stable.boot();
    expect((await receipts(root)).some(({ outcome }) => outcome === 'recovered-committed')).toBe(true);
  });

  it('creates recovery evidence after process death without claiming a crash-time receipt', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, {
      kernelVersion: '1.0.0',
      fault: (point) => { if (point === 'after-journal-verified') throw new SimulatedHostCrash(point); },
    });
    await expect(host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} }))
      .rejects.toBeInstanceOf(SimulatedHostCrash);
    expect(await receipts(root)).toEqual([]);

    const recovering = new DurableModHost(root, {
      kernelVersion: '1.0.0',
      writerLock: { isProcessAlive: async () => false, staleAfterMs: 0 },
    });
    const fence = await WriterFence.recoverStale(recovering.paths.writerLock, 'test.recovery', {
      io: recovering.hostIo, isProcessAlive: async () => false, processIdentity: 'recovery-process',
    });
    await fence.release();
    await recovering.recoverTransactions();
    expect((await receipts(root)).map(({ outcome }) => outcome)).toEqual(['recovered-rolled-back']);
  });
});
