import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { DurableModHost, type ArtifactGenerationLease, type GenerationLease, type GenerationPointer } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { atomicWrite, pathExists, readJson, type HostIo } from './host-io.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import type { ManagedInstallationRecord } from './managed-lifecycle.js';
import { makeTreeRemovable } from './removable-tree.js';
import { releaseLifecycleWriters, WriterFence } from './writer-lock.js';
import { parseGenerationPointer, parseHostTransactionJournal, parseGenerationRetirementEvidence, type GenerationRetirementEvidence } from './host-contracts.js';
import { parseGenerationCollectionPlan, parseGenerationRetirementJournal, readRetiredGenerations, validateRetirementDirectory, type ManagedGenerationCollectionPlan, type GenerationRetirementJournal } from './generation-retirement.js';
import { assertNoSymlinkComponents } from './folder-mod-bounds.js';
import { TrustGrantStore } from './trust-authority.js';

interface RecoverableLifecycleJournal {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly state: 'preparing' | 'verified' | 'committed' | 'failed';
  readonly planHash: `sha256:${string}`;
  readonly baseGeneration: number;
  readonly installationId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly fenceToken: string;
  readonly steps: readonly string[];
  readonly selectedGeneration: number | null;
}

export interface LifecycleRecoveryResult {
  readonly recoveredCommitted: readonly string[];
  readonly recoveredRolledBack: readonly string[];
  readonly selectedGeneration: number | null;
}

export interface LifecycleRecoveryOptions {
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly processIdentity?: string;
  readonly isProcessAlive?: (pid: number) => Promise<boolean>;
}

function parseJournal(value: unknown): RecoverableLifecycleJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('lifecycle journal must be an object');
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'transactionId', 'state', 'planHash', 'baseGeneration', 'installationId', 'startedAt', 'updatedAt', 'fenceToken', 'steps', 'selectedGeneration'];
  if (Object.keys(record).sort().join('\0') !== keys.sort().join('\0')) throw new TypeError('lifecycle journal has unknown or missing fields');
  if (record.schemaVersion !== 1 || typeof record.transactionId !== 'string' || !/^[a-f0-9-]{36}$/.test(record.transactionId)) throw new TypeError('lifecycle journal identity is malformed');
  if (!['preparing', 'verified', 'committed', 'failed'].includes(String(record.state))) throw new TypeError('lifecycle journal state is malformed');
  if (typeof record.planHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(record.planHash)) throw new TypeError('lifecycle journal plan hash is malformed');
  if (!Number.isSafeInteger(record.baseGeneration) || (record.baseGeneration as number) < 0) throw new TypeError('lifecycle journal base generation is malformed');
  if (typeof record.installationId !== 'string' || !/^[a-f0-9]{32}$/.test(record.installationId)) throw new TypeError('lifecycle journal installation ID is malformed');
  if (typeof record.startedAt !== 'string' || typeof record.updatedAt !== 'string' || typeof record.fenceToken !== 'string') throw new TypeError('lifecycle journal timestamps or fence are malformed');
  if (!Array.isArray(record.steps) || record.steps.some((step) => typeof step !== 'string')) throw new TypeError('lifecycle journal steps are malformed');
  if (record.selectedGeneration !== null && (!Number.isSafeInteger(record.selectedGeneration) || (record.selectedGeneration as number) < 1)) throw new TypeError('lifecycle selected generation is malformed');
  return Object.freeze(record) as unknown as RecoverableLifecycleJournal;
}

async function selectedInstallationId(host: DurableModHost, io: HostIo): Promise<{ generation: number | null; installationId: string | null }> {
  const pointer = await host.readCurrentPointer();
  if (!pointer) return { generation: null, installationId: null };
  const manifest = await host.validateGeneration(pointer.generation);
  if (!Object.hasOwn(manifest.files, 'installation.json')) return { generation: pointer.generation, installationId: null };
  try {
    const record = await readJson<ManagedInstallationRecord>(io, join(host.generationPath(pointer.generation), 'installation.json'));
    return { generation: pointer.generation, installationId: record.installationId };
  } catch (error) {
    throw new DurableHostError('MOD_SAFE_MODE', 'selected generation has no valid managed installation record', {
      generation: pointer.generation,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureRecoveryReceipt(io: HostIo, receipts: string, journal: RecoverableLifecycleJournal): Promise<boolean> {
  const committed = journal.state === 'committed';
  const outcome = committed ? 'recovered-committed' : 'recovered-rolled-back';
  const path = join(receipts, `${journal.transactionId}.${outcome}.json`);
  const receipt = {
    schemaVersion: 1,
    transactionId: journal.transactionId,
    outcome,
    selectedGeneration: journal.selectedGeneration,
    installationId: committed ? journal.installationId : null,
    recoveredAt: journal.updatedAt,
  };
  if (await pathExists(io, path)) {
    try {
      const existing = await readJson<Record<string, unknown>>(io, path);
      if (!existing || existing.schemaVersion !== 1 || existing.transactionId !== receipt.transactionId
        || existing.outcome !== outcome || existing.installationId !== receipt.installationId
        || typeof existing.recoveredAt !== 'string' || !Number.isFinite(Date.parse(existing.recoveredAt))
        || (committed && existing.selectedGeneration !== journal.selectedGeneration)
        || (existing.selectedGeneration !== null && (!Number.isSafeInteger(existing.selectedGeneration)
          || (existing.selectedGeneration as number) < 1))) throw new TypeError('receipt does not match recovery journal');
      // Older rollback journals did not retain the selected generation.
      if (!committed && journal.selectedGeneration !== null && existing.selectedGeneration !== journal.selectedGeneration) {
        throw new TypeError('receipt selected generation differs from recovery journal');
      }
    } catch (error) {
      throw new DurableHostError('MOD_SAFE_MODE', 'lifecycle recovery receipt is malformed or mismatched', {
        path, cause: error instanceof Error ? error.message : String(error),
      });
    }
    // A prior write can leave valid bytes before either durability sync fails.
    await io.syncFile(path);
    await io.syncDirectory(receipts);
    return false;
  }
  await atomicWrite(io, path, `${canonicalJson(receipt)}\n`, 0o400);
  return true;
}

export async function recoverManagedLifecycle(
  host: DurableModHost,
  options: LifecycleRecoveryOptions = {},
): Promise<LifecycleRecoveryResult> {
  const io = options.io ?? host.hostIo;
  const now = options.now ?? (() => new Date());
  const installations = join(host.root, 'installations');
  const staging = join(host.root, 'installation-staging');
  const journals = join(host.root, 'installation-transactions');
  const receipts = join(host.root, 'installation-receipts');
  const lockPath = join(host.root, 'locks', 'lifecycle-writer.json');
  for (const path of [installations, staging, journals, receipts]) await io.mkdir(path, { recursive: true, mode: 0o700 });
  const lockOptions = {
    io,
    now,
    processIdentity: options.processIdentity ?? `lifecycle-recovery-${process.pid}`,
    isProcessAlive: options.isProcessAlive,
  };
  const fence = await (await pathExists(io, lockPath)
    ? WriterFence.recoverStale(lockPath, 'agon.kernel.lifecycle.recovery', lockOptions)
    : WriterFence.acquire(lockPath, 'agon.kernel.lifecycle.recovery', lockOptions));
  const recoveredCommitted: string[] = [];
  const recoveredRolledBack: string[] = [];
  let hostFence: WriterFence | undefined;
  const operationErrors: unknown[] = [];
  try {
    // A dead generation writer must not block explicit transaction recovery.
    if (await pathExists(io, host.paths.writerLock)) {
      hostFence = await WriterFence.recoverStale(host.paths.writerLock, 'agon.kernel.lifecycle.recovery', lockOptions);
      await hostFence.release();
      hostFence = undefined;
    }
    // Host replay owns its fence. Finish generation journals before cleanup.
    await host.recoverTransactions();
    // Match lifecycle apply: installation lock first, then generation lock.
    hostFence = await WriterFence.acquire(host.paths.writerLock, 'agon.kernel.lifecycle.recovery', lockOptions);
    const selected = await selectedInstallationId(host, io);
    const referenced = await referencedInstallations(host, io);
    const entries = await io.readdir(journals, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const journalPath = join(journals, entry.name);
      let journal: RecoverableLifecycleJournal;
      try {
        journal = parseJournal(await readJson<unknown>(io, journalPath));
      } catch (error) {
        throw new DurableHostError('MOD_SAFE_MODE', `lifecycle recovery refused malformed journal: ${entry.name}`, {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (journal.state === 'committed' || journal.state === 'failed') {
        const marker = journal.state === 'committed' ? 'recovered-selected-generation' : 'recovered-prior-generation';
        if (journal.steps.at(-1) === marker) {
          // Repair a prior failure after the terminal journal rename.
          await io.syncFile(journalPath);
          await io.syncDirectory(journals);
          if (await ensureRecoveryReceipt(io, receipts, journal)) {
            (journal.state === 'committed' ? recoveredCommitted : recoveredRolledBack).push(journal.transactionId);
          }
        }
        continue;
      }
      const stagedPath = join(staging, journal.transactionId);
      const installedPath = join(installations, journal.installationId);
      const retained = referenced.get(journal.installationId);
      const committed = selected.installationId === journal.installationId || retained?.committed === true;
      if (!committed && retained) throw new DurableHostError('MOD_RESTART_REQUIRED', 'recover host generations before installation cleanup', {
        installationId: journal.installationId, generation: retained.generation,
      });
      if (committed) {
        const committedGeneration = selected.installationId === journal.installationId ? selected.generation : retained!.generation;
        const recovered = Object.freeze({
          ...journal,
          state: 'committed' as const,
          updatedAt: now().toISOString(),
          selectedGeneration: committedGeneration,
          steps: Object.freeze([...journal.steps, 'recovered-selected-generation']),
        });
        await atomicWrite(io, journalPath, `${canonicalJson(recovered)}\n`);
        await ensureRecoveryReceipt(io, receipts, recovered);
        recoveredCommitted.push(journal.transactionId);
      } else {
        for (const path of [stagedPath, installedPath]) {
          if (await pathExists(io, path)) {
            await makeTreeRemovable(io, path).catch(() => undefined);
            await io.rm(path, { recursive: true, force: true });
          }
          // Retry durability even when an earlier attempt removed the path.
          await io.syncDirectory(dirname(path));
        }
        const recovered = Object.freeze({
          ...journal,
          state: 'failed' as const,
          updatedAt: now().toISOString(),
          selectedGeneration: selected.generation,
          steps: Object.freeze([...journal.steps, 'recovered-prior-generation']),
        });
        await atomicWrite(io, journalPath, `${canonicalJson(recovered)}\n`);
        await ensureRecoveryReceipt(io, receipts, recovered);
        recoveredRolledBack.push(journal.transactionId);
      }
    }
    return Object.freeze({
      recoveredCommitted: Object.freeze(recoveredCommitted.sort()),
      recoveredRolledBack: Object.freeze(recoveredRolledBack.sort()),
      selectedGeneration: selected.generation,
    });
  } catch (error) {
    operationErrors.push(error);
    throw error;
  } finally {
    await releaseLifecycleWriters([hostFence, fence], operationErrors);
  }
}

export interface ManagedPurgePlan {
  readonly schemaVersion: 2;
  readonly transactionId: string;
  readonly selectedGeneration: number | null;
  readonly installationPaths: readonly string[];
  readonly dataPaths: readonly string[];
  readonly planHash: `sha256:${string}`;
}

function assertManagedPath(hostRoot: string, path: string): string {
  const absolute = resolve(path);
  const relation = relative(resolve(hostRoot), absolute);
  if (!relation || relation.startsWith('..')) throw new DurableHostError('MOD_TRANSACTION_FAILED', `purge path escapes or equals managed root: ${path}`);
  return absolute;
}

function assertPurgeDataPath(host: DurableModHost, path: string): string {
  const absolute = assertManagedPath(host.root, path);
  const protectedPaths = [...Object.values(host.paths),
    ...Object.values(new TrustGrantStore(host.root, host.hostIo).paths), dirname(host.paths.writerLock),
    ...['installations', 'installation-staging', 'installation-transactions', 'installation-receipts', 'purge-transactions', 'purge-staging', 'pending-authority']
      .map(name => join(host.root, name))];
  // Reserve the same namespaces on case-sensitive and case-insensitive hosts.
  const normalized = absolute.normalize('NFKC').toLowerCase();
  if (protectedPaths.some(path => {
    const protectedPath = path.normalize('NFKC').toLowerCase();
    return normalized === protectedPath || normalized.startsWith(protectedPath + sep)
      || protectedPath.startsWith(normalized + sep);
  })) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', `purge cannot target kernel-managed state: ${path}`);
  }
  return absolute;
}

function assertPurgeInstallationPath(host: DurableModHost, path: string): string {
  const absolute = assertManagedPath(host.root, path);
  if (dirname(absolute) !== join(host.root, 'installations') || !/^[a-f0-9]{32}$/.test(basename(absolute))) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', `invalid purge installation path: ${path}`);
  }
  return absolute;
}

function assertDistinctPurgeTargets(paths: readonly string[]): void {
  const selected = new Set(paths);
  const fail = () => { throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'purge targets must be distinct and non-overlapping'); };
  if (selected.size !== paths.length) fail();
  for (const path of paths) {
    for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
      if (selected.has(parent)) fail();
    }
  }
}

async function assertPurgeNoLinks(host: DurableModHost, path: string): Promise<void> {
  try {
    await assertNoSymlinkComponents(host.root, relative(host.root, path));
  } catch (error) {
    // An absent target needs no deletion. Existing ancestors were checked.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new DurableHostError('MOD_TRANSACTION_FAILED', `purge target inspection failed: ${String(error)}`, { path });
  }
}

async function retainedGenerationInventory(host: DurableModHost, io: HostIo) {
  const result = new Map<string, { generation: number; committed: boolean; generations: readonly number[] }>();
  const validatedGenerations = new Set<number>();
  const retainedGenerations: { generation: number; installationId: string | null; committed: boolean }[] = [];
  const entries = await io.readdir(host.paths.generations, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!/^\d{16}$/.test(entry.name)) continue;
    const generation = Number(entry.name);
    let record: ManagedInstallationRecord;
    let committed: boolean;
    try {
      if (!entry.isDirectory()) throw new TypeError('retained generation must be a real directory');
      await assertNoSymlinkComponents(host.root, relative(host.root, host.generationPath(generation)));
      // Missing declared files are corruption, not proof of no references.
      const manifest = await host.validateGeneration(generation);
      const journalPath = host.journalPath(manifest.transactionId);
      await assertNoSymlinkComponents(host.root, relative(host.root, journalPath));
      const transaction = parseHostTransactionJournal(await readJson<unknown>(io, journalPath));
      if (transaction.transactionId !== manifest.transactionId || transaction.candidateGeneration !== generation
        || transaction.candidateLockHash !== manifest.lockHash) throw new TypeError('retained generation journal identity does not match');
      committed = transaction.state === 'committed';
      validatedGenerations.add(generation);
      if (!Object.hasOwn(manifest.files, 'installation.json')) {
        retainedGenerations.push({ generation, installationId: null, committed });
        continue;
      }
      const installationPath = join(host.generationPath(generation), 'installation.json');
      await assertNoSymlinkComponents(host.root, relative(host.root, installationPath));
      const bytes = await io.readFile(installationPath);
      if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== manifest.files['installation.json']) {
        throw new TypeError('retained installation changed after generation validation');
      }
      record = JSON.parse(new TextDecoder().decode(bytes)) as ManagedInstallationRecord;
      if (!record || !/^[a-f0-9]{32}$/.test(record.installationId)) throw new TypeError('retained installation identity is invalid');
      retainedGenerations.push({ generation, installationId: record.installationId, committed });
    } catch (error) {
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot determine retained installation ownership', {
        generation, cause: error instanceof Error ? error.message : String(error),
      });
    }
    const previous = result.get(record.installationId);
    const generations = Object.freeze([...(previous?.generations ?? []), generation].sort((a, b) => a - b));
    if (!previous || (committed && !previous.committed) || (committed === previous.committed && generation > previous.generation)) {
      result.set(record.installationId, { generation, committed, generations });
    } else result.set(record.installationId, { ...previous, generations });
  }
  const activeLeases = await host.activeGenerationLeases();
  const artifactLeases = await host.activeArtifactGenerationLeases();
  for (const lease of [...activeLeases, ...artifactLeases]) {
    if (!validatedGenerations.has(lease.generation)) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'active lease refers to a missing generation', {
      leaseId: lease.leaseId, generation: lease.generation,
    });
  }
  return { installations: result, generations: retainedGenerations.sort((a, b) => a.generation - b.generation), activeLeases, artifactLeases };
}

export async function referencedInstallations(host: DurableModHost, io: HostIo = host.hostIo): Promise<Map<string, { generation: number; committed: boolean; generations: readonly number[] }>> {
  return (await retainedGenerationInventory(host, io)).installations;
}

export interface ManagedRetentionReport {
  readonly schemaVersion: 1;
  readonly rollbackWindow?: {
    readonly durationMs: number;
    readonly observedAt: string;
    /** Window expiry alone does not authorize collection. Other references still apply. */
    readonly generations: readonly {
      readonly generation: number;
      readonly protected: boolean;
      readonly reason: 'selected' | 'window' | 'elapsed' | 'unknown-history';
      readonly protectedUntil: string | null;
    }[];
  };
  readonly selectedGeneration: number | null;
  /** Metadata bytes only. Installation payloads are counted in installations. */
  readonly generations: readonly {
    readonly generation: number;
    readonly installationId: string | null;
    readonly committed: boolean;
    readonly selected: boolean;
    readonly logicalBytes: number;
    readonly processLeaseIds: readonly string[];
    readonly artifactLeaseIds: readonly string[];
  }[];
  readonly installations: readonly {
    readonly installationId: string;
    readonly generations: readonly number[];
    readonly hasCommittedGeneration: boolean;
    /** Regular-file bytes per path, not allocated or reclaimable disk space. */
    readonly logicalBytes: number;
  }[];
  /** Total for generation-referenced installations only. */
  readonly totalInstallationLogicalBytes: number;
  /** No generation reference was found. This is not permission to remove data. */
  readonly unreferencedInstallations: readonly {
    readonly installationId: string;
    readonly logicalBytes: number;
  }[];
  readonly totalUnreferencedInstallationLogicalBytes: number;
  /** Owned metadata and staging only. These entries are not collection grants. */
  readonly storage: readonly { readonly path: string; readonly logicalBytes: number }[];
  readonly totalStorageLogicalBytes: number;
  /** Disjoint host-root totals. External caches and filesystem allocation are not measured. */
  readonly accounting: {
    readonly scope: 'host-root';
    readonly unit: 'logical-file-bytes';
    readonly excludedPaths: readonly ['locks'];
    /** Evidence and other retained data. Listing an entry does not authorize removal. */
    readonly other: readonly { readonly path: string; readonly logicalBytes: number }[];
    readonly otherLogicalBytes: number;
    readonly totalLogicalBytes: number;
  };
  readonly activeLeases: readonly GenerationLease[];
  readonly artifactLeases: readonly ArtifactGenerationLease[];
}

async function inspectRollbackWindow(host: DurableModHost, pointer: GenerationPointer | null,
  generations: readonly { readonly generation: number }[], durationMs: number, observedAt: Date,
): Promise<NonNullable<ManagedRetentionReport['rollbackWindow']>> {
  const observedMs = observedAt.getTime();
  const selectionLinks = new Map<string, { readonly pointer: GenerationPointer; readonly previous: GenerationPointer | null | undefined; readonly baseGeneration: number }>();
  const unknown = new Set<number>();
  const retired = await readRetiredGenerations(host.root, host.hostIo);
  const entries = await host.hostIo.readdir(host.paths.transactions, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const path = join(host.paths.transactions, entry.name);
    await assertNoSymlinkComponents(host.root, relative(host.root, path));
    if (!entry.isFile()) throw new TypeError('rollback history must contain regular journals');
    const journal = parseHostTransactionJournal(await readJson<unknown>(host.hostIo, path));
    if (host.journalPath(journal.transactionId) !== path) throw new TypeError('rollback journal filename does not bind its transaction');
    if (journal.state === 'failed' || journal.state === 'rolled-back') continue;
    const terminal = journal.steps.find(step => step.id === 'cleanup') ?? journal.steps.find(step => step.id === 'restore-snapshots');
    if (journal.state !== 'committed' || terminal?.state !== 'passed') {
      unknown.add(journal.baseGeneration);
      unknown.add(journal.candidateGeneration);
      continue;
    }
    if (journal.baseGeneration === 0) continue;
    let selection: GenerationPointer | undefined;
    let previousSelection: GenerationPointer | null | undefined;
    if (pointer?.transactionId === journal.transactionId) selection = pointer;
    {
      // Recovered receipts can contain a synthesized time. Use original evidence only.
      for (const outcome of ['committed', 'restart-required']) {
        const receiptPath = join(host.paths.receipts, `${journal.transactionId}.${outcome}.json`);
        try {
          await assertPurgeNoLinks(host, receiptPath);
          const receipt = await readJson<Record<string, unknown>>(host.hostIo, receiptPath).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const preserved = retired.get(journal.candidateGeneration)?.receipts.find(receipt => receipt.transactionId === journal.transactionId && receipt.outcome === outcome);
            if (!preserved) throw error;
            return preserved as unknown as Record<string, unknown>;
          });
          if (receipt.schemaVersion !== 1 || receipt.transactionId !== journal.transactionId
            || receipt.outcome !== outcome || canonicalJson(parseHostTransactionJournal(receipt.journal)) !== canonicalJson(journal)) continue;
          const candidate = parseGenerationPointer(receipt.pointer);
          if (selection && canonicalJson(selection) !== canonicalJson(candidate)) throw new TypeError('selection receipts disagree');
          selection = candidate;
          if (Object.hasOwn(receipt, 'previousSelection')) {
            const previous = receipt.previousSelection === null ? null : parseGenerationPointer(receipt.previousSelection);
            if ((previous?.generation ?? 0) !== journal.baseGeneration || (previous?.lockHash ?? null) !== journal.previousLockHash
              || previous?.transactionId === journal.transactionId) throw new TypeError('receipt predecessor does not bind its base');
            if (previousSelection !== undefined && canonicalJson(previousSelection) !== canonicalJson(previous)) throw new TypeError('receipt predecessor links disagree');
            previousSelection = previous;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    if (!selection) continue;
    const manifest = retired.get(journal.candidateGeneration)?.manifest ?? await host.validateGeneration(journal.candidateGeneration);
    if (selection.transactionId !== journal.transactionId || selection.generation !== journal.candidateGeneration
      || selection.lockHash !== journal.candidateLockHash || selection.lockHash !== manifest.lockHash
      || selection.graphHash !== manifest.graphHash) throw new TypeError('selection evidence does not bind its generation');
    const selectedMs = Date.parse(selection.selectedAt);
    if (selectedMs > observedMs || selectedMs < Date.parse(journal.startedAt)
      || selectedMs > Date.parse(journal.updatedAt)) continue;
    selectionLinks.set(journal.transactionId, { pointer: selection, previous: previousSelection, baseGeneration: journal.baseGeneration });
  }
  // Walk from the selected head. A missing predecessor cannot hide a newer departure.
  const linkedDepartures = new Map<number, number>();
  const visited = new Set<string>();
  let cursor = pointer;
  while (cursor) {
    if (visited.has(cursor.transactionId)) throw new TypeError('selection history contains a cycle');
    visited.add(cursor.transactionId);
    const link = selectionLinks.get(cursor.transactionId);
    if (!link || canonicalJson(link.pointer) !== canonicalJson(cursor)) break;
    if (link.previous && Date.parse(link.previous.selectedAt) > Date.parse(cursor.selectedAt)) {
      if (!linkedDepartures.has(link.baseGeneration)) unknown.add(link.baseGeneration);
      break;
    }
    if (!linkedDepartures.has(link.baseGeneration)) linkedDepartures.set(link.baseGeneration, Date.parse(cursor.selectedAt));
    cursor = link.previous ?? null;
  }
  return Object.freeze({ durationMs, observedAt: observedAt.toISOString(), generations: Object.freeze(generations.map(({ generation }) => {
    const selectedAt = linkedDepartures.get(generation);
    const until = selectedAt === undefined ? NaN : selectedAt + durationMs;
    const uncertain = unknown.has(generation) || !Number.isSafeInteger(until) || !Number.isFinite(new Date(until).getTime());
    const reason = generation === pointer?.generation ? 'selected' as const : uncertain ? 'unknown-history' as const
      : observedMs < until ? 'window' as const : 'elapsed' as const;
    return Object.freeze({ generation, protected: reason !== 'elapsed', reason,
      protectedUntil: uncertain ? null : new Date(until).toISOString() });
  })) });
}

/** Count one installation prefix without following links or reading contents. */
async function installationLogicalBytes(host: DurableModHost, installationId: string): Promise<number> {
  const prefix = join(host.root, 'installations', installationId);
  try {
    return await directoryLogicalBytes(host, prefix);
  } catch (error) {
    throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot measure retained installation', {
      installationId, cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Count regular-file bytes without following links or reading contents. */
async function directoryLogicalBytes(host: DurableModHost, prefix: string): Promise<number> {
  const pending = [prefix];
  let total = 0;
  while (pending.length) {
    const path = pending.pop()!;
    await assertNoSymlinkComponents(host.root, relative(host.root, path));
    const info = await host.hostIo.stat(path);
    if (info.isDirectory()) {
      const entries = await host.hostIo.readdir(path, { withFileTypes: true });
      for (const entry of entries) pending.push(join(path, entry.name));
    } else if (path !== prefix && info.isFile()) {
      if (!Number.isSafeInteger(info.size) || info.size < 0 || !Number.isSafeInteger(total + info.size)) {
        throw new TypeError('retained file sizes exceed safe integer bounds');
      }
      total += info.size;
    } else throw new TypeError('retained directory contains a non-regular entry');
    await assertNoSymlinkComponents(host.root, relative(host.root, path));
  }
  return total;
}

/** Own inspection locks and retain failed cleanup for the next inspection. */
export class ManagedRetentionInspector {
  readonly #host: DurableModHost;
  readonly #window?: { readonly durationMs: number; readonly now: () => Date };
  readonly #pending = new Set<WriterFence>();
  #inspection: Promise<ManagedRetentionReport> | undefined;

  constructor(host: DurableModHost, rollbackWindow?: { readonly durationMs: number; readonly now?: () => Date }) {
    this.#host = host;
    if (rollbackWindow) {
      if (!Number.isSafeInteger(rollbackWindow.durationMs) || rollbackWindow.durationMs < 0) throw new RangeError('rollback window must be a non-negative safe integer');
      this.#window = Object.freeze({ durationMs: rollbackWindow.durationMs, now: rollbackWindow.now ?? (() => new Date()) });
    }
  }

  inspect(): Promise<ManagedRetentionReport> {
    return this.#inspection ??= this.#inspect().finally(() => { this.#inspection = undefined; });
  }

  async #release(fence: WriterFence): Promise<void> {
    try {
      await fence.release();
      this.#pending.delete(fence);
    } catch (error) {
      this.#pending.add(fence);
      throw error;
    }
  }

  async #inspect(): Promise<ManagedRetentionReport> {
    const host = this.#host;
    // Retry only captured fences. Never recover another owner's lock.
    const cleanupErrors: unknown[] = [];
    for (const fence of this.#pending) {
      try { await this.#release(fence); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'retention inspection writer cleanup remains pending');
    await host.initialize();
    const fences: WriterFence[] = [];
    let report: ManagedRetentionReport | undefined;
    const failures: unknown[] = [];
    try {
      fences.push(await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'), 'agon.kernel.retention', { io: host.hostIo }));
      fences.push(await WriterFence.acquire(host.paths.writerLock, 'agon.kernel.retention', { io: host.hostIo }));
      const pointer = await host.readCurrentPointer();
      if (pointer) {
        const manifest = await host.validateGeneration(pointer.generation);
        if (manifest.lockHash !== pointer.lockHash || manifest.graphHash !== pointer.graphHash) {
          throw new DurableHostError('MOD_POINTER_CORRUPT', 'selected pointer does not match its generation');
        }
        if (manifest.transactionId !== pointer.transactionId) {
          // Rollback selects an existing generation through a new transaction.
          try {
            const journalPath = host.journalPath(pointer.transactionId);
            await assertNoSymlinkComponents(host.root, relative(host.root, journalPath));
            const selection = parseHostTransactionJournal(await readJson<unknown>(host.hostIo, journalPath));
            if (selection.transactionId !== pointer.transactionId || selection.operation !== 'rollback'
              || selection.candidateGeneration !== pointer.generation || selection.candidateLockHash !== pointer.lockHash
              || (selection.state !== 'verified' && selection.state !== 'committed')) {
              throw new TypeError('rollback selection journal does not bind the selected generation');
            }
          } catch (error) {
            throw new DurableHostError('MOD_POINTER_CORRUPT', 'selected rollback pointer has no valid selection journal', {
              generation: pointer.generation, transactionId: pointer.transactionId,
              cause: error instanceof Error ? error.message : String(error),
            }, { cause: error });
          }
        }
      }
      const inventory = await retainedGenerationInventory(host, host.hostIo);
      const references = inventory.installations;
      const generations: ManagedRetentionReport['generations'][number][] = [];
      for (const entry of inventory.generations) {
        let logicalBytes: number;
        try {
          logicalBytes = await directoryLogicalBytes(host, host.generationPath(entry.generation));
        } catch (error) {
          throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot measure retained generation', {
            generation: entry.generation, cause: error instanceof Error ? error.message : String(error),
          }, { cause: error });
        }
        generations.push(Object.freeze({ ...entry, selected: entry.generation === pointer?.generation,
          logicalBytes,
          processLeaseIds: Object.freeze(inventory.activeLeases.filter(lease => lease.generation === entry.generation).map(lease => lease.leaseId)),
          artifactLeaseIds: Object.freeze(inventory.artifactLeases.filter(lease => lease.generation === entry.generation).map(lease => lease.leaseId)),
        }));
      }
      const installations: ManagedRetentionReport['installations'][number][] = [];
      let totalInstallationLogicalBytes = 0;
      for (const [installationId, reference] of [...references].sort(([a], [b]) => a.localeCompare(b))) {
        const logicalBytes = await installationLogicalBytes(host, installationId);
        totalInstallationLogicalBytes += logicalBytes;
        if (!Number.isSafeInteger(totalInstallationLogicalBytes)) {
          throw new DurableHostError('MOD_GENERATION_CORRUPT', 'retained installation total exceeds safe integer bounds');
        }
        installations.push(Object.freeze({ installationId, generations: reference.generations,
          hasCommittedGeneration: reference.committed, logicalBytes }));
      }
      const unreferencedInstallations: ManagedRetentionReport['unreferencedInstallations'][number][] = [];
      let totalUnreferencedInstallationLogicalBytes = 0;
      try {
        // Missing is normal on a new host. A failed scan is not an empty inventory.
        const present = await assertNoSymlinkComponents(host.root, 'installations').then(() => true, error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        });
        if (present) {
          const entries = await host.hostIo.readdir(join(host.root, 'installations'), { withFileTypes: true });
          for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
            if (!/^[a-f0-9]{32}$/.test(entry.name) || !entry.isDirectory()) {
              throw new TypeError('installation inventory contains an invalid prefix');
            }
            if (references.has(entry.name)) continue;
            const logicalBytes = await installationLogicalBytes(host, entry.name);
            totalUnreferencedInstallationLogicalBytes += logicalBytes;
            if (!Number.isSafeInteger(totalUnreferencedInstallationLogicalBytes)) {
              throw new TypeError('unreferenced installation total exceeds safe integer bounds');
            }
            unreferencedInstallations.push(Object.freeze({ installationId: entry.name, logicalBytes }));
          }
          await assertNoSymlinkComponents(host.root, 'installations');
        }
      } catch (error) {
        throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot inspect unreferenced installations', {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      const storage: ManagedRetentionReport['storage'][number][] = [];
      let totalStorageLogicalBytes = 0;
      for (const path of ['generations', 'staging', 'installation-staging', 'purge-staging']) {
        try {
          const present = await assertNoSymlinkComponents(host.root, path).then(() => true, error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
          });
          const logicalBytes = present ? await directoryLogicalBytes(host, join(host.root, path)) : 0;
          totalStorageLogicalBytes += logicalBytes;
          if (!Number.isSafeInteger(totalStorageLogicalBytes)) throw new TypeError('storage total exceeds safe integer bounds');
          storage.push(Object.freeze({ path, logicalBytes }));
        } catch (error) {
          throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot measure retained storage', {
            path, cause: error instanceof Error ? error.message : String(error),
          }, { cause: error });
        }
      }
      const other: ManagedRetentionReport['accounting']['other'][number][] = [];
      let otherLogicalBytes = 0;
      let totalLogicalBytes = totalStorageLogicalBytes + totalInstallationLogicalBytes + totalUnreferencedInstallationLogicalBytes;
      try {
        const measured = new Set(['locks', 'installations', ...storage.map(entry => entry.path)]);
        for (const entry of [...await host.hostIo.readdir(host.root, { withFileTypes: true })].sort((a, b) => a.name.localeCompare(b.name))) {
          if (measured.has(entry.name)) continue;
          const path = join(host.root, entry.name);
          await assertNoSymlinkComponents(host.root, entry.name);
          const info = await host.hostIo.stat(path);
          const logicalBytes = info.isDirectory() ? await directoryLogicalBytes(host, path) : info.isFile() ? info.size : NaN;
          if (!Number.isSafeInteger(logicalBytes) || logicalBytes < 0
            || !Number.isSafeInteger(otherLogicalBytes + logicalBytes)) throw new TypeError('retained evidence size is invalid');
          await assertNoSymlinkComponents(host.root, entry.name);
          otherLogicalBytes += logicalBytes;
          other.push(Object.freeze({ path: entry.name, logicalBytes }));
        }
        totalLogicalBytes += otherLogicalBytes;
        if (!Number.isSafeInteger(totalLogicalBytes)) throw new TypeError('host-root logical bytes exceed safe integer bounds');
      } catch (error) {
        throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot measure retained evidence and other host data', {
          cause: error instanceof Error ? error.message : String(error),
        }, { cause: error });
      }
      const accounting: ManagedRetentionReport['accounting'] = Object.freeze({ scope: 'host-root', unit: 'logical-file-bytes',
        excludedPaths: Object.freeze(['locks'] as const), other: Object.freeze(other), otherLogicalBytes, totalLogicalBytes });
      let rollbackWindow: ManagedRetentionReport['rollbackWindow'];
      if (this.#window) {
        try {
          rollbackWindow = await inspectRollbackWindow(host, pointer, inventory.generations, this.#window.durationMs, this.#window.now());
        } catch (error) {
          throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot verify rollback protection history', {
            cause: error instanceof Error ? error.message : String(error),
          }, { cause: error });
        }
      }
      report = Object.freeze({ schemaVersion: 1, selectedGeneration: pointer?.generation ?? null,
        ...(rollbackWindow ? { rollbackWindow } : {}),
        generations: Object.freeze(generations),
        storage: Object.freeze(storage), totalStorageLogicalBytes, accounting,
        installations: Object.freeze(installations), totalInstallationLogicalBytes,
        unreferencedInstallations: Object.freeze(unreferencedInstallations), totalUnreferencedInstallationLogicalBytes,
        activeLeases: inventory.activeLeases,
        artifactLeases: inventory.artifactLeases,
      });
    } catch (error) { failures.push(error); }
    for (const fence of fences.reverse()) {
      try { await this.#release(fence); } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'retention inspection and writer cleanup failed');
    return report!;
  }
}

async function captureRetirementEvidence(host: DurableModHost, generation: number): Promise<GenerationRetirementEvidence> {
  const manifest = await host.validateGeneration(generation);
  const receipts: unknown[] = [];
  for (const entry of await host.hostIo.readdir(host.paths.transactions, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue;
    const path = join(host.paths.transactions, entry.name);
    await assertPurgeNoLinks(host, path);
    if (!entry.isFile()) throw new TypeError('selection journal must be a file');
    const journal = parseHostTransactionJournal(await readJson<unknown>(host.hostIo, path));
    if (host.journalPath(journal.transactionId) !== path) throw new TypeError('selection journal filename differs from its identity');
    if (journal.baseGeneration !== generation && journal.candidateGeneration !== generation) continue;
    const terminal = journal.steps.find(step => step.id === 'cleanup') ?? journal.steps.find(step => step.id === 'restore-snapshots');
    if (journal.state !== 'failed' && journal.state !== 'rolled-back'
      && (journal.state !== 'committed' || terminal?.state !== 'passed')) {
      throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'generation has unfinished selection work', { generation, transactionId: journal.transactionId });
    }
    if (journal.candidateGeneration !== generation || journal.state !== 'committed') continue;
    let found = false;
    for (const outcome of ['committed', 'restart-required', 'recovered-committed']) {
      const receiptPath = join(host.paths.receipts, `${journal.transactionId}.${outcome}.json`);
      await assertPurgeNoLinks(host, receiptPath);
      if (!await pathExists(host.hostIo, receiptPath)) continue;
      const receipt = await readJson<Record<string, unknown>>(host.hostIo, receiptPath);
      const captured = parseHostTransactionJournal(receipt.journal);
      const stableFields = ['transactionId', 'operation', 'startedAt', 'baseGeneration', 'candidateGeneration', 'fenceToken', 'previousLockHash', 'candidateLockHash'] as const;
      if (receipt.outcome !== outcome || receipt.transactionId !== journal.transactionId
        || stableFields.some(key => captured[key] !== journal[key])) {
        throw new TypeError('selection receipt differs from the current journal');
      }
      if (canonicalJson(captured) !== canonicalJson(journal)) {
        if (outcome === 'restart-required' && Date.parse(captured.updatedAt) <= Date.parse(journal.updatedAt)) continue;
        throw new TypeError('terminal selection receipt differs from the current journal');
      }
      receipts.push(receipt);
      found = true;
    }
    if (!found) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'repair missing selection receipts before collection', { generation, transactionId: journal.transactionId });
  }
  const directory = join(host.root, 'installation-transactions');
  await assertPurgeNoLinks(host, directory);
  if (await pathExists(host.hostIo, directory)) {
    for (const entry of await host.hostIo.readdir(directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      const path = join(directory, entry.name);
      await assertPurgeNoLinks(host, path);
      if (!entry.isFile()) throw new TypeError('installation journal must be a file');
      const journal = parseJournal(await readJson<unknown>(host.hostIo, path));
      // Incomplete installation recovery can infer its outcome from any retained generation.
      if (journal.state !== 'committed' && journal.state !== 'failed') throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'recover unfinished installations before collection', { transactionId: journal.transactionId });
    }
  }
  return parseGenerationRetirementEvidence({ manifest, receipts });
}

async function assertCollectionReferences(host: DurableModHost, generations: readonly number[], durationMs: number, now: Date): Promise<void> {
  const inventory = await retainedGenerationInventory(host, host.hostIo);
  const window = await inspectRollbackWindow(host, await host.readCurrentPointer(), inventory.generations, durationMs, now);
  for (const generation of generations) {
    if (!window.generations.some(entry => entry.generation === generation && !entry.protected)
      || [...inventory.activeLeases, ...inventory.artifactLeases].some(lease => lease.generation === generation)) {
      throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'generation remains protected from collection', { generation });
    }
  }
}

export async function previewManagedGenerationCollection(host: DurableModHost, options: {
  readonly generations: readonly number[]; readonly rollbackWindowMs: number; readonly now?: () => Date;
}): Promise<ManagedGenerationCollectionPlan> {
  const generations = [...options.generations].sort((a, b) => a - b);
  const rollbackWindowMs = options.rollbackWindowMs;
  if (!generations.length || new Set(generations).size !== generations.length || generations.some(id => !Number.isSafeInteger(id) || id < 1)
    || !Number.isSafeInteger(rollbackWindowMs) || rollbackWindowMs < 0) throw new TypeError('collection requires distinct positive generation IDs and an explicit nonnegative rollback window');
  await host.initialize();
  const fence = await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'), 'agon.kernel.retention', { io: host.hostIo });
  let hostFence: WriterFence | undefined;
  const errors: unknown[] = [];
  try {
    hostFence = await WriterFence.acquire(host.paths.writerLock, 'agon.kernel.retention', { io: host.hostIo });
    const selectedPointer = await host.readCurrentPointer();
    if (!selectedPointer) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'collection requires a selected generation');
    const now = (options.now ?? (() => new Date()))();
    const transactionId = randomUUID();
    await readRetiredGenerations(host.root, host.hostIo, { claim: { transactionId, generations } });
    await assertCollectionReferences(host, generations, rollbackWindowMs, now);
    const evidence: GenerationRetirementEvidence[] = [];
    for (const generation of generations) evidence.push(await captureRetirementEvidence(host, generation));
    const unsigned = { schemaVersion: 3 as const, kind: 'generation-retention' as const, transactionId,
      hostRoot: host.root, selectedPointer, rollbackWindowMs, observedAt: now.toISOString(), generations: evidence };
    return parseGenerationCollectionPlan({ ...unsigned, planHash: sha256Canonical(unsigned) });
  } catch (error) { errors.push(error); throw error; }
  finally { await releaseLifecycleWriters([hostFence, fence], errors); }
}

export async function applyManagedGenerationCollection(host: DurableModHost, input: ManagedGenerationCollectionPlan,
  approvedPlanHash: string, options: { readonly now?: () => Date; readonly cancelPending?: boolean } = {},
): Promise<readonly number[]> {
  if (options.cancelPending !== undefined && typeof options.cancelPending !== 'boolean') throw new TypeError('cancelPending must be a boolean');
  const cancelPending = options.cancelPending === true;
  const plan = parseGenerationCollectionPlan(structuredClone(input));
  if (plan.hostRoot !== host.root || plan.planHash !== approvedPlanHash) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'collection approval does not bind this host and exact plan');
  const fence = await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'), 'agon.kernel.retention', { io: host.hostIo });
  let hostFence: WriterFence | undefined;
  const errors: unknown[] = [];
  try {
    hostFence = await WriterFence.acquire(host.paths.writerLock, 'agon.kernel.retention', { io: host.hostIo });
    await readRetiredGenerations(host.root, host.hostIo, { claim: { transactionId: plan.transactionId,
      generations: plan.generations.map(evidence => evidence.manifest.generation) } });
    const journalPath = join(host.root, 'purge-transactions', `${plan.transactionId}.json`);
    const staging = join(host.root, 'purge-staging', plan.transactionId);
    await assertPurgeNoLinks(host, journalPath);
    await assertPurgeNoLinks(host, staging);
    let phases: GenerationRetirementJournal['phases'][number][];
    if (await pathExists(host.hostIo, journalPath)) {
      const journal = parseGenerationRetirementJournal(await readJson<unknown>(host.hostIo, journalPath));
      if (canonicalJson(journal.plan) !== canonicalJson(plan)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'retention journal differs from the approved plan');
      phases = [...journal.phases];
      await host.hostIo.syncFile(journalPath);
      await host.hostIo.syncDirectory(dirname(journalPath));
    } else phases = plan.generations.map(() => 'pending');
    const save = () => atomicWrite(host.hostIo, journalPath, `${canonicalJson({ schemaVersion: 2, kind: 'generation-retention', plan, phases })}\n`);
    const removeStaged = async (index: number) => {
      await fence.assertOwned();
      await hostFence!.assertOwned();
      const staged = join(staging, String(index));
      await assertPurgeNoLinks(host, staged);
      if (await pathExists(host.hostIo, staged)) {
        await makeTreeRemovable(host.hostIo, staged);
        await host.hostIo.rm(staged, { recursive: true, force: false });
      }
      await host.hostIo.syncDirectory(staging);
      phases[index] = 'removed';
      await save();
    };
    // Validate every original target before starting any new retirement.
    const pending: number[] = [];
    for (const [index, evidence] of plan.generations.entries()) {
      if (phases[index] === 'cancelled') continue;
      const original = host.generationPath(evidence.manifest.generation);
      const staged = join(staging, String(index));
      await assertPurgeNoLinks(host, original);
      await assertPurgeNoLinks(host, staged);
      const originalExists = await pathExists(host.hostIo, original);
      const stagedExists = await pathExists(host.hostIo, staged);
      if (phases[index] !== 'pending') {
        if (originalExists || (phases[index] === 'removed' && stagedExists)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'retired path contains replacement bytes');
      } else if (stagedExists) {
        if (originalExists) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'both original and quarantined generation exist');
        await validateRetirementDirectory(host.root, host.hostIo, staged, evidence);
        await host.hostIo.syncDirectory(dirname(original));
        await host.hostIo.syncDirectory(staging);
        phases[index] = 'staged';
        await save();
      } else {
        if (!originalExists) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'pending retirement lost both original and quarantine');
        pending.push(evidence.manifest.generation);
      }
    }
    // Staged work is already retired. Fresh conflicts cannot strand its cleanup.
    for (const [index, phase] of phases.entries()) if (phase === 'staged') await removeStaged(index);
    if (cancelPending) {
      for (const [index, evidence] of plan.generations.entries()) {
        if (phases[index] !== 'pending') continue;
        const original = host.generationPath(evidence.manifest.generation);
        await validateRetirementDirectory(host.root, host.hostIo, original, evidence);
        await fence.assertOwned();
        await hostFence.assertOwned();
        await host.hostIo.chmod(original, 0o555);
        await host.hostIo.syncDirectory(original);
      }
      phases = phases.map(phase => phase === 'pending' ? 'cancelled' : phase);
      await save();
      await host.hostIo.syncDirectory(host.root);
      return Object.freeze(plan.generations.filter((_, index) => phases[index] === 'removed').map(entry => entry.manifest.generation));
    }
    if (pending.length) {
      for (const evidence of plan.generations.filter(entry => pending.includes(entry.manifest.generation))) {
        if (canonicalJson(await captureRetirementEvidence(host, evidence.manifest.generation)) !== canonicalJson(evidence)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'generation evidence changed after preview');
      }
      if (canonicalJson(await host.readCurrentPointer()) !== canonicalJson(plan.selectedPointer)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'selection changed after collection preview');
      const now = (options.now ?? (() => new Date()))();
      if (now.getTime() < Date.parse(plan.observedAt)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'collection clock moved backward');
      await assertCollectionReferences(host, pending, plan.rollbackWindowMs, now);
    }
    await save();
    await host.hostIo.syncDirectory(host.root);
    await host.hostIo.mkdir(staging, { recursive: true, mode: 0o700 });
    await assertPurgeNoLinks(host, staging);
    await host.hostIo.syncDirectory(dirname(staging));
    await host.hostIo.syncDirectory(host.root);
    for (const [index, evidence] of plan.generations.entries()) {
      if (phases[index] === 'removed' || phases[index] === 'cancelled') continue;
      await fence.assertOwned();
      await hostFence.assertOwned();
      const original = host.generationPath(evidence.manifest.generation);
      const staged = join(staging, String(index));
      if (phases[index] === 'pending') {
        if (!await pathExists(host.hostIo, staged)) {
          await host.hostIo.chmod(original, 0o700);
          try { await host.hostIo.rename(original, staged); }
          catch (error) {
            if (await pathExists(host.hostIo, original)) {
              try { await host.hostIo.chmod(original, 0o555); }
              catch (restore) { throw new AggregateError([error, restore], 'retirement rename and permission restore failed'); }
            }
            throw error;
          }
        }
        await host.hostIo.syncDirectory(dirname(original));
        await host.hostIo.syncDirectory(staging);
        phases[index] = 'staged';
        await save();
      }
      await removeStaged(index);
    }
    return Object.freeze(plan.generations.filter((_, index) => phases[index] === 'removed').map(entry => entry.manifest.generation));
  } catch (error) { errors.push(error); throw error; }
  finally { await releaseLifecycleWriters([hostFence, fence], errors); }
}

export async function previewManagedPurge(
  host: DurableModHost,
  options: { readonly installationIds?: readonly string[]; readonly dataPaths?: readonly string[] } = {},
): Promise<ManagedPurgePlan> {
  const pointer = await host.readCurrentPointer();
  const selected = pointer
    ? await readJson<ManagedInstallationRecord>(host.hostIo, join(host.generationPath(pointer.generation), 'installation.json')).catch(() => null)
    : null;
  const selectedId = selected?.installationId ?? null;
  const ids = [...new Set(options.installationIds ?? [])].sort();
  for (const id of ids) if (!/^[a-f0-9]{32}$/.test(id)) throw new TypeError(`invalid installation ID: ${id}`);
  if (selectedId && ids.includes(selectedId)) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'purge cannot target the selected installation');
  const referenced = await referencedInstallations(host);
  const retained = ids.filter((id) => referenced.has(id));
  if (retained.length > 0) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'purge cannot target an installation retained by a generation', { installationIds: retained });
  const installationPaths = ids.map((id) => assertManagedPath(host.root, join(host.root, 'installations', id)));
  const dataPaths = [...new Set(options.dataPaths ?? [])].sort().map((path) => assertPurgeDataPath(host, path));
  assertDistinctPurgeTargets([...installationPaths, ...dataPaths]);
  for (const path of [...installationPaths, ...dataPaths]) await assertPurgeNoLinks(host, path);
  const unsigned = Object.freeze({
    schemaVersion: 2 as const,
    transactionId: randomUUID(),
    selectedGeneration: pointer?.generation ?? null,
    installationPaths: Object.freeze(installationPaths),
    dataPaths: Object.freeze(dataPaths),
  });
  return Object.freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
}

export async function applyManagedPurge(host: DurableModHost, input: ManagedPurgePlan, approvedPlanHash: string): Promise<readonly string[]> {
  // Retain approved targets across caller callbacks and asynchronous work.
  const plan = structuredClone(input);
  const { planHash, ...unsignedPlan } = plan;
  if (plan.schemaVersion !== 2 || typeof plan.transactionId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(plan.transactionId)) {
    throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'purge requires a fresh version-2 approval preview');
  }
  if (approvedPlanHash !== planHash || planHash !== sha256Canonical(unsignedPlan)) {
    throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'purge approval does not match exact preview');
  }
  // Validate both namespaces before deleting any approved target.
  const installationPaths = plan.installationPaths.map(path => assertPurgeInstallationPath(host, path));
  const dataPaths = plan.dataPaths.map(path => assertPurgeDataPath(host, path));
  assertDistinctPurgeTargets([...installationPaths, ...dataPaths]);
  const fence = await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'), 'agon.kernel.lifecycle.purge', { io: host.hostIo });
  let hostFence: WriterFence | undefined;
  const operationErrors: unknown[] = [];
  try {
    // Match lifecycle apply and recovery lock order.
    hostFence = await WriterFence.acquire(host.paths.writerLock, 'agon.kernel.lifecycle.purge', { io: host.hostIo });
    const targets = [...installationPaths, ...dataPaths];
    const journalPath = join(host.root, 'purge-transactions', `${plan.transactionId}.json`);
    const staging = join(host.root, 'purge-staging', plan.transactionId);
    await assertPurgeNoLinks(host, journalPath);
    await assertPurgeNoLinks(host, staging);
    type Phase = 'pending' | 'staged' | 'removed' | 'absent';
    let phases: Phase[];
    try {
      const value = await readJson<unknown>(host.hostIo, journalPath);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('purge journal must be an object');
      const record = value as Record<string, unknown>;
      if (Object.keys(record).sort().join(',') !== 'phases,planHash,schemaVersion'
        || record.schemaVersion !== 1 || record.planHash !== planHash
        || !Array.isArray(record.phases) || record.phases.length !== targets.length
        || record.phases.some(phase => !['pending', 'staged', 'removed', 'absent'].includes(phase))) {
        throw new TypeError('purge journal does not match the approved plan');
      }
      phases = [...record.phases] as Phase[];
      // Retry a prior sync failure before performing further effects.
      await host.hostIo.syncFile(journalPath);
      await host.hostIo.syncDirectory(dirname(journalPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new DurableHostError('MOD_TRANSACTION_FAILED', 'purge journal cannot be verified; no further targets were removed', { cause: String(error) });
      }
      phases = targets.map(() => 'pending');
      await atomicWrite(host.hostIo, journalPath, `${canonicalJson({ schemaVersion: 1, planHash, phases })}\n`, 0o400);
    }
    await host.hostIo.syncDirectory(host.root);
    await host.hostIo.mkdir(staging, { recursive: true, mode: 0o700 });
    await assertPurgeNoLinks(host, staging);
    await host.hostIo.syncDirectory(dirname(staging));
    await host.hostIo.syncDirectory(host.root);
    // Validate all pending paths before any target is moved or removed.
    const pendingTargets = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (phases[index] === 'removed' || phases[index] === 'absent') continue;
      const staged = join(staging, String(index));
      await assertPurgeNoLinks(host, staged);
      if (phases[index] === 'pending' && !await pathExists(host.hostIo, staged)) {
        await assertPurgeNoLinks(host, target);
        pendingTargets.add(target);
      }
    }
    // Quarantined bytes no longer refer to the original path or its generation.
    // New target selection still requires the complete original approval gates.
    if (pendingTargets.size > 0) {
      const current = await host.readCurrentPointer();
      if ((current?.generation ?? null) !== plan.selectedGeneration) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'selected generation changed after purge preview');
      const referenced = await referencedInstallations(host);
      const retained = installationPaths.filter(path => pendingTargets.has(path)).map(path => basename(path)).filter(id => referenced.has(id));
      if (retained.length > 0) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'installation became retained after purge preview', { installationIds: retained });
    }
    for (const [index, target] of targets.entries()) {
      if (phases[index] === 'removed' || phases[index] === 'absent') continue;
      await fence.assertOwned();
      await hostFence.assertOwned();
      const staged = join(staging, String(index));
      await assertPurgeNoLinks(host, staged);
      if (phases[index] === 'pending') {
        // A prior rename can succeed before its journal update is durable.
        if (!await pathExists(host.hostIo, staged)) {
          await assertPurgeNoLinks(host, target);
          if (await pathExists(host.hostIo, target)) {
            const metadata = await host.hostIo.stat(target);
            // macOS requires a writable root to rename an immutable installation.
            const immutableInstallation = installationPaths.includes(target) && metadata.isDirectory()
              && metadata.mode !== undefined && (metadata.mode & 0o777) === 0o555;
            if (immutableInstallation) await host.hostIo.chmod(target, 0o700);
            try { await host.hostIo.rename(target, staged); }
            catch (error) {
              if (immutableInstallation) {
                try {
                  if (await pathExists(host.hostIo, target)) {
                    await host.hostIo.chmod(target, 0o555);
                    await host.hostIo.syncDirectory(target);
                  }
                }
                catch (restore) { throw new AggregateError([error, restore], 'installation purge rename and permission restore failed'); }
              }
              throw error;
            }
          } else phases[index] = 'absent';
        }
        if (phases[index] !== 'absent') {
          // Re-sync a rename observed after an interrupted attempt.
          await host.hostIo.syncDirectory(dirname(target));
          await host.hostIo.syncDirectory(staging);
          phases[index] = 'staged';
        }
        await atomicWrite(host.hostIo, journalPath, `${canonicalJson({ schemaVersion: 1, planHash, phases })}\n`);
      }
      if (phases[index] === 'staged') {
        if (await pathExists(host.hostIo, staged)) {
          await makeTreeRemovable(host.hostIo, staged).catch(() => undefined);
          await host.hostIo.rm(staged, { recursive: true, force: false });
        }
        await host.hostIo.syncDirectory(staging);
        phases[index] = 'removed';
        await atomicWrite(host.hostIo, journalPath, `${canonicalJson({ schemaVersion: 1, planHash, phases })}\n`);
      }
    }
    return Object.freeze(targets.filter((_, index) => phases[index] === 'removed'));
  } catch (error) {
    operationErrors.push(error);
    throw error;
  } finally {
    await releaseLifecycleWriters([hostFence, fence], operationErrors);
  }
}
