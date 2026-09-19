import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
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

  constructor(options: GenerationLeaseStoreOptions) {
    this.#options = options;
    this.#io = options.io ?? nodeHostIo;
    this.#now = options.now ?? (() => new Date());
  }

  async #readLease(path: string): Promise<GenerationLease> {
    try {
      return parseGenerationLease(await readJson<unknown>(this.#io, path));
    } catch (error) {
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'generation lease is malformed', {
        path, cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #mutate<T>(action: () => Promise<T>): Promise<T> {
    const fence = await WriterFence.acquire(this.#options.writerLockPath, 'agon.kernel.generation-leases', {
      io: this.#io,
      now: this.#now,
      processIdentity: this.#options.processIdentity,
      pid: this.#options.pid,
    });
    try {
      return await action();
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async acquire(generation: number, ownerId: string): Promise<GenerationLease> {
    return this.#mutate(async () => {
      await this.#options.validateGeneration(generation);
      const at = this.#now().toISOString();
      const lease: GenerationLease = Object.freeze({
        schemaVersion: 1,
        leaseId: randomUUID(),
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
    });
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
    return this.#mutate(async () => {
      const path = leaseFile(this.#options.directory, leaseId);
      const current = await this.#readLease(path);
      if (current.releasedAt) return current;
      if (current.processIdentity !== this.#options.processIdentity) throw new DurableHostError('MOD_FENCE_LOST', 'generation lease belongs to another process identity', { leaseId });
      const released: GenerationLease = Object.freeze({ ...current, releasedAt: this.#now().toISOString() });
      await atomicWrite(this.#io, path, canonicalJson(released) + String.fromCharCode(10));
      return released;
    });
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
    const entries = await this.#io.readdir(this.#options.directory, { withFileTypes: true });
    const leases: GenerationLease[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const lease = await this.#readLease(join(this.#options.directory, entry.name));
      if (!lease.releasedAt && (generation === undefined || lease.generation === generation)) leases.push(lease);
    }
    return Object.freeze(leases.sort((a, b) => a.leaseId.localeCompare(b.leaseId)));
  }
}
