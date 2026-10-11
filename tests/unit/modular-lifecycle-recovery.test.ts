import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { applyManagedPurge, previewManagedPurge, recoverManagedLifecycle } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

const tx = '11111111-1111-4111-8111-111111111111';
const installationId = 'a'.repeat(32);
const hash = `sha256:${'b'.repeat(64)}`;

async function writeStaleLock(root: string): Promise<void> {
  await mkdir(join(root, 'locks'), { recursive: true });
  await writeFile(join(root, 'locks', 'lifecycle-writer.json'), JSON.stringify({
    schemaVersion: 1,
    ownerId: 'dead-writer',
    pid: 999_999,
    processIdentity: 'dead-process',
    fenceToken: 'dead-fence',
    createdAt: '2026-01-01T00:00:00.000Z',
    heartbeatAt: '2026-01-01T00:00:00.000Z',
  }));
}

async function writeJournal(root: string, state: 'preparing' | 'verified'): Promise<void> {
  await mkdir(join(root, 'installation-transactions'), { recursive: true });
  await writeFile(join(root, 'installation-transactions', `${tx}.json`), JSON.stringify({
    schemaVersion: 1,
    transactionId: tx,
    state,
    planHash: hash,
    baseGeneration: 0,
    installationId,
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fenceToken: 'dead-fence',
    steps: [],
    selectedGeneration: null,
  }));
}

describe('managed lifecycle crash recovery', () => {
  it.each([false, true])('keeps prefixes referenced by retained generations (concurrent rollback=%s)', async concurrent => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-retained-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const entry = artifact('@test/app', [], { version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0',
      contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}` });
    const installed = await service.apply(await createManagedLifecyclePlan(host, request([entry], {
      operation: 'update', lock: lifecycleLock([entry], '9'),
    })), installer, verifier);
    const journalPath = join(service.journalsRoot, `${installed.receipt.transactionId}.json`);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'verified', selectedGeneration: null }));
    await service.rollback(1);
    if (concurrent) {
      let entered!: () => void; let release!: () => void; let paused = false;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { release = resolve; });
      const recovery = recoverManagedLifecycle(host, { io: { ...nodeHostIo, readFile: async path => {
        if (!paused && path.startsWith(host.paths.generations) && path.endsWith('/installation.json')) {
          paused = true; entered(); await pending;
        }
        return nodeHostIo.readFile(path);
      } } });
      await started;
      try { await expect(service.rollback(2)).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' }); }
      finally { release(); await recovery; }
    } else await recoverManagedLifecycle(host);
    await service.rollback(2);
    expect((await service.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
    expect((await host.boot()).mode).toBe('normal');
    expect(await recoverManagedLifecycle(host)).toMatchObject({ recoveredCommitted: [], recoveredRolledBack: [] });
  });

  it.each(['preparing', 'verified'] as const)('rolls back abandoned %s staging and immutable-prefix bytes', async (state) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-recovery-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await writeStaleLock(root);
    await writeJournal(root, state);
    for (const path of [join(root, 'installation-staging', tx), join(root, 'installations', installationId)]) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'partial'), 'partial');
    }
    const result = await recoverManagedLifecycle(host, { isProcessAlive: async () => false });
    expect(result.recoveredRolledBack).toEqual([tx]);
    await expect(stat(join(root, 'installation-staging', tx))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'installations', installationId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(root, 'installation-transactions', `${tx}.json`), 'utf8')).state).toBe('failed');
  });

  it('repairs a lifecycle journal when host generation promotion already committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-recovery-selected-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'host' });
    const service = new ManagedLifecycleService(host, { processIdentity: 'lifecycle' });
    const result = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const journals = await readdir(service.journalsRoot);
    const journalPath = join(service.journalsRoot, journals[0]!);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'verified', selectedGeneration: null }));
    await writeStaleLock(root);
    const recovered = await recoverManagedLifecycle(host, { isProcessAlive: async () => false });
    expect(recovered.recoveredCommitted).toEqual([journal.transactionId]);
    expect(recovered.selectedGeneration).toBe(result.pointer.generation);
    expect(JSON.parse(await readFile(journalPath, 'utf8')).state).toBe('committed');
  });

  it('fails into safe mode instead of guessing through a malformed journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-recovery-corrupt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await writeStaleLock(root);
    await mkdir(join(root, 'installation-transactions'), { recursive: true });
    await writeFile(join(root, 'installation-transactions', `${tx}.json`), '{broken');
    await expect(recoverManagedLifecycle(host, { isProcessAlive: async () => false })).rejects.toMatchObject({ code: 'MOD_SAFE_MODE' });
  });
});

describe('managed purge preview and apply', () => {
  it('requires an exact preview hash and never targets the selected installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-purge-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const selected = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    await expect(previewManagedPurge(host, { installationIds: [selected.installation.installationId] }))
      .rejects.toThrow('cannot target the selected');
    const oldId = 'c'.repeat(32);
    const oldPath = join(root, 'installations', oldId);
    await mkdir(oldPath, { recursive: true });
    await writeFile(join(oldPath, 'old'), 'old');
    const plan = await previewManagedPurge(host, { installationIds: [oldId] });
    await expect(applyManagedPurge(host, plan, `sha256:${'0'.repeat(64)}`)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([oldPath]);
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await service.readSelectedInstallation())?.installationId).toBe(selected.installation.installationId);
  });

  it('rejects broad, root, and escaping purge targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-purge-path-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await expect(previewManagedPurge(host, { dataPaths: [root] })).rejects.toThrow('escapes or equals');
    await expect(previewManagedPurge(host, { dataPaths: [join(root, '..', 'outside')] })).rejects.toThrow('escapes or equals');
  });
});
