import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalJson, sha256Canonical, type CanonicalModLock } from './lock.js';
import { DurableHostError, SimulatedHostCrash } from './host-errors.js';
import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';
import { createDoctorReport, createHostEvent, redactHostValue, type HostBlockedReason, type HostDoctorReport, type HostEvent } from './host-observability.js';
import { WriterFence, type WriterLockOptions } from './writer-lock.js';
import { parseGenerationManifest, parseGenerationPointer, parseHostTransactionJournal } from './host-contracts.js';
import { makeTreeRemovable } from './removable-tree.js';
import { GenerationLeaseStore } from './generation-leases.js';
import { disposeGenerationOwners } from './generation-disposal.js';

export type HostTransactionOperation =
  | 'install' | 'update' | 'enable' | 'disable' | 'remove' | 'import'
  | 'profile-update' | 'grant' | 'revoke' | 'trust' | 'untrust'
  | 'setup-action' | 'rollback' | 'purge' | 'garbage-collect' | 'kernel-switch';
export type HostJournalState = 'preparing' | 'verified' | 'committed' | 'rolled-back' | 'failed';
export type HostFaultPoint =
  | 'after-lock' | 'after-journal-preparing' | 'after-staging' | 'after-journal-verified'
  | 'after-generation-rename' | 'after-pointer-switch' | 'after-journal-committed'
  | 'after-installed-index' | 'after-final-journal';

export interface GenerationPointer {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly graphHash: `sha256:${string}`;
  readonly lockHash: `sha256:${string}`;
  readonly transactionId: string;
  readonly selectedAt: string;
}

export interface GenerationManifest {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly graphHash: `sha256:${string}`;
  readonly lockHash: `sha256:${string}`;
  readonly kernelVersion: string;
  readonly transactionId: string;
  readonly createdAt: string;
  readonly files: Readonly<Record<string, `sha256:${string}`>>;
  readonly contentHash: `sha256:${string}`;
}

export interface HostJournalStep {
  readonly id: string;
  readonly state: 'pending' | 'running' | 'passed' | 'failed' | 'rolled-back';
  readonly receiptId?: string;
  readonly error?: string;
}

export interface HostTransactionJournal {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly operation: HostTransactionOperation;
  readonly state: HostJournalState;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly baseGeneration: number;
  readonly candidateGeneration: number;
  readonly fenceToken: string;
  readonly previousLockHash: `sha256:${string}` | null;
  readonly candidateLockHash: `sha256:${string}` | null;
  readonly steps: readonly HostJournalStep[];
  readonly rollback: { readonly attempted: boolean; readonly completed: boolean; readonly receiptId?: string };
}

export interface GenerationLease {
  readonly schemaVersion: 1;
  readonly leaseId: string;
  readonly generation: number;
  readonly ownerId: string;
  readonly pid: number;
  readonly processIdentity: string;
  readonly createdAt: string;
  readonly heartbeatAt: string;
  readonly releasedAt: string | null;
}

export interface DurableHostOptions {
  readonly kernelVersion: string;
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly ownerId?: string;
  readonly processIdentity?: string;
  readonly secrets?: readonly string[];
  readonly fault?: (point: HostFaultPoint) => void | Promise<void>;
  readonly writerLock?: Omit<WriterLockOptions, 'io' | 'now' | 'processIdentity'>;
}

export interface CommitGenerationInput {
  readonly operation: HostTransactionOperation;
  readonly expectedBaseGeneration?: number;
  readonly lock: CanonicalModLock;
  readonly desiredState: unknown;
  readonly installedIndex: unknown;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}

export interface CommitGenerationResult {
  readonly pointer: GenerationPointer;
  readonly journal: HostTransactionJournal;
  readonly events: readonly HostEvent[];
}

export interface HostTransactionReceipt {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly ownerId: string;
  readonly outcome: 'committed' | 'rolled-back' | 'restart-required' | 'recovered-committed' | 'recovered-rolled-back';
  readonly pointer: GenerationPointer | null;
  readonly journal: HostTransactionJournal;
  readonly events: readonly HostEvent[];
}

export interface HostBootResult {
  readonly mode: 'normal' | 'safe-mode' | 'kernel-only';
  readonly pointer: GenerationPointer | null;
  readonly reason: string | null;
  readonly recoveredTransactions: readonly string[];
}

export interface DisposableOwner {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly disposers: readonly (() => void | Promise<void>)[];
}

function hashBytes(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}


function generationName(generation: number): string {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('generation must be a non-negative safe integer');
  return generation.toString().padStart(16, '0');
}

function safeRelativePath(path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\')) throw new TypeError(`unsafe generation path: ${path}`);
  const normalized = path.split('/').filter(Boolean).join('/');
  if (!normalized || normalized.split('/').some((part) => part === '.' || part === '..')) throw new TypeError(`unsafe generation path: ${path}`);
  return normalized;
}

async function listFiles(io: HostIo, root: string, prefix = ''): Promise<string[]> {
  const entries = await io.readdir(join(root, prefix), { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(io, root, child));
    else if (entry.isFile()) output.push(child);
    else throw new DurableHostError('MOD_GENERATION_CORRUPT', `unsupported generation entry: ${child}`);
  }
  return output.sort();
}

async function freezeTree(io: HostIo, root: string): Promise<void> {
  const files = await listFiles(io, root);
  for (const file of files) await io.chmod(join(root, file), 0o444);
  const directories = new Set<string>(['']);
  for (const file of files) {
    let current = dirname(file);
    while (current !== '.') { directories.add(current); current = dirname(current); }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) await io.chmod(join(root, directory), 0o555);
}

export class DurableModHost {
  readonly root: string;
  readonly #io: HostIo;
  readonly #now: () => Date;
  readonly #options: DurableHostOptions;
  readonly #processIdentity: string;
  readonly #events: HostEvent[] = [];
  readonly paths: Readonly<{
    generations: string; staging: string; transactions: string; leases: string; receipts: string;
    current: string; installedIndex: string; desiredState: string; writerLock: string;
  }>;

  constructor(root: string, options: DurableHostOptions) {
    this.root = resolve(root);
    this.#io = options.io ?? nodeHostIo;
    this.#now = options.now ?? (() => new Date());
    this.#options = options;
    this.#processIdentity = options.processIdentity ?? randomUUID();
    this.paths = Object.freeze({
      generations: join(this.root, 'generations'),
      staging: join(this.root, 'staging'),
      transactions: join(this.root, 'transactions'),
      leases: join(this.root, 'leases'),
      receipts: join(this.root, 'receipts'),
      current: join(this.root, 'current-generation.json'),
      installedIndex: join(this.root, 'installed-index.json'),
      desiredState: join(this.root, 'desired-state.json'),
      writerLock: join(this.root, 'locks', 'writer.json'),
    });
  }

  async initialize(): Promise<void> {
    await this.#io.mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const path of [this.paths.generations, this.paths.staging, this.paths.transactions, this.paths.leases, this.paths.receipts, dirname(this.paths.writerLock)]) {
      await this.#io.mkdir(path, { recursive: true, mode: 0o700 });
    }
  }

  async readCurrentPointer(): Promise<GenerationPointer | null> {
    if (!await pathExists(this.#io, this.paths.current)) return null;
    try {
      return parseGenerationPointer(await readJson<unknown>(this.#io, this.paths.current));
    } catch (error) {
      throw new DurableHostError('MOD_POINTER_CORRUPT', 'current generation pointer is malformed', { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  get hostIo(): HostIo { return this.#io; }
  generationPath(generation: number): string { return join(this.paths.generations, generationName(generation)); }
  journalPath(transactionId: string): string { return join(this.paths.transactions, `${transactionId}.json`); }

  async #writeJournal(journal: HostTransactionJournal): Promise<void> {
    const valid = parseHostTransactionJournal(journal);
    const redacted = redactHostValue(valid, this.#options.secrets ?? []) as HostTransactionJournal;
    await atomicWrite(this.#io, this.journalPath(journal.transactionId), JSON.stringify(redacted, null, 2) + String.fromCharCode(10));
  }

  async #writeReceipt(receipt: HostTransactionReceipt): Promise<void> {
    const redacted = redactHostValue(receipt, this.#options.secrets ?? []) as HostTransactionReceipt;
    await writeNewImmutableFile(this.#io, join(this.paths.receipts, receipt.transactionId + '.' + receipt.outcome + '.json'), JSON.stringify(redacted, null, 2) + String.fromCharCode(10));
  }

  #transition(journal: HostTransactionJournal, state: HostJournalState, steps: readonly HostJournalStep[], rollback = journal.rollback): HostTransactionJournal {
    return Object.freeze({ ...journal, state, updatedAt: this.#now().toISOString(), steps: Object.freeze([...steps]), rollback: Object.freeze({ ...rollback }) });
  }

  #event(event: string, level: HostEvent['level'], ownerId: string, generation: number | null, transactionId: string | null, details: Record<string, unknown> = {}): void {
    this.#events.push(createHostEvent({ event, level, ownerId, generation, transactionId, at: this.#now().toISOString(), details }, this.#options.secrets));
  }

  async #fault(point: HostFaultPoint): Promise<void> { await this.#options.fault?.(point); }

  async #writeGenerationFiles(staging: string, input: CommitGenerationInput, generation: number, transactionId: string): Promise<GenerationManifest> {
    const lockBytes = `${canonicalJson(input.lock)}\n`;
    const desiredBytes = `${canonicalJson(input.desiredState)}\n`;
    const installedBytes = `${canonicalJson(input.installedIndex)}\n`;
    const reservedPaths = new Set(['mods.lock.json', 'desired-state.json', 'installed-index.json', 'generation.json']);
    for (const path of Object.keys(input.files ?? {})) {
      if (reservedPaths.has(path)) throw new TypeError('generation input cannot override reserved path: ' + path);
    }
    const files: Record<string, string | Uint8Array> = {
      ...(input.files ?? {}),
      'mods.lock.json': lockBytes,
      'desired-state.json': desiredBytes,
      'installed-index.json': installedBytes,
    };
    const hashes: Record<string, `sha256:${string}`> = {};
    for (const [rawPath, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
      const path = safeRelativePath(rawPath);
      const destination = resolve(staging, path);
      if (relative(staging, destination).startsWith('..')) throw new TypeError(`generation path escapes staging: ${path}`);
      await this.#io.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await this.#io.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      await this.#io.syncFile(destination);
      hashes[path] = hashBytes(bytes);
    }
    const lockHash = hashBytes(lockBytes);
    const manifestWithoutHash = {
      schemaVersion: 1 as const,
      generation,
      graphHash: input.lock.graphHash,
      lockHash,
      kernelVersion: this.#options.kernelVersion,
      transactionId,
      createdAt: this.#now().toISOString(),
      files: Object.freeze(hashes),
    };
    const manifest: GenerationManifest = Object.freeze({ ...manifestWithoutHash, contentHash: sha256Canonical(manifestWithoutHash) });
    const manifestPath = join(staging, 'generation.json');
    await this.#io.writeFile(manifestPath, `${canonicalJson(manifest)}\n`, { flag: 'wx', mode: 0o600 });
    await this.#io.syncFile(manifestPath);
    await this.#io.syncDirectory(staging);
    return manifest;
  }

  async validateGeneration(generation: number): Promise<GenerationManifest> {
    const root = this.generationPath(generation);
    try {
      const manifest = parseGenerationManifest(await readJson<unknown>(this.#io, join(root, 'generation.json')));
      const { contentHash, ...unsigned } = manifest;
      if (manifest.schemaVersion !== 1 || manifest.generation !== generation || manifest.kernelVersion !== this.#options.kernelVersion) throw new Error('generation identity or kernel mismatch');
      if (sha256Canonical(unsigned) !== contentHash) throw new Error('generation manifest hash mismatch');
      const actualFiles = (await listFiles(this.#io, root)).filter((path) => path !== 'generation.json');
      const declaredFiles = Object.keys(manifest.files).sort();
      if (canonicalJson(actualFiles) !== canonicalJson(declaredFiles)) throw new Error('generation contains undeclared or missing files');
      const lockBytes = await this.#io.readFile(join(root, 'mods.lock.json'));
      const generationLock = JSON.parse(new TextDecoder().decode(lockBytes)) as CanonicalModLock;
      if (hashBytes(lockBytes) !== manifest.lockHash) throw new Error('generation lock hash mismatch');
      if (generationLock.graphHash !== manifest.graphHash) throw new Error('generation graph hash mismatch');
      for (const [path, expected] of Object.entries(manifest.files)) {
        const actual = hashBytes(await this.#io.readFile(join(root, safeRelativePath(path))));
        if (actual !== expected) throw new Error(`content hash mismatch: ${path}`);
      }
      return Object.freeze(manifest);
    } catch (error) {
      if (error instanceof DurableHostError) throw error;
      throw new DurableHostError('MOD_GENERATION_CORRUPT', `generation ${generation} failed validation`, { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  async commitGeneration(input: CommitGenerationInput): Promise<CommitGenerationResult> {
    await this.initialize();
    const ownerId = this.#options.ownerId ?? 'agon.kernel';
    const fence = await WriterFence.acquire(this.paths.writerLock, ownerId, {
      ...this.#options.writerLock,
      io: this.#io,
      now: this.#now,
      processIdentity: this.#processIdentity,
    });
    let journal: HostTransactionJournal | undefined;
    let staging = '';
    let candidatePath = '';
    let committed = false;
    let simulatedCrash = false;
    let selectedPointer: GenerationPointer | null = null;
    const eventOffset = this.#events.length;
    try {
      await this.#fault('after-lock');
      const previous = await this.readCurrentPointer();
      if (input.expectedBaseGeneration !== undefined && input.expectedBaseGeneration !== (previous?.generation ?? 0)) {
        throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'generation changed after activation preview', {
          expectedBaseGeneration: input.expectedBaseGeneration, actualBaseGeneration: previous?.generation ?? 0,
        });
      }
      const candidateGeneration = (previous?.generation ?? 0) + 1;
      const transactionId = randomUUID();
      staging = join(this.paths.staging, transactionId);
      candidatePath = this.generationPath(candidateGeneration);
      if (await pathExists(this.#io, candidatePath)) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'candidate generation already exists');
      const startedAt = this.#now().toISOString();
      const candidateLockHash = hashBytes(`${canonicalJson(input.lock)}\n`);
      const initialJournal: HostTransactionJournal = Object.freeze({
        schemaVersion: 1,
        transactionId,
        operation: input.operation,
        state: 'preparing',
        startedAt,
        updatedAt: startedAt,
        baseGeneration: previous?.generation ?? 0,
        candidateGeneration,
        fenceToken: fence.record.fenceToken,
        previousLockHash: previous?.lockHash ?? null,
        candidateLockHash,
        steps: Object.freeze([{ id: 'stage-generation', state: 'running' as const }]),
        rollback: Object.freeze({ attempted: false, completed: false }),
      });
      journal = initialJournal;
      await this.#writeJournal(initialJournal);
      this.#event('transaction.preparing', 'info', ownerId, candidateGeneration, transactionId);
      await this.#fault('after-journal-preparing');
      await this.#io.mkdir(staging, { recursive: false, mode: 0o700 });
      const manifest = await this.#writeGenerationFiles(staging, input, candidateGeneration, transactionId);
      await this.#fault('after-staging');
      journal = this.#transition(initialJournal, 'verified', [
        { id: 'stage-generation', state: 'passed' },
        { id: 'verify-generation', state: 'passed' },
        { id: 'select-generation', state: 'pending' },
        { id: 'cleanup', state: 'pending' },
      ]);
      await this.#writeJournal(journal);
      await this.#fault('after-journal-verified');
      await fence.assertOwned();
      await this.#io.rename(staging, candidatePath);
      await this.#io.syncDirectory(this.paths.generations);
      staging = '';
      await freezeTree(this.#io, candidatePath);
      await this.#fault('after-generation-rename');
      await fence.assertOwned();
      const pointer: GenerationPointer = Object.freeze({
        schemaVersion: 1,
        generation: candidateGeneration,
        graphHash: manifest.graphHash,
        lockHash: manifest.lockHash,
        transactionId,
        selectedAt: this.#now().toISOString(),
      });
      selectedPointer = pointer;
      await atomicWrite(this.#io, this.paths.current, `${canonicalJson(pointer)}\n`);
      committed = true;
      await this.#fault('after-pointer-switch');
      journal = this.#transition(journal, 'committed', journal.steps.map((step) => step.id === 'select-generation' ? { ...step, state: 'passed' } : step));
      await this.#writeJournal(journal);
      await this.#fault('after-journal-committed');
      await atomicWrite(this.#io, this.paths.installedIndex, `${canonicalJson(input.installedIndex)}\n`);
      await atomicWrite(this.#io, this.paths.desiredState, `${canonicalJson(input.desiredState)}\n`);
      await this.#fault('after-installed-index');
      journal = this.#transition(journal, 'committed', journal.steps.map((step) => step.id === 'cleanup' ? { ...step, state: 'passed' } : step));
      await this.#writeJournal(journal);
      await this.#fault('after-final-journal');
      this.#event('transaction.committed', 'info', ownerId, candidateGeneration, transactionId, { graphHash: pointer.graphHash });
      const events = Object.freeze(this.#events.slice(eventOffset));
      await this.#writeReceipt(Object.freeze({ schemaVersion: 1, transactionId, ownerId, outcome: 'committed', pointer, journal, events }));
      return Object.freeze({ pointer, journal, events });
    } catch (error) {
      if (error instanceof SimulatedHostCrash) { simulatedCrash = true; throw error; }
      if (journal && !committed) {
        await this.#io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        if (candidatePath && await pathExists(this.#io, candidatePath)) {
          await makeTreeRemovable(this.#io, candidatePath).catch(() => undefined);
          await this.#io.rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
        }
        journal = this.#transition(journal, 'rolled-back', journal.steps.map((step) => step.state === 'running' || step.state === 'pending' ? { ...step, state: 'rolled-back', error: error instanceof Error ? error.message : String(error) } : step), { attempted: true, completed: true });
        await this.#writeJournal(journal).catch(() => undefined);
        this.#event('transaction.rolled-back', 'warning', ownerId, journal.candidateGeneration, journal.transactionId, { error: error instanceof Error ? error.message : String(error) });
        await this.#writeReceipt(Object.freeze({
          schemaVersion: 1, transactionId: journal.transactionId, ownerId, outcome: 'rolled-back',
          pointer: selectedPointer, journal, events: Object.freeze(this.#events.slice(eventOffset)),
        })).catch(() => undefined);
      } else if (journal && committed) {
        this.#event('transaction.restart-required', 'error', ownerId, journal.candidateGeneration, journal.transactionId, { error: error instanceof Error ? error.message : String(error) });
        await this.#writeReceipt(Object.freeze({
          schemaVersion: 1, transactionId: journal.transactionId, ownerId, outcome: 'restart-required',
          pointer: selectedPointer, journal, events: Object.freeze(this.#events.slice(eventOffset)),
        })).catch(() => undefined);
        throw new DurableHostError('MOD_RESTART_REQUIRED', 'generation committed but host cleanup or reload did not finish', {
          transactionId: journal.transactionId,
          generation: journal.candidateGeneration,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (error instanceof DurableHostError) throw error;
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'generation transaction failed before commit', { cause: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!simulatedCrash) await fence.release().catch(() => undefined);
    }
  }

  async #hasBoundTerminalReceipt(journal: HostTransactionJournal): Promise<boolean> {
    const entries = await this.#io.readdir(this.paths.receipts, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(journal.transactionId + '.') || !entry.name.endsWith('.json')) continue;
      try {
        const receipt = await readJson<Record<string, unknown>>(this.#io, join(this.paths.receipts, entry.name));
        if (receipt.schemaVersion !== 1 || receipt.transactionId !== journal.transactionId || typeof receipt.ownerId !== 'string' || !Array.isArray(receipt.events)) continue;
        if (!['committed', 'restart-required', 'recovered-committed'].includes(String(receipt.outcome))) continue;
        const persistedJournal = parseHostTransactionJournal(receipt.journal);
        if (persistedJournal.transactionId !== journal.transactionId || persistedJournal.candidateGeneration !== journal.candidateGeneration || persistedJournal.state !== journal.state) continue;
        if (receipt.pointer === null || receipt.pointer === undefined) continue;
        const receiptPointer = parseGenerationPointer(receipt.pointer);
        if (receiptPointer.transactionId !== journal.transactionId || receiptPointer.generation !== journal.candidateGeneration || receiptPointer.lockHash !== journal.candidateLockHash) continue;
        return true;
      } catch { /* malformed receipts never establish terminal evidence */ }
    }
    return false;
  }

  async recoverStaleWriter(isProcessAlive: (pid: number) => Promise<boolean>): Promise<void> {
    await this.initialize();
    const fence = await WriterFence.recoverStale(this.paths.writerLock, (this.#options.ownerId ?? 'agon.kernel') + '.stale-recovery', {
      ...this.#options.writerLock, io: this.#io, now: this.#now, processIdentity: this.#processIdentity, isProcessAlive,
    });
    await fence.release();
  }

  async recoverTransactions(): Promise<readonly string[]> {
    await this.initialize();
    const fence = await WriterFence.acquire(this.paths.writerLock, (this.#options.ownerId ?? 'agon.kernel') + '.recovery', {
      ...this.#options.writerLock, io: this.#io, now: this.#now, processIdentity: this.#processIdentity,
    });
    try {
      return await this.#recoverTransactionsUnderFence();
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async #recoverTransactionsUnderFence(): Promise<readonly string[]> {
    const recovered: string[] = [];
    const files = (await this.#io.readdir(this.paths.transactions, { withFileTypes: true }))
      .filter((entry: any) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry: any) => entry.name).sort();
    let pointer: GenerationPointer | null = null;
    try { pointer = await this.readCurrentPointer(); } catch { /* boot selects safe mode later */ }
    for (const file of files) {
      let journal: HostTransactionJournal;
      try {
        journal = parseHostTransactionJournal(await readJson<unknown>(this.#io, join(this.paths.transactions, file)));
      } catch (error) {
        this.#event('journal.corrupt', 'error', (this.#options.ownerId ?? 'agon.kernel') + '.recovery', null, file.slice(0, -5), {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const terminalStep = journal.steps.find((step) => step.id === 'cleanup') ?? journal.steps.find((step) => step.id === 'restore-snapshots');
      const cleanupComplete = terminalStep?.state === 'passed';
      if (journal.state === 'committed' && cleanupComplete) {
        if (await this.#hasBoundTerminalReceipt(journal)) continue;
        try {
          const manifest = await this.validateGeneration(journal.candidateGeneration);
          const receiptPointer: GenerationPointer = pointer?.transactionId === journal.transactionId ? pointer : Object.freeze({
            schemaVersion: 1, generation: journal.candidateGeneration, graphHash: manifest.graphHash, lockHash: manifest.lockHash,
            transactionId: journal.transactionId, selectedAt: journal.updatedAt,
          });
          const ownerId = (this.#options.ownerId ?? 'agon.kernel') + '.recovery';
          this.#event('receipt.reconciled', 'warning', ownerId, journal.candidateGeneration, journal.transactionId);
          const recoveryEvent = this.#events[this.#events.length - 1];
          if (!recoveryEvent) throw new Error('receipt reconciliation event was not recorded');
          await this.#writeReceipt(Object.freeze({
            schemaVersion: 1, transactionId: journal.transactionId, ownerId, outcome: 'recovered-committed',
            pointer: receiptPointer, journal, events: Object.freeze([recoveryEvent]),
          }));
          recovered.push(journal.transactionId);
        } catch (error) {
          this.#event('receipt.missing', 'error', (this.#options.ownerId ?? 'agon.kernel') + '.recovery', journal.candidateGeneration, journal.transactionId, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      const needsCommittedCleanup = journal.state === 'committed' && !cleanupComplete;
      if (journal.state !== 'preparing' && journal.state !== 'verified' && !needsCommittedCleanup) continue;
      if (pointer?.generation === journal.candidateGeneration && pointer.transactionId === journal.transactionId) {
        journal = this.#transition(journal, 'committed', journal.steps.map((step) => step.id === 'select-generation' || step.id === 'cleanup' || step.id === 'restore-snapshots' ? { ...step, state: 'passed' } : step));
        const selectedRoot = this.generationPath(journal.candidateGeneration);
        await atomicWrite(this.#io, this.paths.installedIndex, await this.#io.readFile(join(selectedRoot, 'installed-index.json')));
        await atomicWrite(this.#io, this.paths.desiredState, await this.#io.readFile(join(selectedRoot, 'desired-state.json')));
      } else {
        const staging = join(this.paths.staging, journal.transactionId);
        await this.#io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        const candidate = this.generationPath(journal.candidateGeneration);
        if (await pathExists(this.#io, candidate)) {
          await makeTreeRemovable(this.#io, candidate).catch(() => undefined);
          await this.#io.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
        }
        journal = this.#transition(journal, 'rolled-back', journal.steps.map((step) => step.state === 'pending' || step.state === 'running' ? { ...step, state: 'rolled-back' } : step), { attempted: true, completed: true });
      }
      await this.#writeJournal(journal);
      const ownerId = (this.#options.ownerId ?? 'agon.kernel') + '.recovery';
      const outcome = journal.state === 'committed' ? 'recovered-committed' : 'recovered-rolled-back';
      this.#event('transaction.' + outcome, 'warning', ownerId, journal.candidateGeneration, journal.transactionId);
      const recoveryEvent = this.#events[this.#events.length - 1];
      if (!recoveryEvent) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'recovery event was not recorded');
      await this.#writeReceipt(Object.freeze({
        schemaVersion: 1, transactionId: journal.transactionId, ownerId, outcome,
        pointer: pointer?.transactionId === journal.transactionId ? pointer : null,
        journal, events: Object.freeze([recoveryEvent]),
      }));
      recovered.push(journal.transactionId);
    }
    return Object.freeze(recovered);
  }

  async #validateSelectedJournal(pointer: GenerationPointer): Promise<void> {
    try {
      const journal = parseHostTransactionJournal(await readJson<unknown>(this.#io, this.journalPath(pointer.transactionId)));
      if (journal.schemaVersion !== 1 || journal.transactionId !== pointer.transactionId || journal.candidateGeneration !== pointer.generation || journal.state !== 'committed') {
        throw new Error('selected transaction is not committed or does not bind the pointer');
      }
    } catch (error) {
      throw new DurableHostError('MOD_POINTER_CORRUPT', 'current pointer transaction journal is invalid', { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  async boot(): Promise<HostBootResult> {
    const recoveredTransactions = await this.recoverTransactions();
    try {
      const pointer = await this.readCurrentPointer();
      if (!pointer) return Object.freeze({ mode: 'kernel-only', pointer: null, reason: 'no generation selected', recoveredTransactions });
      await this.#validateSelectedJournal(pointer);
      const manifest = await this.validateGeneration(pointer.generation);
      if (manifest.graphHash !== pointer.graphHash || manifest.lockHash !== pointer.lockHash) throw new DurableHostError('MOD_POINTER_CORRUPT', 'pointer does not match generation manifest');
      return Object.freeze({ mode: 'normal', pointer, reason: null, recoveredTransactions });
    } catch (currentError) {
      let rejectedGeneration: number | null = null;
      try { rejectedGeneration = (await this.readCurrentPointer())?.generation ?? null; } catch { rejectedGeneration = null; }
      const entries = (await this.#io.readdir(this.paths.generations, { withFileTypes: true }))
        .filter((entry: any) => entry.isDirectory() && /^\d{16}$/.test(entry.name))
        .map((entry: any) => Number(entry.name)).sort((a: number, b: number) => b - a);
      for (const generation of entries) {
        if (generation === rejectedGeneration) continue;
        try {
          const manifest = await this.validateGeneration(generation);
          const pointer: GenerationPointer = Object.freeze({
            schemaVersion: 1, generation, graphHash: manifest.graphHash, lockHash: manifest.lockHash,
            transactionId: manifest.transactionId, selectedAt: manifest.createdAt,
          });
          return Object.freeze({ mode: 'safe-mode', pointer, reason: currentError instanceof Error ? currentError.message : String(currentError), recoveredTransactions });
        } catch { /* deterministic descending generation search */ }
      }
      return Object.freeze({ mode: 'kernel-only', pointer: null, reason: currentError instanceof Error ? currentError.message : String(currentError), recoveredTransactions });
    }
  }

  async assertHostGeneration(loadedGeneration: number): Promise<void> {
    const current = await this.readCurrentPointer();
    if (!current || current.generation !== loadedGeneration) {
      throw new DurableHostError('MOD_RESTART_REQUIRED', 'host generation is stale; restart before dispatch', {
        loadedGeneration,
        currentGeneration: current?.generation ?? null,
      });
    }
  }

  #generationLeaseStore(): GenerationLeaseStore {
    return new GenerationLeaseStore({
      directory: this.paths.leases, writerLockPath: this.paths.writerLock, processIdentity: this.#processIdentity,
      validateGeneration: (generation) => this.validateGeneration(generation), io: this.#io, now: this.#now,
    });
  }

  async leaseGeneration(generation: number, ownerId: string): Promise<GenerationLease> {
    return this.#generationLeaseStore().acquire(generation, ownerId);
  }

  async heartbeatGenerationLease(leaseId: string): Promise<GenerationLease> {
    return this.#generationLeaseStore().heartbeat(leaseId);
  }

  async releaseGenerationLease(leaseId: string): Promise<GenerationLease> {
    return this.#generationLeaseStore().release(leaseId);
  }

  async recoverDeadGenerationLease(leaseId: string, isProcessAlive: (pid: number) => Promise<boolean>): Promise<GenerationLease> {
    return this.#generationLeaseStore().recoverDead(leaseId, isProcessAlive);
  }

  async disposeOwners(ownersInDependencyOrder: readonly DisposableOwner[], timeoutMs: number): Promise<void> {
    return disposeGenerationOwners(ownersInDependencyOrder, timeoutMs);
  }

  async doctor(blocked: readonly HostBlockedReason[] = []): Promise<HostDoctorReport> {
    try {
      const boot = await this.boot();
      const failures = this.#events.filter(({ level }) => level === 'error');
      return createDoctorReport({
        status: boot.mode === 'normal' && failures.length === 0 ? 'healthy' : boot.mode === 'safe-mode' ? 'safe-mode' : 'degraded',
        generation: boot.pointer?.generation ?? null,
        graphHash: boot.pointer?.graphHash ?? null,
        reason: boot.reason,
        journalRecovery: boot.recoveredTransactions,
        blocked,
        failures,
      }, this.#options.secrets);
    } catch (error) {
      let pointer: GenerationPointer | null = null;
      try { pointer = await this.readCurrentPointer(); } catch { /* the report remains kernel-only */ }
      this.#event('doctor.host-unavailable', 'error', this.#options.ownerId ?? 'agon.kernel', pointer?.generation ?? null, null, {
        error: error instanceof Error ? error.message : String(error),
      });
      return createDoctorReport({
        status: 'degraded', generation: pointer?.generation ?? null, graphHash: pointer?.graphHash ?? null,
        reason: error instanceof Error ? error.message : String(error), journalRecovery: [], blocked,
        failures: this.#events.filter(({ level }) => level === 'error'),
      }, this.#options.secrets);
    }
  }
}
