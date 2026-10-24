import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { SimulatedHostCrash } from '../../packages/mod-kernel/src/host-errors.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { hostLock } from '../helpers/modular-host.js';

describe('terminal receipt reconciliation', () => {
  it('creates bound recovery evidence after death between the final journal and receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-receipt-reconcile-'));
    const crashed = new DurableModHost(root, {
      kernelVersion: '1.0.0', processIdentity: 'crashed',
      fault: (point) => { if (point === 'after-final-journal') throw new SimulatedHostCrash(point); },
    });
    await expect(crashed.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} }))
      .rejects.toBeInstanceOf(SimulatedHostCrash);
    expect(await readdir(crashed.paths.receipts)).toEqual([]);

    const recovering = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'recovering' });
    const fence = await WriterFence.recoverStale(recovering.paths.writerLock, 'test.recovery', {
      io: recovering.hostIo, isProcessAlive: async () => false, processIdentity: 'reclaimer',
    });
    await fence.release();
    const boot = await recovering.boot();
    expect(boot.mode).toBe('normal');
    expect(boot.recoveredTransactions).toHaveLength(1);
    const receiptFiles = await readdir(recovering.paths.receipts);
    expect(receiptFiles).toHaveLength(1);
    const receipt = JSON.parse(await readFile(join(recovering.paths.receipts, receiptFiles[0]!), 'utf8'));
    expect(receipt.outcome).toBe('recovered-committed');
    expect(receipt.transactionId).toBe(boot.pointer?.transactionId);
    expect(receipt.journal.state).toBe('committed');
  });

  it('does not accept a malformed receipt as terminal evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-receipt-reconcile-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const result = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const files = await readdir(host.paths.receipts);
    await Promise.all(files.map((file) => rm(join(host.paths.receipts, file))));
    await writeFile(
      join(host.paths.receipts, result.journal.transactionId + '.committed.json'),
      JSON.stringify({ schemaVersion: 1, transactionId: result.journal.transactionId, ownerId: 'forged', events: [], journal: {} }),
    );
    const boot = await host.boot();
    expect(boot.recoveredTransactions).toEqual([result.journal.transactionId]);
    expect((await readdir(host.paths.receipts)).some((file) => file.endsWith('.recovered-committed.json'))).toBe(true);
  });
});
