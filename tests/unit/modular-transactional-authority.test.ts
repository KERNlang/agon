import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { TransactionalTrustGrantService } from '../../packages/mod-kernel/src/transactional-authority.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const publisher = { registryOrigin: 'file:', packageName: 'example.tx', provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' as const };

function preview(service: TransactionalTrustGrantService) {
  return service.store.previewTrust({ modId: 'example.tx', version: '1.0.0', source: 'user-folder', sourceLocator: '/tmp/example', contentHash: hash('a'), manifestHash: hash('b'), decision: 'trusted', decidedAt: '2026-09-03T00:00:00.000Z', scope: 'exact-artifact', publisher, reason: 'approved' });
}

describe('S8 transactional trust authority', () => {
  it.each(['apply', 'recover'] as const)('%s reports release failures and preserves authority state', async operation => {
    for (const phase of ['remove', 'sync'] as const) {
      for (const operationFails of [false, true]) {
        const root = await mkdtemp(join(tmpdir(), 'agon-authority-release-'));
        const healthy = new TransactionalTrustGrantService(root);
        const plan = preview(healthy);
        if (operation === 'recover') {
          const interrupted = new TransactionalTrustGrantService(root, { fault: point => {
            if (point === 'after-authority-record') throw new Error('fixture interrupted');
          } });
          await expect(interrupted.apply(plan, { approvedPlanHash: plan.planHash })).rejects.toThrow('fixture interrupted');
        }
        const writer = healthy.paths.writerLock;
        const cleanupFailure = new Error(`fixture cleanup ${phase}`);
        const operationFailure = new Error('fixture authority operation failed');
        let removed = false;
        const service = new TransactionalTrustGrantService(root, {
          fault: point => { if (operationFails && point === 'after-authority-journal') throw operationFailure; },
          io: { ...nodeHostIo,
            rm: async (path, options) => {
              if (path === writer && phase === 'remove') throw cleanupFailure;
              await nodeHostIo.rm(path, options);
              if (path === writer) removed = true;
            },
            syncDirectory: async path => {
              if (removed && path === dirname(writer) && phase === 'sync') throw cleanupFailure;
              return nodeHostIo.syncDirectory(path);
            },
            readdir: async (path, options) => {
              if (operationFails && operation === 'recover' && path === healthy.paths.transactions) throw operationFailure;
              return nodeHostIo.readdir(path, options);
            },
          },
        });
        const result = operation === 'apply' ? service.apply(plan, { approvedPlanHash: plan.planHash }) : service.recover();
        const failure = await result.then(() => undefined, error => error);
        if (operationFails) {
          expect(failure).toBeInstanceOf(AggregateError);
          expect(failure.errors).toHaveLength(2);
          expect(failure.errors[0]).toBe(operationFailure);
          expect(failure.errors[1]).toBe(cleanupFailure);
        } else expect(failure).toBe(cleanupFailure);
        if (phase === 'remove') expect((await stat(writer)).isFile()).toBe(true);
        else await expect(stat(writer)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await healthy.store.readTrust()).toHaveLength(operation === 'apply' && operationFails ? 0 : 1);
        const journals = (await readdir(healthy.paths.transactions)).filter(name => name.endsWith('.authority.json'));
        expect(journals).toHaveLength(1);
        expect(JSON.parse(await readFile(join(healthy.paths.transactions, journals[0]!), 'utf8')).state).toBe(operationFails ? 'preparing' : 'committed');
        const receipts = await readdir(healthy.paths.receipts);
        expect(receipts).toHaveLength(operationFails ? 0 : 1);
        if (!operationFails) expect(JSON.parse(await readFile(join(healthy.paths.receipts, receipts[0]!), 'utf8')).outcome)
          .toBe(operation === 'apply' ? 'committed' : 'recovered-committed');
      }
    }
  });

  it.each(['approval', 'plan-hash', 'sequence-read', 'grant-record'] as const)('releases the writer after rejected %s preflight and accepts a later valid plan', async failure => {
    const root = await mkdtemp(join(tmpdir(), 'agon-authority-preflight-'));
    const healthy = new TransactionalTrustGrantService(root);
    const initial = preview(healthy);
    await healthy.apply(initial, { approvedPlanHash: initial.planHash });
    const journalsBefore = await readdir(healthy.paths.transactions);
    const receiptsBefore = await readdir(healthy.paths.receipts);
    const readFailure = new Error('fixture authority sequence read failed');
    const service = new TransactionalTrustGrantService(root, { io: { ...nodeHostIo,
      readdir: async (path, options) => {
        if (failure === 'sequence-read' && path === healthy.store.paths.trust) throw readFailure;
        return nodeHostIo.readdir(path, options);
      },
    } });
    const plan = failure === 'grant-record' ? service.store.previewGrant({
      modId: 'example.tx', contentHash: hash('a'), capability: 'fixture.read', resources: ['fixture'],
      decision: 'allow', grantedAt: '2026-09-03T00:00:00.000Z', grantedBy: 'local-user', reason: 'fixture',
    }) : preview(service);
    let input = failure === 'plan-hash' ? { ...plan, planHash: hash('0') } : plan;
    if (failure === 'grant-record') {
      const { planHash: _planHash, ...unsigned } = plan;
      const invalid = { ...unsigned, record: { ...plan.record, resources: ['fixture', 'fixture'] } };
      input = { ...invalid, planHash: sha256Canonical(invalid) };
    }
    const result = service.apply(input, { approvedPlanHash: failure === 'approval' ? hash('0') : input.planHash });
    if (failure === 'sequence-read') await expect(result).rejects.toBe(readFailure);
    else await expect(result).rejects.toThrow(failure === 'approval' ? 'approval does not match'
      : failure === 'grant-record' ? 'grant resources must be unique' : 'plan hash mismatch');
    await expect(stat(service.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await healthy.store.readTrust()).map(record => record.recordId)).toEqual([initial.record.recordId]);
    expect(await healthy.store.readGrants()).toEqual([]);
    expect(await readdir(healthy.paths.transactions)).toEqual(journalsBefore);
    expect(await readdir(healthy.paths.receipts)).toEqual(receiptsBefore);
    await expect(healthy.apply(plan, { approvedPlanHash: plan.planHash })).resolves.toMatchObject({ outcome: 'committed' });
    expect([...(await healthy.store.readTrust()), ...(await healthy.store.readGrants())].map(record => record.sequence).sort()).toEqual([1, 2]);
  });

  it('retains rejected preflight and release errors without publishing authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-authority-preflight-release-'));
    const cleanupFailure = new Error('fixture cleanup failed');
    const writer = join(root, 'locks', 'writer.json');
    const service = new TransactionalTrustGrantService(root, { io: { ...nodeHostIo,
      rm: async (path, options) => { if (path === writer) throw cleanupFailure; return nodeHostIo.rm(path, options); },
    } });
    const failure = await service.apply(preview(service), { approvedPlanHash: hash('0') }).then(() => undefined, error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toBeInstanceOf(TypeError);
    expect(failure.errors[0].message).toContain('approval does not match');
    expect(failure.errors[1]).toBe(cleanupFailure);
    expect(await service.store.readTrust()).toEqual([]);
    expect(await service.store.readGrants()).toEqual([]);
    expect(await readdir(service.paths.transactions)).toEqual([]);
    expect(await readdir(service.paths.receipts)).toEqual([]);
    expect((await stat(writer)).isFile()).toBe(true);
  });

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
