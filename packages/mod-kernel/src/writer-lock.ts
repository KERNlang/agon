import { randomUUID } from 'node:crypto';
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
    const timestamp = now().toISOString();
    const record: WriterLockRecord = Object.freeze({
      schemaVersion: 1,
      ownerId,
      pid: options.pid ?? process.pid,
      processIdentity: options.processIdentity ?? randomUUID(),
      fenceToken: randomUUID(),
      createdAt: timestamp,
      heartbeatAt: timestamp,
    });
    await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await io.writeFile(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
      await io.syncFile(path);
      await io.syncDirectory(dirname(path));
      return new WriterFence(path, record, io, now);
    } catch (error) {
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
    if (!current || current.fenceToken !== this.record.fenceToken || current.processIdentity !== this.record.processIdentity) {
      throw new DurableHostError('MOD_FENCE_LOST', 'writer fence token no longer owns the lock');
    }
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
}
