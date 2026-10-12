import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { atomicWrite, nodeHostIo, pathExists, readJson, type HostIo } from './host-io.js';
import { DurableHostError } from './host-errors.js';

export interface WriterLockRecord {
  readonly schemaVersion: 1;
  readonly ownerId: string;
  readonly pid: number;
  readonly processIdentity: string;
  readonly fenceToken: string;
  readonly createdAt: string;
  readonly heartbeatAt: string;
}

export interface WriterLockOptions {
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly pid?: number;
  readonly processIdentity?: string;
  readonly isProcessAlive?: (pid: number) => Promise<boolean>;
}

type SyncWriterLockOptions = Pick<WriterLockOptions, 'now' | 'pid' | 'processIdentity'>;

function createRecord(ownerId: string, options: SyncWriterLockOptions): WriterLockRecord {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze(parseWriterLockRecord({ schemaVersion: 1, ownerId, pid: options.pid ?? process.pid,
    processIdentity: options.processIdentity ?? randomUUID(), fenceToken: randomUUID(),
    createdAt: timestamp, heartbeatAt: timestamp }));
}

function assertRecordOwned(current: WriterLockRecord | undefined, expected: WriterLockRecord): void {
  if (!current || current.fenceToken !== expected.fenceToken || current.processIdentity !== expected.processIdentity) {
    throw new DurableHostError('MOD_FENCE_LOST', 'writer fence token no longer owns the lock');
  }
}

function syncPath(path: string): void {
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function defaultProcessAlive(pid: number): Promise<boolean> { return processAlive(pid); }

// PID and unique identity survive even a partial marker write. Never use age.
function recoveryMarkers(path: string, names: readonly string[], ownPath?: string): Array<{ path: string; pid: number }> {
  const prefix = `${basename(path)}.reclaim`;
  return names.filter(name => name === prefix || name.startsWith(`${prefix}.`)).map(name => {
    const markerPath = join(dirname(path), name);
    if (ownPath && name === basename(ownPath)) return undefined;
    const match = /^\.([1-9][0-9]*)\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.exec(name.slice(prefix.length));
    const pid = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(pid)) {
      throw new DurableHostError('MOD_HOST_BUSY', 'unknown recovery marker requires explicit operator inspection');
    }
    return { path: markerPath, pid };
  }).filter((marker): marker is { path: string; pid: number } => marker !== undefined);
}

async function hasLiveRecovery(io: HostIo, path: string, ownPath?: string): Promise<boolean> {
  for (const marker of recoveryMarkers(path, await io.readdir(dirname(path)), ownPath)) {
    if (processAlive(marker.pid)) return true;
    await io.rm(marker.path, { force: true });
  }
  return false;
}

function hasLiveRecoverySync(path: string): boolean {
  for (const marker of recoveryMarkers(path, readdirSync(dirname(path)))) {
    if (processAlive(marker.pid)) return true;
    try { unlinkSync(marker.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return false;
}

function parseWriterLockRecord(value: unknown): WriterLockRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('writer lock must be an object');
  const record = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'ownerId', 'pid', 'processIdentity', 'fenceToken', 'createdAt', 'heartbeatAt'];
  if (Object.keys(record).sort().join('\0') !== fields.sort().join('\0')
    || record.schemaVersion !== 1 || !Number.isSafeInteger(record.pid) || Number(record.pid) < 1
    || ['ownerId', 'processIdentity', 'fenceToken'].some(key => typeof record[key] !== 'string' || !record[key])
    || ['createdAt', 'heartbeatAt'].some(key => typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key] as string)))) {
    throw new TypeError('writer lock has invalid or missing fields');
  }
  return record as unknown as WriterLockRecord;
}

async function readRecoveryLock(io: HostIo, path: string): Promise<WriterLockRecord> {
  try {
    return parseWriterLockRecord(await readJson<unknown>(io, path));
  } catch (error) {
    throw new DurableHostError('MOD_HOST_BUSY', 'writer lock is malformed or unreadable; explicit operator recovery is required', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export class WriterFence {
  readonly record: WriterLockRecord;
  readonly path: string;
  readonly reclaimPath: string;
  readonly #io: HostIo;
  readonly #now: () => Date;
  #released = false;
  #removed = false;
  #releaseInFlight: Promise<void> | undefined;

  private constructor(path: string, record: WriterLockRecord, io: HostIo, now: () => Date) {
    this.path = path;
    this.reclaimPath = `${path}.reclaim`;
    this.record = record;
    this.#io = io;
    this.#now = now;
  }

  static async acquire(path: string, ownerId: string, options: WriterLockOptions = {}): Promise<WriterFence> {
    const io = options.io ?? nodeHostIo;
    const now = options.now ?? (() => new Date());
    const record = createRecord(ownerId, { ...options, now });
    const fence = new WriterFence(path, record, io, now);
    let created = false;
    await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await io.writeFile(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
      created = true;
      await io.syncFile(path);
      await io.syncDirectory(dirname(path));
      if (await hasLiveRecovery(io, path)) throw new DurableHostError('MOD_HOST_BUSY', 'another process is validating stale-writer recovery');
      await fence.assertOwned();
      return fence;
    } catch (error) {
      if (created) {
        try { await fence.release(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'writer acquisition failed and owned-lock cleanup failed'); }
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: WriterLockRecord;
      try {
        existing = await readJson<WriterLockRecord>(io, path);
      } catch (lockError) {
        throw new DurableHostError('MOD_HOST_BUSY', 'writer lock is malformed; explicit operator recovery is required', {
          cause: lockError instanceof Error ? lockError.message : String(lockError),
        });
      }
      throw new DurableHostError('MOD_HOST_BUSY', 'another modular host writer owns the state lock', {
        ownerId: existing?.ownerId,
        pid: existing?.pid,
        fenceToken: existing?.fenceToken,
      });
    }
  }

  static acquireSync(path: string, ownerId: string, options: SyncWriterLockOptions = {}): WriterFence {
    const now = options.now ?? (() => new Date());
    const record = createRecord(ownerId, { ...options, now });
    const fence = new WriterFence(path, record, nodeHostIo, now);
    let created = false;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
      created = true;
      syncPath(path);
      syncPath(dirname(path));
      if (hasLiveRecoverySync(path)) throw new DurableHostError('MOD_HOST_BUSY', 'another process is validating stale-writer recovery');
      assertRecordOwned(JSON.parse(readFileSync(path, 'utf8')) as WriterLockRecord, record);
      return fence;
    } catch (error) {
      if (created) {
        try { fence.releaseSync(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'writer acquisition failed and owned-lock cleanup failed'); }
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new DurableHostError('MOD_HOST_BUSY', 'another modular host writer owns the state lock; retry the config write after it finishes');
    }
  }

  static async recoverStale(path: string, ownerId: string, options: WriterLockOptions = {}): Promise<WriterFence> {
    // Validate the new owner before removing the previous owner's record.
    createRecord(ownerId, options);
    const io = options.io ?? nodeHostIo;
    const isProcessAlive = options.isProcessAlive ?? defaultProcessAlive;
    const reclaimPath = `${path}.reclaim.${process.pid}.${randomUUID()}`;
    await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await io.writeFile(reclaimPath, `${JSON.stringify({ ownerId, token: randomUUID() })}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DurableHostError('MOD_HOST_BUSY', 'another process is validating stale-writer recovery');
      }
      try {
        await io.rm(reclaimPath, { force: true });
        await io.syncDirectory(dirname(path));
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'recovery marker publication and cleanup failed');
      }
      throw error;
    }
    const recoveryErrors: unknown[] = [];
    try {
      if (await hasLiveRecovery(io, path, reclaimPath)) {
        throw new DurableHostError('MOD_HOST_BUSY', 'another process is validating stale-writer recovery');
      }
      if (await pathExists(io, path)) {
        const first = await readRecoveryLock(io, path);
        for (let observation = 0; observation < 2; observation++) {
          if (await isProcessAlive(first.pid)) {
            throw new DurableHostError('MOD_HOST_BUSY', 'writer PID is still alive; stale recovery refused', { pid: first.pid });
          }
          const current = await readRecoveryLock(io, path);
          if (JSON.stringify(first) !== JSON.stringify(current)) {
            throw new DurableHostError('MOD_HOST_BUSY', 'writer heartbeat changed during stale recovery');
          }
        }
        await io.rm(path);
      }
      await io.syncDirectory(dirname(path));
    } catch (error) {
      recoveryErrors.push(error);
      throw error;
    } finally {
      try {
        await io.rm(reclaimPath, { force: true });
        await io.syncDirectory(dirname(path));
      } catch (cleanup) {
        if (recoveryErrors.length) throw new AggregateError([...recoveryErrors, cleanup], 'writer recovery and marker cleanup failed');
        throw cleanup;
      }
    }
    return WriterFence.acquire(path, ownerId, options);
  }

  async assertOwned(): Promise<void> {
    if (this.#released || this.#removed) throw new DurableHostError('MOD_FENCE_LOST', 'writer fence was already released');
    const current = await readJson<WriterLockRecord>(this.#io, this.path).catch(() => undefined);
    assertRecordOwned(current, this.record);
  }

  async heartbeat(): Promise<void> {
    await this.assertOwned();
    if (await hasLiveRecovery(this.#io, this.path)) {
      throw new DurableHostError('MOD_FENCE_LOST', 'stale recovery is validating this writer');
    }
    const updated: WriterLockRecord = { ...this.record, heartbeatAt: this.#now().toISOString() };
    await atomicWrite(this.#io, this.path, `${JSON.stringify(updated)}\n`);
    await this.assertOwned();
  }

  release(): Promise<void> {
    this.#releaseInFlight ??= this.#releaseOnce().finally(() => { this.#releaseInFlight = undefined; });
    return this.#releaseInFlight;
  }

  async #releaseOnce(): Promise<void> {
    if (this.#released) return;
    if (!this.#removed) {
      await this.assertOwned();
      await this.#io.rm(this.path);
      this.#removed = true;
    }
    await this.#io.syncDirectory(dirname(this.path));
    this.#released = true;
  }

  releaseSync(): void {
    if (this.#released) return;
    if (this.#releaseInFlight) throw new DurableHostError('MOD_HOST_BUSY', 'asynchronous writer release is still in progress');
    if (!this.#removed) {
      let current: WriterLockRecord | undefined;
      try { current = JSON.parse(readFileSync(this.path, 'utf8')) as WriterLockRecord; }
      catch { /* Missing or malformed ownership never permits deletion. */ }
      assertRecordOwned(current, this.record);
      unlinkSync(this.path);
      this.#removed = true;
    }
    syncPath(dirname(this.path));
    this.#released = true;
  }
}

/** Run synchronous config writes under the host publication fence. */
export function withSynchronousWriterFence(path: string, ownerId: string, action: () => undefined): void {
  if (Object.prototype.toString.call(action) === '[object AsyncFunction]') {
    throw new TypeError('writer fence callback must be synchronous');
  }
  const fence = WriterFence.acquireSync(path, ownerId);
  try { action(); }
  catch (error) {
    try { fence.releaseSync(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'config write failed and writer-fence cleanup failed'); }
    throw error;
  }
  try { fence.releaseSync(); }
  catch (cleanup) {
    throw new DurableHostError('MOD_RESTART_REQUIRED', 'config write completed but writer-fence cleanup failed; inspect config state before retrying', {
      outcome: 'action-completed',
      cause: cleanup instanceof Error ? cleanup.message : String(cleanup),
    });
  }
}
