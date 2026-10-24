import { mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { applyManagedPurge, previewManagedPurge, recoverManagedLifecycle } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

const tx = '11111111-1111-4111-8111-111111111111';
const installationId = 'a'.repeat(32);

describe('lifecycle lock cleanup failures', () => {
  it.each(['purge', 'recovery'] as const)('%s preserves operation and cleanup failures and attempts both lock releases', async operation => {
    for (const lock of ['host', 'lifecycle', 'both'] as const) {
      for (const phase of ['remove', 'sync'] as const) {
        for (const operationFails of [false, true]) {
          const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-release-'));
          const hostLockPath = join(root, 'locks', 'writer.json');
          const lifecycleLockPath = join(root, 'locks', 'lifecycle-writer.json');
          const failingLocks = lock === 'both' ? [hostLockPath, lifecycleLockPath] : [lock === 'host' ? hostLockPath : lifecycleLockPath];
          const data = join(root, 'data');
          const cleanupFailures = new Map(failingLocks.map(path => [path, new Error(`${basename(path)} ${phase} failed`)]));
          const operationFailure = new Error('operation failed');
          const releases: string[] = [];
          let removedLock: string | undefined;
          let cleanupArmed = operation === 'purge';
          const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
            rm: async (path, options) => {
              if (cleanupArmed && [hostLockPath, lifecycleLockPath].includes(path)) {
                releases.push(path);
                if (failingLocks.includes(path) && phase === 'remove') throw cleanupFailures.get(path);
                await nodeHostIo.rm(path, options);
                removedLock = path;
                return;
              }
              return nodeHostIo.rm(path, options);
            },
            syncDirectory: async path => {
              if (path === dirname(hostLockPath) && removedLock && failingLocks.includes(removedLock) && phase === 'sync') throw cleanupFailures.get(removedLock);
              return nodeHostIo.syncDirectory(path);
            },
            rename: async (from, to) => {
              if (operation === 'purge' && operationFails && from === data) throw operationFailure;
              return nodeHostIo.rename(from, to);
            },
            readdir: async (path, options) => {
              if (operation === 'recovery' && path === join(root, 'installation-transactions')) {
                cleanupArmed = true;
                if (operationFails) throw operationFailure;
              }
              return nodeHostIo.readdir(path, options);
            },
          } });
          await host.initialize();
          await writeFile(data, 'fixture');
          const plan = await previewManagedPurge(host, { dataPaths: [data] });
          const result = operation === 'purge'
            ? applyManagedPurge(host, plan, plan.planHash)
            : recoverManagedLifecycle(host);
          const failure = await result.then(() => undefined, error => error);
          expect(failure, `${operation}/${lock}/${phase}/${operationFails}`).toBeDefined();
          const expectedErrors = [...(operationFails ? [operationFailure] : []), ...failingLocks.map(path => cleanupFailures.get(path))];
          if (expectedErrors.length > 1) expect(failure).toBeInstanceOf(AggregateError);
          const errors = failure instanceof AggregateError ? failure.errors : [failure];
          expect(errors).toHaveLength(expectedErrors.length);
          expectedErrors.forEach((error, index) => expect(errors[index]).toBe(error));
          expect(releases).toEqual([hostLockPath, lifecycleLockPath]);
          for (const path of [hostLockPath, lifecycleLockPath]) {
            if (phase === 'remove' && failingLocks.includes(path)) expect((await stat(path)).isFile()).toBe(true);
            else await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
          }
          if (operation === 'purge' && !operationFails) await expect(stat(data)).rejects.toMatchObject({ code: 'ENOENT' });
          else expect(await readFile(data, 'utf8')).toBe('fixture');
        }
      }
    }
  });

  it.each(['purge', 'recovery'] as const)('%s preserves a competing host writer when lifecycle release also fails', async operation => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-partial-'));
    const lifecyclePath = join(root, 'locks', 'lifecycle-writer.json');
    const cleanupFailure = new Error('lifecycle release failed');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rm: async (path, options) => {
        if (path === lifecyclePath) throw cleanupFailure;
        return nodeHostIo.rm(path, options);
      },
    } });
    await host.initialize();
    const plan = await previewManagedPurge(host);
    const other = await WriterFence.acquire(host.paths.writerLock, 'other.writer');
    const before = await readFile(host.paths.writerLock);
    try {
      const result = operation === 'purge' ? applyManagedPurge(host, plan, plan.planHash) : recoverManagedLifecycle(host);
      const failure = await result.then(() => undefined, error => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors).toHaveLength(2);
      expect(failure.errors[0]).toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(failure.errors[1]).toBe(cleanupFailure);
      expect(await readFile(host.paths.writerLock)).toEqual(before);
    } finally { await other.release(); }
  });
});
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
  it('reclaims a dead host writer and finishes the selected host journal before installation recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-host-first-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const installed = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const hostJournalPath = host.journalPath(installed.pointer.transactionId);
    const hostJournal = JSON.parse(await readFile(hostJournalPath, 'utf8'));
    await writeFile(hostJournalPath, JSON.stringify({ ...hostJournal, state: 'verified',
      steps: hostJournal.steps.map((step: { id: string; state: string }) => step.id === 'cleanup' ? { ...step, state: 'pending' } : step),
    }));
    const lifecycleJournalPath = join(service.journalsRoot, `${installed.receipt.transactionId}.json`);
    const journal = JSON.parse(await readFile(lifecycleJournalPath, 'utf8'));
    await writeFile(lifecycleJournalPath, JSON.stringify({ ...journal, state: 'verified', selectedGeneration: null }));
    await WriterFence.acquire(host.paths.writerLock, 'test.dead-host-writer', { pid: 999_999 });
    const result = await recoverManagedLifecycle(host, { isProcessAlive: async () => false });
    expect(result.recoveredCommitted).toEqual([installed.receipt.transactionId]);
    expect(JSON.parse(await readFile(hostJournalPath, 'utf8')).state).toBe('committed');
    expect((await host.boot()).mode).toBe('normal');
    expect(await host.readCurrentPointer()).toEqual(installed.pointer);
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['committed', 'rolled-back'].flatMap(outcome => ['write', 'partial-write', 'sync-file', 'sync-directory', 'journal-sync'].map(fault => ({ outcome, fault }))))
    ('repairs a missing or unsynced $outcome recovery receipt after $fault failure without repeating effects', async ({ outcome, fault }) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-receipt-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    let transactionId = tx;
    const service = new ManagedLifecycleService(host);
    const installed = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    if (outcome === 'committed') {
      transactionId = installed.receipt.transactionId;
      const path = join(service.journalsRoot, `${transactionId}.json`);
      const journal = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...journal, state: 'verified', selectedGeneration: null }));
    } else {
      await writeJournal(root, 'verified');
      await mkdir(join(root, 'installations', installationId), { recursive: true });
    }
    const receipt = join(root, 'installation-receipts', `${transactionId}.recovered-${outcome}.json`);
    const isReceiptWrite = (path: string) => path === receipt || path.startsWith(join(dirname(receipt), `.${basename(receipt)}.`));
    const fail = () => { throw Object.assign(new Error('disk full writing receipt'), { code: 'ENOSPC' }); };
    await expect(recoverManagedLifecycle(host, { io: { ...nodeHostIo, writeFile: async (path, data, options) => {
      if ((fault === 'write' || fault === 'partial-write') && isReceiptWrite(path)) {
        if (fault === 'partial-write') await nodeHostIo.writeFile(path, '{', options);
        fail();
      }
      return nodeHostIo.writeFile(path, data, options);
    }, syncFile: async path => {
      if (fault === 'sync-file' && isReceiptWrite(path)) fail();
      return nodeHostIo.syncFile(path);
    }, syncDirectory: async path => {
      if (fault === 'sync-directory' && path === join(root, 'installation-receipts')) fail();
      if (fault === 'journal-sync' && path === join(root, 'installation-transactions')) fail();
      return nodeHostIo.syncDirectory(path);
    } } })).rejects.toMatchObject({ code: 'ENOSPC' });
    const journalBefore = await readFile(join(root, 'installation-transactions', `${transactionId}.json`), 'utf8');
    const sentinel = join(root, 'installations', installationId, 'new-data');
    if (outcome === 'rolled-back') {
      await mkdir(join(root, 'installations', installationId), { recursive: true });
      await writeFile(sentinel, 'do not delete again');
      await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    }
    const pointerBefore = await host.readCurrentPointer();
    const synced: string[] = [];
    await recoverManagedLifecycle(host, { io: { ...nodeHostIo,
      syncFile: async path => { synced.push(path); return nodeHostIo.syncFile(path); },
      syncDirectory: async path => { synced.push(path); return nodeHostIo.syncDirectory(path); },
    } });
    expect(synced.some(isReceiptWrite)).toBe(true);
    const journalPath = join(root, 'installation-transactions', `${transactionId}.json`);
    expect(synced).toContain(journalPath);
    expect(synced).toContain(dirname(journalPath));
    expect(synced.indexOf(journalPath)).toBeLessThan(synced.findIndex(isReceiptWrite));
    expect(synced.indexOf(dirname(journalPath))).toBeLessThan(synced.findIndex(isReceiptWrite));
    expect(synced).toContain(join(root, 'installation-receipts'));
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({ transactionId,
      outcome: `recovered-${outcome}`, selectedGeneration: installed.pointer.generation });
    expect(await readFile(join(root, 'installation-transactions', `${transactionId}.json`), 'utf8')).toBe(journalBefore);
    expect(await host.readCurrentPointer()).toEqual(pointerBefore);
    if (outcome === 'rolled-back') expect(await readFile(sentinel, 'utf8')).toBe('do not delete again');
    const receiptBefore = await readFile(receipt, 'utf8');
    expect(await recoverManagedLifecycle(host)).toMatchObject({ recoveredCommitted: [], recoveredRolledBack: [] });
    expect(await readFile(receipt, 'utf8')).toBe(receiptBefore);
  });

  it.each([false, true])('syncs rollback removal parents before its terminal journal (targets exist=%s)', async exists => {
    const root = await mkdtemp(join(tmpdir(), 'agon-recovery-removal-sync-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    await writeJournal(root, 'verified');
    const parents = [join(root, 'installation-staging'), join(root, 'installations')];
    if (exists) {
      await mkdir(join(parents[0], tx), { recursive: true });
      await mkdir(join(parents[1], installationId), { recursive: true });
    }
    const events: string[] = [];
    const journalPath = join(root, 'installation-transactions', `${tx}.json`);
    await recoverManagedLifecycle(host, { io: { ...nodeHostIo,
      syncDirectory: async path => { events.push(`sync:${path}`); await nodeHostIo.syncDirectory(path); },
      rename: async (from, to) => { if (to === journalPath) events.push('terminal-journal'); await nodeHostIo.rename(from, to); },
    } });
    const terminal = events.indexOf('terminal-journal');
    expect(terminal).toBeGreaterThanOrEqual(0);
    for (const parent of parents) {
      const synced = events.indexOf(`sync:${parent}`);
      expect(synced).toBeGreaterThanOrEqual(0);
      expect(synced).toBeLessThan(terminal);
    }
  });

  it.each(['partial JSON', 'transactionId', 'outcome', 'installationId', 'selectedGeneration'])
    ('refuses an existing recovery receipt with invalid %s without replacing it', async field => {
      const root = await mkdtemp(join(tmpdir(), 'agon-recovery-receipt-corrupt-'));
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      const service = new ManagedLifecycleService(host);
      const installed = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
      const journalPath = join(service.journalsRoot, `${installed.receipt.transactionId}.json`);
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      await writeFile(journalPath, JSON.stringify({ ...journal, state: 'verified', selectedGeneration: null }));
      await recoverManagedLifecycle(host);
      const receiptPath = join(root, 'installation-receipts', `${installed.receipt.transactionId}.recovered-committed.json`);
      const bytes = await readFile(receiptPath, 'utf8');
      const bad = { ...JSON.parse(bytes), [field]: field === 'selectedGeneration' ? 999 : 'different' };
      const observed = field === 'partial JSON' ? '{' : JSON.stringify(bad);
      let writes = 0;
      await expect(recoverManagedLifecycle(host, { io: { ...nodeHostIo,
        readFile: async path => path === receiptPath ? Buffer.from(observed) : nodeHostIo.readFile(path),
        writeFile: async (path, data, options) => {
          if (path === receiptPath) writes++;
          return nodeHostIo.writeFile(path, data, options);
        },
      } })).rejects.toMatchObject({ code: 'MOD_SAFE_MODE' });
      expect(writes).toBe(0);
      expect(await readFile(receiptPath, 'utf8')).toBe(bytes);
      expect(await host.readCurrentPointer()).toEqual(installed.pointer);
    });

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
  it.each([1, 2, 3].flatMap(failedWrite => [false, true].map(partial => ({ failedWrite, partial }))))
    ('retries a purge journal ENOSPC at write $failedWrite (partial=$partial) without repeating target selection', async ({ failedWrite, partial }) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-enospc-'));
    const target = join(root, 'data');
    let writes = 0;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: {
      ...nodeHostIo,
      writeFile: async (path, data, options) => {
        if (path.startsWith(join(root, 'purge-transactions') + '/') && ++writes === failedWrite) {
          if (partial) await nodeHostIo.writeFile(path, '{', options);
          throw Object.assign(new Error('fixture purge journal full'), { code: 'ENOSPC' });
        }
        await nodeHostIo.writeFile(path, data, options);
      },
    } });
    await host.initialize();
    await mkdir(target);
    await writeFile(join(target, 'value'), 'original');
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toMatchObject({ code: 'ENOSPC' });
    if (failedWrite === 1) expect(await readFile(join(target, 'value'), 'utf8')).toBe('original');
    else {
      await mkdir(target);
      await writeFile(join(target, 'value'), 'replacement');
    }
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    if (failedWrite === 1) await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(join(target, 'value'), 'utf8')).toBe('replacement');
  });

  it.each(['duplicate', 'parent-child'])('rejects %s targets before purge effects', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-overlap-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const parent = join(root, 'data');
    const child = join(parent, 'child');
    await mkdir(child, { recursive: true });
    const paths = kind === 'duplicate' ? [parent, `${parent}/../data`] : [parent, child];
    await expect(previewManagedPurge(host, { dataPaths: paths })).rejects.toThrow('distinct and non-overlapping');
    const { planHash: _hash, ...empty } = await previewManagedPurge(host);
    const unsigned = { ...empty, dataPaths: paths };
    const plan = { ...unsigned, planHash: sha256Canonical(unsigned) };
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow('distinct and non-overlapping');
    expect((await stat(child)).isDirectory()).toBe(true);
  });

  it.each(['after-move', 'before-remove', 'after-remove'].flatMap(boundary => [false, true].map(selected => ({ boundary, selected }))))
    ('recovers a real process kill at purge $boundary (selected generation=$selected)', async ({ boundary, selected }) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-kill-'));
    const target = join(root, 'data');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    if (selected) await host.commitGeneration({ operation: 'install', lock: lifecycleLock([]), desiredState: {}, installedIndex: {} });
    await mkdir(target);
    await writeFile(join(target, 'old'), 'original');
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    const entry = new URL('../../packages/mod-kernel/dist/index.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DurableModHost, applyManagedPurge } from ${JSON.stringify(entry)};
      const root = ${JSON.stringify(root)}, target = ${JSON.stringify(target)}, boundary = ${JSON.stringify(boundary)};
      const base = new DurableModHost(root, { kernelVersion: '1.0.0' });
      const io = base.hostIo;
      const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...io,
        rename: async (from, to) => {
          await io.rename(from, to);
          if (boundary === 'after-move' && from === target) process.kill(process.pid, 'SIGKILL');
        },
        rm: async (path, options) => {
          const staged = path.startsWith(root + '/purge-staging/') && path.endsWith('/0');
          if (staged && boundary === 'before-remove') process.kill(process.pid, 'SIGKILL');
          await io.rm(path, options);
          if (staged && boundary === 'after-remove') process.kill(process.pid, 'SIGKILL');
        },
      } });
      const plan = ${JSON.stringify(plan)};
      await applyManagedPurge(host, plan, plan.planHash);
    `], { encoding: 'utf8', timeout: 10_000 });
    expect(child.error).toBeUndefined();
    expect(child.signal, child.stderr).toBe('SIGKILL');
    await mkdir(target);
    await writeFile(join(target, 'new'), 'replacement');
    await recoverManagedLifecycle(host);
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    expect(await readFile(join(target, 'new'), 'utf8')).toBe('replacement');
    const journal = JSON.parse(await readFile(join(root, 'purge-transactions', `${plan.transactionId}.json`), 'utf8'));
    expect(journal).toEqual({ schemaVersion: 1, planHash: plan.planHash, phases: ['removed'] });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires a fresh preview for a legacy purge approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-legacy-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const target = join(root, 'data');
    await mkdir(target);
    const plan = { ...await previewManagedPurge(host, { dataPaths: [target] }) };
    Reflect.set(plan, 'schemaVersion', 1);
    Reflect.deleteProperty(plan, 'transactionId');
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow('fresh version-2 approval');
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('checks every pending target before removing the first target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-preflight-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const first = join(root, 'a-data');
    const last = join(root, 'z-data');
    await mkdir(first);
    await mkdir(last);
    await writeFile(join(first, 'keep'), 'unchanged');
    const plan = await previewManagedPurge(host, { dataPaths: [first, last] });
    await rename(last, join(root, 'original-z-data'));
    await symlink(host.paths.generations, last);
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow(/symbolic|symlink/);
    expect(await readFile(join(first, 'keep'), 'utf8')).toBe('unchanged');
  });

  it.each(['json', 'shape', 'phase', 'hash'])('refuses a corrupt purge journal: %s', async corruption => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-journal-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const target = join(root, 'data');
    await mkdir(target);
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    const record = { schemaVersion: 1, planHash: plan.planHash, phases: ['pending'] };
    const bytes = corruption === 'json' ? '{broken' : JSON.stringify(corruption === 'shape' ? { ...record, injected: true }
      : corruption === 'phase' ? { ...record, phases: ['unknown'] } : { ...record, planHash: `sha256:${'0'.repeat(64)}` });
    const path = join(root, 'purge-transactions', `${plan.transactionId}.json`);
    await mkdir(dirname(path));
    await writeFile(path, bytes);
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await stat(target)).isDirectory()).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it.each(['after-move', 'before-remove', 'after-remove'] as const)('resumes purge after %s without deleting replacement data', async boundary => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-resume-'));
    const target = join(root, 'old-data');
    let interrupted = false;
    const failure = new Error(`fixture ${boundary}`);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: {
      ...nodeHostIo,
      rename: async (from, to) => {
        await nodeHostIo.rename(from, to);
        if (!interrupted && boundary === 'after-move' && from === target) { interrupted = true; throw failure; }
      },
      rm: async (path, options) => {
        if (!interrupted && path.startsWith(join(root, 'purge-staging') + '/') && path.endsWith('/0')) {
          if (boundary === 'before-remove') { interrupted = true; throw failure; }
          if (boundary === 'after-remove') { await nodeHostIo.rm(path, options); interrupted = true; throw failure; }
        }
        await nodeHostIo.rm(path, options);
      },
    } });
    await host.initialize();
    await mkdir(target);
    await writeFile(join(target, 'original'), 'old');
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow(failure.message);
    expect(interrupted).toBe(true);
    await mkdir(target);
    await writeFile(join(target, 'replacement'), 'keep');
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    expect(await readFile(join(target, 'replacement'), 'utf8')).toBe('keep');
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    expect(await readFile(join(target, 'replacement'), 'utf8')).toBe('keep');
    const next = await previewManagedPurge(host, { dataPaths: [target] });
    expect(next.planHash).not.toBe(plan.planHash);
    expect(await applyManagedPurge(host, next, next.planHash)).toEqual([target]);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not reuse a completed approval for recreated data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-repeat-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const target = join(root, 'data');
    await mkdir(target);
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    await mkdir(target);
    await writeFile(join(target, 'new'), 'keep');
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    expect(await readFile(join(target, 'new'), 'utf8')).toBe('keep');
  });

  it.each([false, true])('handles a generation change after quarantine (pending targets=%s)', async pending => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-generation-retry-'));
    const target = join(root, 'a-data');
    const later = join(root, 'z-data');
    let interrupted = false;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rm: async (path, options) => {
        if (!interrupted && path.startsWith(join(root, 'purge-staging') + '/') && path.endsWith('/0')) {
          interrupted = true;
          throw new Error('fixture interrupted after quarantine');
        }
        await nodeHostIo.rm(path, options);
      },
    } });
    await host.initialize();
    await mkdir(target);
    await writeFile(join(target, 'old'), 'original');
    if (pending) await mkdir(later);
    const plan = await previewManagedPurge(host, { dataPaths: pending ? [target, later] : [target] });
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow('interrupted after quarantine');
    await mkdir(target);
    await writeFile(join(target, 'new'), 'replacement');
    const selected = await host.commitGeneration({ operation: 'install', lock: lifecycleLock([]), desiredState: {}, installedIndex: {} });
    const staged = join(root, 'purge-staging', plan.transactionId, '0');
    if (pending) {
      await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
      expect((await stat(later)).isDirectory()).toBe(true);
      expect(await readFile(join(staged, 'old'), 'utf8')).toBe('original');
    } else {
      expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
      await expect(stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    }
    expect(await readFile(join(target, 'new'), 'utf8')).toBe('replacement');
    expect(await host.readCurrentPointer()).toEqual(selected.pointer);
  });

  it('blocks purge during a host write and permits retry after the writer releases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-writer-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const target = join(root, 'old-data');
    await mkdir(target);
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    const writer = await WriterFence.acquire(host.paths.writerLock, 'test.host-writer');
    try {
      await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect((await stat(target)).isDirectory()).toBe(true);
      await writer.assertOwned();
    } finally {
      await writer.release();
    }
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a symbolic-link alias of kernel state during preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-link-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const alias = join(root, 'data-alias');
    await symlink(host.paths.generations, alias);
    await expect(previewManagedPurge(host, { dataPaths: [alias] })).rejects.toThrow(/symbolic|symlink/);
  });

  it('rejects an ancestor link introduced after preview and preserves its target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'agon-purge-link-target-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const data = join(root, 'data');
    const target = join(data, 'target');
    await mkdir(target, { recursive: true });
    await mkdir(join(outside, 'target'));
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    await rename(data, join(root, 'original-data'));
    await symlink(outside, data);
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow(/symbolic|symlink/);
    expect((await stat(join(outside, 'target'))).isDirectory()).toBe(true);
    expect((await stat(join(root, 'original-data', 'target'))).isDirectory()).toBe(true);
  });

  it.each(['generations', 'generations/0000000000000001', 'leases', 'receipts', 'transactions',
    'staging', 'current-generation.json', 'installed-index.json', 'desired-state.json', 'locks',
    'locks/writer.json', 'installations', 'installations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'installation-staging', 'installation-transactions', 'installation-receipts', 'purge-transactions', 'purge-staging', 'pending-authority',
    'trust', 'trust/record.json', 'grants', 'grants/record.json', 'authority-owned-by-local-user',
    'PENDING-AUTHORITY', 'PURGE-TRANSACTIONS', 'Generations', 'LOCKS/writer.json'])
    ('refuses kernel-managed data target %s during preview and apply', async target => {
      const root = await mkdtemp(join(tmpdir(), 'agon-purge-protected-'));
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      await host.initialize();
      const path = join(root, target);
      await expect(previewManagedPurge(host, { dataPaths: [path] })).rejects.toThrow('kernel-managed');
      const { planHash: _hash, ...unsigned } = await previewManagedPurge(host);
      const changed = { ...unsigned, dataPaths: [path] };
      const plan = { ...changed, planHash: sha256Canonical(changed) };
      await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow('kernel-managed');
      expect((await stat(host.paths.generations)).isDirectory()).toBe(true);
    });

  it('rejects a correctly hashed plan that disguises kernel state as an installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-protected-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const { planHash: _hash, ...unsigned } = await previewManagedPurge(host);
    const changed = { ...unsigned, installationPaths: [host.paths.generations] };
    const plan = { ...changed, planHash: sha256Canonical(changed) };
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toThrow('installation path');
    expect((await stat(host.paths.generations)).isDirectory()).toBe(true);
  });

  it('rejects a changed target with the original approval hash before deleting anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-approval-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const approved = join(root, 'approved');
    const other = join(root, 'other');
    await mkdir(approved);
    await mkdir(other);
    const plan = await previewManagedPurge(host, { dataPaths: [approved] });
    await expect(applyManagedPurge(host, { ...plan, dataPaths: [other] }, plan.planHash))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await stat(approved)).isDirectory()).toBe(true);
    expect((await stat(other)).isDirectory()).toBe(true);
  });

  it('retains approved targets when the caller changes its plan during lock acquisition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-approval-'));
    let mutate: (() => void) | undefined;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: {
      ...nodeHostIo,
      writeFile: async (path, data, options) => {
        if (path === join(root, 'locks', 'lifecycle-writer.json')) mutate?.();
        return nodeHostIo.writeFile(path, data, options);
      },
    } });
    await host.initialize();
    const approved = join(root, 'approved');
    const other = join(root, 'other');
    await mkdir(approved);
    await mkdir(other);
    const preview = await previewManagedPurge(host, { dataPaths: [approved] });
    const plan = { ...preview, dataPaths: [...preview.dataPaths] };
    mutate = () => { plan.dataPaths[0] = other; };
    expect(await applyManagedPurge(host, plan, preview.planHash)).toEqual([approved]);
    await expect(stat(approved)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(other)).isDirectory()).toBe(true);
  });

  it('rejects installation-target substitution with the original approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-installation-approval-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const approvedId = 'c'.repeat(32);
    const otherId = 'd'.repeat(32);
    const approved = join(root, 'installations', approvedId);
    const other = join(root, 'installations', otherId);
    await mkdir(approved, { recursive: true });
    await mkdir(other);
    const plan = await previewManagedPurge(host, { installationIds: [approvedId] });
    await expect(applyManagedPurge(host, { ...plan, installationPaths: [other] }, plan.planHash))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await stat(approved)).isDirectory()).toBe(true);
    expect((await stat(other)).isDirectory()).toBe(true);
  });

  it.each(['before approval', 'during lock acquisition'])('rejects selected-generation substitution %s', async when => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-generation-approval-'));
    let mutate: (() => void) | undefined;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: {
      ...nodeHostIo,
      writeFile: async (path, data, options) => {
        if (path === join(root, 'locks', 'lifecycle-writer.json')) mutate?.();
        return nodeHostIo.writeFile(path, data, options);
      },
    } });
    await host.initialize();
    const target = join(root, 'approved-data');
    await mkdir(target);
    const plan = { ...await previewManagedPurge(host, { dataPaths: [target] }) };
    const service = new ManagedLifecycleService(host);
    const installed = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    expect(installed.pointer.generation).not.toBe(plan.selectedGeneration);
    const replaceGeneration = () => { plan.selectedGeneration = installed.pointer.generation; };
    if (when === 'before approval') replaceGeneration();
    else mutate = replaceGeneration;
    await expect(applyManagedPurge(host, plan, plan.planHash)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(plan.selectedGeneration).toBe(installed.pointer.generation);
    expect((await stat(target)).isDirectory()).toBe(true);
    expect((await host.readCurrentPointer())?.generation).toBe(installed.pointer.generation);
  });

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
