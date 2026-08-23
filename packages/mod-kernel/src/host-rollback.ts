import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DurableModHost, type GenerationPointer, type HostTransactionJournal } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { atomicWrite, writeNewImmutableFile } from './host-io.js';
import { canonicalJson } from './lock.js';
import { WriterFence } from './writer-lock.js';

export interface RollbackGenerationOptions {
  readonly ownerId?: string;
  readonly now?: () => Date;
  readonly processIdentity?: string;
  readonly faultAfterPointer?: () => void | Promise<void>;
}

export async function rollbackGeneration(
  host: DurableModHost,
  targetGeneration: number,
  options: RollbackGenerationOptions = {},
): Promise<{ readonly pointer: GenerationPointer; readonly journal: HostTransactionJournal }> {
  await host.initialize();
  const now = options.now ?? (() => new Date());
  const fence = await WriterFence.acquire(host.paths.writerLock, options.ownerId ?? 'agon.kernel.rollback', {
    processIdentity: options.processIdentity,
    io: host.hostIo,
    now,
  });
  const rollbackState = await (async () => {
    const manifest = await host.validateGeneration(targetGeneration);
    const current = await host.readCurrentPointer();
    if (!current) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'rollback requires a selected base generation');
    if (current.generation === targetGeneration) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'rollback target is already selected');
    return { manifest, current };
  })().catch(async (error) => { await fence.release().catch(() => undefined); throw error; });
  const { manifest, current } = rollbackState;
  const transactionId = randomUUID();
  const startedAt = now().toISOString();
  let committed = false;
  let journal: HostTransactionJournal = Object.freeze({
    schemaVersion: 1,
    transactionId,
    operation: 'rollback',
    state: 'verified',
    startedAt,
    updatedAt: startedAt,
    baseGeneration: current.generation,
    candidateGeneration: targetGeneration,
    fenceToken: fence.record.fenceToken,
    previousLockHash: current.lockHash,
    candidateLockHash: manifest.lockHash,
    steps: Object.freeze([
      { id: 'verify-generation', state: 'passed' as const },
      { id: 'select-generation', state: 'pending' as const },
      { id: 'restore-snapshots', state: 'pending' as const },
    ]),
    rollback: Object.freeze({ attempted: true, completed: false }),
  });
  const journalPath = host.journalPath(transactionId);
  try {
    await atomicWrite(host.hostIo, journalPath, JSON.stringify(journal, null, 2) + String.fromCharCode(10));
    await fence.assertOwned();
    const pointer: GenerationPointer = Object.freeze({
      schemaVersion: 1,
      generation: targetGeneration,
      graphHash: manifest.graphHash,
      lockHash: manifest.lockHash,
      transactionId,
      selectedAt: now().toISOString(),
    });
    await atomicWrite(host.hostIo, host.paths.current, canonicalJson(pointer) + String.fromCharCode(10));
    committed = true;
    await options.faultAfterPointer?.();
    await atomicWrite(host.hostIo, host.paths.installedIndex, await host.hostIo.readFile(join(host.generationPath(targetGeneration), 'installed-index.json')));
    await atomicWrite(host.hostIo, host.paths.desiredState, await host.hostIo.readFile(join(host.generationPath(targetGeneration), 'desired-state.json')));
    journal = Object.freeze({
      ...journal,
      state: 'committed',
      updatedAt: now().toISOString(),
      steps: Object.freeze(journal.steps.map((step) => ({ ...step, state: 'passed' as const }))),
      rollback: Object.freeze({ attempted: true, completed: true }),
    });
    await atomicWrite(host.hostIo, journalPath, JSON.stringify(journal, null, 2) + String.fromCharCode(10));
    await writeNewImmutableFile(host.hostIo, join(host.paths.receipts, transactionId + '.committed.json'), JSON.stringify({
      schemaVersion: 1,
      transactionId,
      outcome: 'committed',
      ownerId: options.ownerId ?? 'agon.kernel.rollback',
      pointer,
      journal,
      events: [],
    }, null, 2) + String.fromCharCode(10));
    return Object.freeze({ pointer, journal });
  } catch (error) {
    if (committed) throw new DurableHostError('MOD_RESTART_REQUIRED', 'rollback pointer committed but snapshot restoration did not finish', {
      transactionId,
      targetGeneration,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await fence.release().catch(() => undefined);
  }
}
