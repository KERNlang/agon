import { basename, join, relative, resolve } from 'node:path';
import { DurableModHost } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import type { ManagedInstallationRecord } from './managed-lifecycle.js';
import { makeTreeRemovable } from './removable-tree.js';
import { WriterFence } from './writer-lock.js';

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
  await host.validateGeneration(pointer.generation);
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

export async function recoverManagedLifecycle(
  host: DurableModHost,
  options: LifecycleRecoveryOptions = {},
): Promise<LifecycleRecoveryResult> {
  const io = options.io ?? nodeHostIo;
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
  try {
    const selected = await selectedInstallationId(host, io);
    const entries = await io.readdir(journals, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      let journal: RecoverableLifecycleJournal;
      try {
        journal = parseJournal(await readJson<unknown>(io, join(journals, entry.name)));
      } catch (error) {
        throw new DurableHostError('MOD_SAFE_MODE', `lifecycle recovery refused malformed journal: ${entry.name}`, {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (journal.state === 'committed' || journal.state === 'failed') continue;
      const stagedPath = join(staging, journal.transactionId);
      const installedPath = join(installations, journal.installationId);
      const committed = selected.installationId === journal.installationId;
      if (committed) {
        const recovered = Object.freeze({
          ...journal,
          state: 'committed' as const,
          updatedAt: now().toISOString(),
          selectedGeneration: selected.generation,
          steps: Object.freeze([...journal.steps, 'recovered-selected-generation']),
        });
        await atomicWrite(io, join(journals, entry.name), `${canonicalJson(recovered)}\n`);
        const receiptPath = join(receipts, `${journal.transactionId}.recovered-committed.json`);
        if (!await pathExists(io, receiptPath)) await writeNewImmutableFile(io, receiptPath, `${canonicalJson({
          schemaVersion: 1,
          transactionId: journal.transactionId,
          outcome: 'recovered-committed',
          selectedGeneration: selected.generation,
          installationId: journal.installationId,
          recoveredAt: now().toISOString(),
        })}\n`);
        recoveredCommitted.push(journal.transactionId);
      } else {
        for (const path of [stagedPath, installedPath]) {
          if (await pathExists(io, path)) {
            await makeTreeRemovable(io, path).catch(() => undefined);
            await io.rm(path, { recursive: true, force: true });
          }
        }
        const recovered = Object.freeze({
          ...journal,
          state: 'failed' as const,
          updatedAt: now().toISOString(),
          selectedGeneration: null,
          steps: Object.freeze([...journal.steps, 'recovered-prior-generation']),
        });
        await atomicWrite(io, join(journals, entry.name), `${canonicalJson(recovered)}\n`);
        const receiptPath = join(receipts, `${journal.transactionId}.recovered-rolled-back.json`);
        if (!await pathExists(io, receiptPath)) await writeNewImmutableFile(io, receiptPath, `${canonicalJson({
          schemaVersion: 1,
          transactionId: journal.transactionId,
          outcome: 'recovered-rolled-back',
          selectedGeneration: selected.generation,
          installationId: null,
          recoveredAt: now().toISOString(),
        })}\n`);
        recoveredRolledBack.push(journal.transactionId);
      }
    }
    return Object.freeze({
      recoveredCommitted: Object.freeze(recoveredCommitted.sort()),
      recoveredRolledBack: Object.freeze(recoveredRolledBack.sort()),
      selectedGeneration: selected.generation,
    });
  } finally {
    await fence.release().catch(() => undefined);
  }
}

export interface ManagedPurgePlan {
  readonly schemaVersion: 1;
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

async function referencedInstallationIds(host: DurableModHost): Promise<Set<string>> {
  const result = new Set<string>();
  const entries = await host.hostIo.readdir(host.paths.generations, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const record = await readJson<ManagedInstallationRecord>(host.hostIo, join(host.paths.generations, entry.name, 'installation.json'));
      result.add(record.installationId);
    } catch { /* legacy or incomplete generation */ }
  }
  return result;
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
  const referenced = await referencedInstallationIds(host);
  const retained = ids.filter((id) => referenced.has(id));
  if (retained.length > 0) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'purge cannot target an installation retained by a generation', { installationIds: retained });
  const installationPaths = ids.map((id) => assertManagedPath(host.root, join(host.root, 'installations', id)));
  const dataPaths = [...new Set(options.dataPaths ?? [])].sort().map((path) => assertManagedPath(host.root, path));
  const unsigned = Object.freeze({
    schemaVersion: 1 as const,
    selectedGeneration: pointer?.generation ?? null,
    installationPaths: Object.freeze(installationPaths),
    dataPaths: Object.freeze(dataPaths),
  });
  return Object.freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
}

export async function applyManagedPurge(host: DurableModHost, plan: ManagedPurgePlan, approvedPlanHash: string): Promise<readonly string[]> {
  if (approvedPlanHash !== plan.planHash) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'purge approval does not match exact preview');
  const fence = await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'), 'agon.kernel.lifecycle.purge', { io: host.hostIo });
  try {
    const current = await host.readCurrentPointer();
    if ((current?.generation ?? null) !== plan.selectedGeneration) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'selected generation changed after purge preview');
    const referenced = await referencedInstallationIds(host);
    const targetedIds = plan.installationPaths.map((path) => basename(path));
    const retained = targetedIds.filter((id) => referenced.has(id));
    if (retained.length > 0) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'installation became retained after purge preview', { installationIds: retained });
    const removed: string[] = [];
    for (const path of [...plan.installationPaths, ...plan.dataPaths]) {
      const exact = assertManagedPath(host.root, path);
      if (!await pathExists(host.hostIo, exact)) continue;
      await makeTreeRemovable(host.hostIo, exact).catch(() => undefined);
      await host.hostIo.rm(exact, { recursive: true, force: false });
      removed.push(exact);
    }
    return Object.freeze(removed);
  } finally {
    await fence.release().catch(() => undefined);
  }
}
