import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DurableHostError } from './host-errors.js';
import { atomicWrite, nodeHostIo, readJson, type HostIo } from './host-io.js';
import { canonicalJson } from './lock.js';
import type { GenerationLease } from './durable-host.js';
import { parseGenerationLease } from './host-contracts.js';
import { WriterFence } from './writer-lock.js';

export interface GenerationLeaseStoreOptions {
  readonly directory: string;
  readonly writerLockPath: string;
  readonly processIdentity: string;
  readonly validateGeneration: (generation: number) => Promise<unknown>;
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly pid?: number;
  /** Retry budget for contention. Filesystem operations have their own duration. */
  readonly writerWaitMs?: number;
}

function leaseFile(directory: string, leaseId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseId) || basename(leaseId) !== leaseId) {
    throw new TypeError('lease ID must be a UUID');
  }
  return join(directory, `${leaseId}.json`);
}

export class GenerationLeaseStore {
  readonly #options: GenerationLeaseStoreOptions;
  readonly #io: HostIo;
  readonly #now: () => Date;
  readonly #pendingFences = new Set<WriterFence>();
  readonly #pendingReleases = new Set<string>();
  #cleanup: Promise<void> | undefined;

  constructor(options: GenerationLeaseStoreOptions) {
    if (options.writerWaitMs !== undefined && (!Number.isSafeInteger(options.writerWaitMs) || options.writerWaitMs < 0)) {
      throw new RangeError('lease writer wait must be a non-negative safe integer');
    }
    this.#options = options;
    this.#io = options.io ?? nodeHostIo;
    this.#now = options.now ?? (() => new Date());
  }

  async #readLease(path: string): Promise<GenerationLease> {
    try {
      const lease = parseGenerationLease(await readJson<unknown>(this.#io, path));
      if (path !== leaseFile(this.#options.directory, lease.leaseId)) throw new TypeError('generation lease filename does not match its identity');
      return lease;
    } catch (error) {
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'generation lease is malformed', {
        path, cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #releaseFence(fence: WriterFence): Promise<void> {
    try {
      await fence.release();
      this.#pendingFences.delete(fence);
    } catch (error) {
      this.#pendingFences.add(fence);
      throw error;
    }
  }

  /** Retry only this owner's failed cleanup. Never reclaim another owner's lock. */
  retryPendingCleanup(): Promise<void> {
    return this.#cleanup ??= this.#drainPendingCleanup().finally(() => { this.#cleanup = undefined; });
  }

  async #drainPendingCleanup(): Promise<void> {
    const errors: unknown[] = [];
    for (const fence of [...this.#pendingFences]) {
      try { await this.#releaseFence(fence); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'generation writer cleanup remains pending');
    for (const leaseId of [...this.#pendingReleases]) {
      try {
        // Publication can fail before or after rename. Missing means no lease exists.
        try { await this.#io.readFile(leaseFile(this.#options.directory, leaseId)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          this.#pendingReleases.delete(leaseId);
          continue;
        }
        await this.release(leaseId);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'generation lease cleanup remains pending');
  }

  async #mutate<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const deadline = performance.now() + (this.#options.writerWaitMs ?? 5_000);
    let fence: WriterFence;
    let contention: DurableHostError | undefined;
    for (;;) {
      signal?.throwIfAborted();
      if (contention && performance.now() >= deadline) throw contention;
      try {
        fence = await WriterFence.acquire(this.#options.writerLockPath, 'agon.kernel.generation-leases', {
          io: this.#io,
          now: this.#now,
          processIdentity: this.#options.processIdentity,
          pid: this.#options.pid,
        });
        break;
      } catch (error) {
        signal?.throwIfAborted();
        const remaining = deadline - performance.now();
        if (!(error instanceof DurableHostError) || error.code !== 'MOD_HOST_BUSY' || remaining <= 0) throw error;
        contention = error;
        // Wait for ownership. Never reclaim a live or malformed writer lock.
        try { await delay(Math.min(25, remaining), undefined, { signal }); }
        catch (error) { signal?.throwIfAborted(); throw error; }
      }
    }
    let result: T;
    try {
      signal?.throwIfAborted();
      result = await action();
    } catch (error) {
      try { await this.#releaseFence(fence); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'generation lease action and writer cleanup failed'); }
      throw error;
    }
    await this.#releaseFence(fence);
    return result;
  }

  async acquire(generation: number, ownerId: string, signal?: AbortSignal): Promise<GenerationLease> {
    let leaseId: string | undefined;
    try {
      return await this.#mutate(async () => {
        await this.#options.validateGeneration(generation);
        const at = this.#now().toISOString();
        leaseId = randomUUID();
        const lease: GenerationLease = Object.freeze({
          schemaVersion: 1,
          leaseId,
          generation,
          ownerId,
          pid: this.#options.pid ?? process.pid,
          processIdentity: this.#options.processIdentity,
          createdAt: at,
          heartbeatAt: at,
          releasedAt: null,
        });
        await atomicWrite(this.#io, leaseFile(this.#options.directory, lease.leaseId), canonicalJson(lease) + String.fromCharCode(10));
        return lease;
      }, signal);
    } catch (error) {
      if (leaseId) this.#pendingReleases.add(leaseId);
      throw error;
    }
  }

  async heartbeat(leaseId: string): Promise<GenerationLease> {
    return this.#mutate(async () => {
      const path = leaseFile(this.#options.directory, leaseId);
      const current = await this.#readLease(path);
      if (current.releasedAt) throw new DurableHostError('MOD_FENCE_LOST', 'generation lease was already released', { leaseId });
      if (current.processIdentity !== this.#options.processIdentity) throw new DurableHostError('MOD_FENCE_LOST', 'generation lease belongs to another process identity', { leaseId });
      const updated: GenerationLease = Object.freeze({ ...current, heartbeatAt: this.#now().toISOString() });
      await atomicWrite(this.#io, path, canonicalJson(updated) + String.fromCharCode(10));
      return updated;
    });
  }

  async release(leaseId: string): Promise<GenerationLease> {
    const path = leaseFile(this.#options.directory, leaseId);
    try {
      const released = await this.#mutate(async () => {
        const current = await this.#readLease(path);
        if (current.releasedAt) return current;
        if (current.processIdentity !== this.#options.processIdentity) throw new DurableHostError('MOD_FENCE_LOST', 'generation lease belongs to another process identity', { leaseId });
        const released: GenerationLease = Object.freeze({ ...current, releasedAt: this.#now().toISOString() });
        await atomicWrite(this.#io, path, canonicalJson(released) + String.fromCharCode(10));
        return released;
      });
      this.#pendingReleases.delete(leaseId);
      return released;
    } catch (error) {
      if (!(error instanceof DurableHostError && error.code === 'MOD_FENCE_LOST')) this.#pendingReleases.add(leaseId);
      throw error;
    }
  }

  async recoverDead(leaseId: string, isProcessAlive: (pid: number) => Promise<boolean>): Promise<GenerationLease> {
    return this.#mutate(async () => {
      const path = leaseFile(this.#options.directory, leaseId);
      const first = await this.#readLease(path);
      if (first.releasedAt) return first;
      if (await isProcessAlive(first.pid)) {
        throw new DurableHostError('MOD_HOST_BUSY', 'generation lease owner PID is still alive; recovery refused', { leaseId, pid: first.pid });
      }
      const second = await this.#readLease(path);
      if (canonicalJson(first) !== canonicalJson(second)) {
        throw new DurableHostError('MOD_HOST_BUSY', 'generation lease heartbeat changed during recovery', { leaseId });
      }
      const released: GenerationLease = Object.freeze({ ...second, releasedAt: this.#now().toISOString() });
      await atomicWrite(this.#io, path, canonicalJson(released) + String.fromCharCode(10));
      return released;
    });
  }

  async active(generation?: number): Promise<readonly GenerationLease[]> {
    const entries = await this.#io.readdir(this.#options.directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const leases: GenerationLease[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'generation lease must be a regular file', { path: join(this.#options.directory, entry.name) });
      const lease = await this.#readLease(join(this.#options.directory, entry.name));
      if (!lease.releasedAt && (generation === undefined || lease.generation === generation)) leases.push(lease);
    }
    return Object.freeze(leases.sort((a, b) => a.leaseId.localeCompare(b.leaseId)));
  }
}
