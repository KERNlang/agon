import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MOD_ID_PATTERN } from '@kernlang/agon-mod-api';
import { valid as validVersion } from 'semver';

import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';
import { sha256Canonical } from './lock.js';
import { redactExternalDiagnostic } from './external-mod-services-safe.js';
import { WriterFence } from './writer-lock.js';

const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface ExternalActivationIdentity {
  readonly modId: string;
  readonly version: string;
  readonly source: 'user-folder' | 'explicit-dev';
  readonly sourceLocator: string;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly publisherHash: `sha256:${string}`;
}

export interface ExternalActivationRecord extends ExternalActivationIdentity {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly sequence: number;
  readonly enabled: boolean;
  readonly decidedAt: string;
  readonly decidedBy: 'local-user';
  readonly reason: string;
}

export interface ExternalActivationFailure extends ExternalActivationIdentity {
  readonly schemaVersion: 1; readonly failureId: string; readonly sequence: number;
  readonly phase: 'import' | 'factory' | 'activation' | 'catalog'; readonly code: 'EXTERNAL_ACTIVATION_FAILED' | 'EXTERNAL_ACTIVATION_PASSED';
  readonly message: string; readonly recordedAt: string;
}

export interface ExternalActivationPlan {
  readonly schemaVersion: 1;
  readonly kind: 'external-activation';
  readonly record: ExternalActivationRecord;
  readonly planHash: `sha256:${string}`;
}

export type ExternalActivationFaultPoint = 'after-preparing-journal' | 'after-record-write';

export interface ExternalActivationStoreOptions {
  readonly faultAt?: ExternalActivationFaultPoint;
}

interface ActivationJournal {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly state: 'preparing' | 'committed' | 'rolled-back';
  readonly planHash: `sha256:${string}`;
  readonly recordId: string;
  readonly recordHash: `sha256:${string}`;
}

function parseRecord(value: unknown): ExternalActivationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('activation record must be a plain object');
  const input = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'recordId', 'sequence', 'modId', 'version', 'source', 'sourceLocator', 'contentHash', 'manifestHash', 'publisherHash', 'enabled', 'decidedAt', 'decidedBy', 'reason'];
  if (Object.keys(input).length !== fields.length || fields.some((field) => !(field in input))) throw new TypeError('activation record has unknown or missing fields');
  if (input.schemaVersion !== 1 || !UUID.test(String(input.recordId)) || input.decidedBy !== 'local-user') throw new TypeError('activation record metadata is invalid');
  if (typeof input.modId !== 'string' || input.modId.length > 256 || !MOD_ID_PATTERN.test(input.modId)
    || typeof input.version !== 'string' || validVersion(input.version) === null
    || typeof input.sourceLocator !== 'string' || input.sourceLocator.length < 1 || input.sourceLocator.length > 4096 || /[\0\r\n]/.test(input.sourceLocator)
    || typeof input.reason !== 'string' || input.reason.length < 1 || input.reason.length > 4096
    || typeof input.decidedAt !== 'string' || !ISO_UTC.test(input.decidedAt) || Number.isNaN(Date.parse(input.decidedAt))) throw new TypeError('activation record text is invalid');
  if (input.source !== 'user-folder' && input.source !== 'explicit-dev') throw new TypeError('activation source is invalid');
  if (!Number.isSafeInteger(input.sequence) || Number(input.sequence) < 0) throw new TypeError('activation sequence is invalid');
  if (typeof input.enabled !== 'boolean' || !HASH.test(String(input.contentHash)) || !HASH.test(String(input.manifestHash)) || !HASH.test(String(input.publisherHash))) throw new TypeError('activation record identity is invalid');
  return Object.freeze(input) as unknown as ExternalActivationRecord;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function matches(record: ExternalActivationIdentity, identity: ExternalActivationIdentity): boolean {
  return record.modId === identity.modId && record.version === identity.version && record.source === identity.source
    && record.sourceLocator === identity.sourceLocator && record.contentHash === identity.contentHash
    && record.manifestHash === identity.manifestHash && record.publisherHash === identity.publisherHash;
}

function parseJournal(value: unknown): ActivationJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('activation journal is invalid');
  const input = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'transactionId', 'state', 'planHash', 'recordId', 'recordHash'];
  if (Object.keys(input).length !== fields.length || fields.some((field) => !(field in input))
    || input.schemaVersion !== 1 || !UUID.test(String(input.transactionId)) || !['preparing', 'committed', 'rolled-back'].includes(String(input.state))
    || !HASH.test(String(input.planHash)) || !UUID.test(String(input.recordId)) || !HASH.test(String(input.recordHash))) throw new TypeError('activation journal is invalid');
  return Object.freeze(input) as unknown as ActivationJournal;
}

export class ExternalActivationStore {
  readonly directory: string;
  readonly transactions: string;
  readonly marker: string;
  readonly writerLock: string;
  readonly failures: string;
  constructor(readonly root: string, readonly io: HostIo = nodeHostIo, readonly options: ExternalActivationStoreOptions = {}) {
    this.directory = join(root, 'external-activation');
    this.transactions = join(root, 'external-activation-transactions');
    this.marker = join(root, 'external-activation-owned-by-local-user');
    this.writerLock = join(root, 'locks', 'writer.json');
    this.failures = join(root, 'external-activation-failures');
  }

  preview(identity: ExternalActivationIdentity, enabled: boolean, reason: string, decidedAt = new Date().toISOString()): ExternalActivationPlan {
    const record = parseRecord({ schemaVersion: 1, recordId: randomUUID(), sequence: 0, ...identity, enabled, decidedAt, decidedBy: 'local-user', reason });
    const unsigned = { schemaVersion: 1 as const, kind: 'external-activation' as const, record };
    return Object.freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
  }

  async apply(plan: ExternalActivationPlan, approvedPlanHash: string): Promise<ExternalActivationRecord> {
    const { planHash, ...unsigned } = plan;
    if (planHash !== sha256Canonical(unsigned) || approvedPlanHash !== planHash) throw new TypeError('external activation approval does not match the exact plan');
    const fence = await WriterFence.acquire(this.writerLock, 'agon.kernel.external-activation', { io: this.io });
    try {
      await this.io.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.io.mkdir(this.transactions, { recursive: true, mode: 0o700 });
      if (!await pathExists(this.io, this.marker)) await atomicWrite(this.io, this.marker, 'local-user\n');
      const sequence = Math.max(0, ...(await this.read()).map((entry) => entry.sequence)) + 1;
      const record = parseRecord({ ...plan.record, sequence });
      const transactionId = randomUUID();
      const journalPath = join(this.transactions, `${transactionId}.json`);
      const journal: ActivationJournal = Object.freeze({ schemaVersion: 1, transactionId, state: 'preparing', planHash, recordId: record.recordId, recordHash: sha256Canonical(record) });
      await atomicWrite(this.io, journalPath, `${JSON.stringify(journal)}\n`);
      if (this.options.faultAt === 'after-preparing-journal') throw new Error('injected external activation fault after preparing journal');
      await writeNewImmutableFile(this.io, join(this.directory, `${record.recordId}.json`), `${JSON.stringify(record)}\n`);
      if (this.options.faultAt === 'after-record-write') throw new Error('injected external activation fault after record write');
      await fence.assertOwned();
      await atomicWrite(this.io, journalPath, `${JSON.stringify({ ...journal, state: 'committed' })}\n`);
      return record;
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async recover(): Promise<void> {
    if (!await pathExists(this.io, this.transactions)) return;
    const fence = await WriterFence.acquire(this.writerLock, 'agon.kernel.external-activation-recovery', { io: this.io });
    try {
      for (const name of (await this.io.readdir(this.transactions)).map(String).filter((entry) => entry.endsWith('.json')).sort()) {
        const path = join(this.transactions, name);
        const journal = parseJournal(await readJson(this.io, path));
        if (journal.state !== 'preparing') continue;
        const recordPath = join(this.directory, `${journal.recordId}.json`);
        const exists = await pathExists(this.io, recordPath);
        if (exists && sha256Canonical(await readJson(this.io, recordPath)) !== journal.recordHash) throw new TypeError('activation recovery found a mismatched record');
        await atomicWrite(this.io, path, `${JSON.stringify({ ...journal, state: exists ? 'committed' : 'rolled-back' })}\n`);
      }
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async read(): Promise<readonly ExternalActivationRecord[]> {
    if (!await pathExists(this.io, this.directory)) return Object.freeze([]);
    const names = (await this.io.readdir(this.directory)).map(String).filter((name) => name.endsWith('.json')).sort();
    return Object.freeze(await Promise.all(names.map(async (name) => parseRecord(await readJson(this.io, join(this.directory, name))))));
  }

  async recordFailure(identity: ExternalActivationIdentity, phase: ExternalActivationFailure['phase'], cause: unknown): Promise<ExternalActivationFailure> {
    return this.#recordOutcome(identity, phase, 'EXTERNAL_ACTIVATION_FAILED', errorMessage(cause));
  }

  async recordSuccess(identity: ExternalActivationIdentity): Promise<ExternalActivationFailure> {
    return this.#recordOutcome(identity, 'activation', 'EXTERNAL_ACTIVATION_PASSED', 'activation completed');
  }

  async #recordOutcome(identity: ExternalActivationIdentity, phase: ExternalActivationFailure['phase'], code: ExternalActivationFailure['code'], message: string): Promise<ExternalActivationFailure> {
    const fence = await WriterFence.acquire(this.writerLock, 'agon.kernel.external-activation-failure', { io: this.io });
    try {
      await this.io.mkdir(this.failures, { recursive: true, mode: 0o700 });
      const outcomes = await this.readOutcomes();
      const latest = outcomes.filter((entry) => matches(entry, identity)).sort((left, right) => right.sequence - left.sequence)[0];
      if (latest?.code === code && code === 'EXTERNAL_ACTIVATION_PASSED') return latest;
      const sequence = Math.max(0, ...outcomes.map((entry) => entry.sequence)) + 1;
      const failure = Object.freeze({ schemaVersion: 1 as const, failureId: randomUUID(), sequence, ...identity, phase,
        code, message: redactExternalDiagnostic(message), recordedAt: new Date().toISOString() });
      await writeNewImmutableFile(this.io, join(this.failures, `${failure.failureId}.json`), `${JSON.stringify(failure)}\n`);
      return failure;
    } finally { await fence.release().catch(() => undefined); }
  }

  async readFailures(): Promise<readonly ExternalActivationFailure[]> {
    const outcomes = await this.readOutcomes();
    const latest = new Map<string, ExternalActivationFailure>();
    for (const outcome of outcomes) {
      const key = sha256Canonical({ modId: outcome.modId, version: outcome.version, source: outcome.source, sourceLocator: outcome.sourceLocator, contentHash: outcome.contentHash, manifestHash: outcome.manifestHash, publisherHash: outcome.publisherHash });
      if ((latest.get(key)?.sequence ?? 0) < outcome.sequence) latest.set(key, outcome);
    }
    return Object.freeze([...latest.values()].filter(({ code }) => code === 'EXTERNAL_ACTIVATION_FAILED'));
  }

  async readOutcomes(): Promise<readonly ExternalActivationFailure[]> {
    if (!await pathExists(this.io, this.failures)) return Object.freeze([]);
    const names = (await this.io.readdir(this.failures)).map(String).filter((name) => name.endsWith('.json')).sort();
    if (names.length > 4_096) throw new RangeError('external activation failure count exceeds the configured limit');
    const records: ExternalActivationFailure[] = [];
    for (const name of names) {
      const input = await readJson<Record<string, unknown>>(this.io, join(this.failures, name));
      if (input.schemaVersion !== 1 || !UUID.test(String(input.failureId)) || !Number.isSafeInteger(input.sequence) || Number(input.sequence) < 1
        || !['EXTERNAL_ACTIVATION_FAILED', 'EXTERNAL_ACTIVATION_PASSED'].includes(String(input.code)) || !['import', 'factory', 'activation', 'catalog'].includes(String(input.phase))
        || typeof input.message !== 'string' || input.message.length < 1 || input.message.length > 4096 || typeof input.recordedAt !== 'string' || !ISO_UTC.test(input.recordedAt)) {
        throw new TypeError('external activation failure record is invalid');
      }
      if (name !== `${input.failureId}.json`) throw new TypeError('external activation failure filename does not match its identity');
      parseRecord({ schemaVersion: 1, recordId: input.failureId, sequence: input.sequence, modId: input.modId, version: input.version,
        source: input.source, sourceLocator: input.sourceLocator, contentHash: input.contentHash, manifestHash: input.manifestHash,
        publisherHash: input.publisherHash, enabled: false, decidedAt: input.recordedAt, decidedBy: 'local-user', reason: input.message });
      records.push(Object.freeze(input) as unknown as ExternalActivationFailure);
    }
    return Object.freeze(records);
  }

  async enabled(identity: ExternalActivationIdentity): Promise<boolean> {
    const record = (await this.read()).filter((entry) => matches(entry, identity))
      .sort((left, right) => right.sequence - left.sequence)[0];
    return record?.enabled === true;
  }
}
