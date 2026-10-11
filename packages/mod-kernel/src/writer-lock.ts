import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  return Object.freeze({ schemaVersion: 1, ownerId, pid: options.pid ?? process.pid,
    processIdentity: options.processIdentity ?? randomUUID(), fenceToken: randomUUID(),
    createdAt: timestamp, heartbeatAt: timestamp });
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

function defaultProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return Promise.resolve(code !== 'ESRCH');
  }
}

export class WriterFence {
  readonly record: WriterLockRecord;
  readonly path: string;
  readonly reclaimPath: string;
  readonly #io: HostIo;
  readonly #now: () => Date;
  #released = false;

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
    const io = options.io ?? nodeHostIo;
    const isProcessAlive = options.isProcessAlive ?? defaultProcessAlive;
    const reclaimPath = `${path}.reclaim`;
    await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await io.writeFile(reclaimPath, `${JSON.stringify({ ownerId, token: randomUUID() })}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DurableHostError('MOD_HOST_BUSY', 'another process is validating stale-writer recovery');
      }
      throw error;
    }
    try {
      const first = await readJson<WriterLockRecord>(io, path);
      if (await isProcessAlive(first.pid)) {
        throw new DurableHostError('MOD_HOST_BUSY', 'writer PID is still alive; stale recovery refused', { pid: first.pid });
      }
      const second = await readJson<WriterLockRecord>(io, path);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new DurableHostError('MOD_HOST_BUSY', 'writer heartbeat changed during stale recovery');
      }
      await io.rm(path);
      await io.syncDirectory(dirname(path));
    } finally {
      await io.rm(reclaimPath, { force: true });
    }
    return WriterFence.acquire(path, ownerId, options);
  }

  async assertOwned(): Promise<void> {
    if (this.#released) throw new DurableHostError('MOD_FENCE_LOST', 'writer fence was already released');
    const current = await readJson<WriterLockRecord>(this.#io, this.path).catch(() => undefined);
    assertRecordOwned(current, this.record);
  }

  async heartbeat(): Promise<void> {
    await this.assertOwned();
    if (await pathExists(this.#io, this.reclaimPath)) {
      throw new DurableHostError('MOD_FENCE_LOST', 'stale recovery is validating this writer');
    }
    const updated: WriterLockRecord = { ...this.record, heartbeatAt: this.#now().toISOString() };
    await atomicWrite(this.#io, this.path, `${JSON.stringify(updated)}\n`);
    await this.assertOwned();
  }

  async release(): Promise<void> {
    if (this.#released) return;
    await this.assertOwned();
    await this.#io.rm(this.path);
    await this.#io.syncDirectory(dirname(this.path));
    this.#released = true;
  }

  releaseSync(): void {
    if (this.#released) return;
    let current: WriterLockRecord | undefined;
    try { current = JSON.parse(readFileSync(this.path, 'utf8')) as WriterLockRecord; }
    catch { /* Missing or malformed ownership never permits deletion. */ }
    assertRecordOwned(current, this.record);
    unlinkSync(this.path);
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
