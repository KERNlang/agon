import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { TransactionalTrustGrantService } from '../../packages/mod-kernel/src/transactional-authority.js';

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const publisher = { registryOrigin: 'file:', packageName: 'example.tx', provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' as const };

function preview(service: TransactionalTrustGrantService) {
  return service.store.previewTrust({ modId: 'example.tx', version: '1.0.0', source: 'user-folder', sourceLocator: '/tmp/example', contentHash: hash('a'), manifestHash: hash('b'), decision: 'trusted', decidedAt: '2026-09-03T00:00:00.000Z', scope: 'exact-artifact', publisher, reason: 'approved' });
}

describe('S8 transactional trust authority', () => {
  it('serializes authority writes through the durable host writer lock and records a receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-tx-'));
    const service = new TransactionalTrustGrantService(root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const plan = preview(service);
    const receipt = await service.apply(plan, { approvedPlanHash: plan.planHash });
    expect(receipt).toMatchObject({ operation: 'trust', outcome: 'committed', recordId: plan.record.recordId });
    expect(await service.store.readTrust()).toHaveLength(1);
  });

  it('recovers a crash after the immutable record as committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-recover-'));
    const crashing = new TransactionalTrustGrantService(root, { fault: (point) => { if (point === 'after-authority-record') throw new Error('crash'); } });
    const plan = preview(crashing);
    await expect(crashing.apply(plan, { approvedPlanHash: plan.planHash })).rejects.toThrow('crash');
    const recovered = await new TransactionalTrustGrantService(root).recover();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.outcome).toBe('recovered-committed');
    expect(await crashing.store.readTrust()).toHaveLength(1);
  });

  it('rejects a recovery journal whose record path escapes the authority store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-path-'));
    const crashing = new TransactionalTrustGrantService(root, { fault: (point) => { if (point === 'after-authority-journal') throw new Error('crash'); } });
    const plan = preview(crashing);
    await expect(crashing.apply(plan, { approvedPlanHash: plan.planHash })).rejects.toThrow('crash');
    const journalName = (await readdir(crashing.paths.transactions)).find((name) => name.endsWith('.authority.json'))!;
    const journalPath = join(crashing.paths.transactions, journalName);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    await writeFile(journalPath, JSON.stringify({ ...journal, recordPath: '/tmp/authority-escape.json' }));
    await expect(new TransactionalTrustGrantService(root).recover()).rejects.toThrow(/escaped its owned authority directory/);
  });

  it('recovers a crash before record creation as rolled back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-recover-'));
    const crashing = new TransactionalTrustGrantService(root, { fault: (point) => { if (point === 'after-authority-journal') throw new Error('crash'); } });
    const plan = preview(crashing);
    await expect(crashing.apply(plan, { approvedPlanHash: plan.planHash })).rejects.toThrow('crash');
    const recovered = await new TransactionalTrustGrantService(root).recover();
    expect(recovered[0]?.outcome).toBe('recovered-rolled-back');
    expect(await crashing.store.readTrust()).toHaveLength(0);
  });
});
