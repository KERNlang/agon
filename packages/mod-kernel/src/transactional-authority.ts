import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';
import { sha256Canonical } from './lock.js';
import { TrustGrantStore, type AuthorityMutationPlan, type GrantRecord, type TrustRecord } from './trust-authority.js';
import { WriterFence, type WriterLockOptions } from './writer-lock.js';

export type AuthorityOperation = 'trust' | 'untrust' | 'grant' | 'revoke';
export type AuthorityFaultPoint = 'after-authority-journal' | 'after-authority-record' | 'after-authority-commit';

export interface AuthorityTransactionJournal {
  readonly schemaVersion: 1;
  readonly kind: 'authority';
  readonly transactionId: string;
  readonly operation: AuthorityOperation;
  readonly state: 'preparing' | 'committed' | 'rolled-back';
  readonly planHash: `sha256:${string}`;
  readonly recordId: string;
  readonly recordHash: `sha256:${string}`;
  readonly recordPath: string;
  readonly fenceToken: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface AuthorityTransactionReceipt {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly operation: AuthorityOperation;
  readonly outcome: 'committed' | 'recovered-committed' | 'recovered-rolled-back';
  readonly planHash: `sha256:${string}`;
  readonly recordId: string;
  readonly recordHash: `sha256:${string}`;
  readonly finishedAt: string;
}


const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function parseJournal(value: unknown, store: TrustGrantStore): AuthorityTransactionJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('authority journal must be a plain object');
  const input = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'kind', 'transactionId', 'operation', 'state', 'planHash', 'recordId', 'recordHash', 'recordPath', 'fenceToken', 'startedAt', 'updatedAt'];
  if (Object.keys(input).length !== fields.length || fields.some((field) => !(field in input))) throw new TypeError('authority journal has unknown or missing fields');
  if (input.schemaVersion !== 1 || input.kind !== 'authority' || !UUID.test(String(input.transactionId)) || !UUID.test(String(input.recordId))
    || !['trust', 'untrust', 'grant', 'revoke'].includes(String(input.operation)) || !['preparing', 'committed', 'rolled-back'].includes(String(input.state))
    || !HASH.test(String(input.planHash)) || !HASH.test(String(input.recordHash)) || typeof input.fenceToken !== 'string' || !input.fenceToken
    || !ISO_UTC.test(String(input.startedAt)) || !ISO_UTC.test(String(input.updatedAt))) throw new TypeError('authority journal metadata is invalid');
  const authorityOperation = input.operation as AuthorityOperation;
  const expectedRoot = authorityOperation === 'trust' || authorityOperation === 'untrust' ? store.paths.trust : store.paths.grants;
  const expectedPath = join(expectedRoot, String(input.recordId) + '.json');
  if (input.recordPath !== expectedPath) throw new TypeError('authority journal record path escaped its owned authority directory');
  return Object.freeze(input) as unknown as AuthorityTransactionJournal;
}

export interface TransactionalAuthorityOptions {
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly processIdentity?: string;
  readonly writerLock?: Omit<WriterLockOptions, 'io' | 'now' | 'processIdentity'>;
  readonly fault?: (point: AuthorityFaultPoint) => void | Promise<void>;
}

function operation(plan: AuthorityMutationPlan): AuthorityOperation {
  if (plan.kind === 'trust') return (plan.record as TrustRecord).decision === 'trusted' ? 'trust' : 'untrust';
  const grant = plan.record as GrantRecord;
  return grant.decision === 'allow' && !grant.revokedAt ? 'grant' : 'revoke';
}

export class TransactionalTrustGrantService {
  readonly store: TrustGrantStore;
  readonly paths: Readonly<{ writerLock: string; transactions: string; receipts: string }>;
  readonly #io: HostIo;
  readonly #now: () => Date;
  readonly #options: TransactionalAuthorityOptions;

  constructor(readonly hostRoot: string, options: TransactionalAuthorityOptions = {}) {
    this.#io = options.io ?? nodeHostIo;
    this.#now = options.now ?? (() => new Date());
    this.#options = options;
    this.store = new TrustGrantStore(hostRoot, this.#io);
    this.paths = Object.freeze({ writerLock: join(hostRoot, 'locks', 'writer.json'), transactions: join(hostRoot, 'transactions'), receipts: join(hostRoot, 'receipts') });
  }

  async apply(plan: AuthorityMutationPlan, approval: { readonly approvedPlanHash: string }): Promise<AuthorityTransactionReceipt> {
    await this.#io.mkdir(this.paths.transactions, { recursive: true, mode: 0o700 });
    await this.#io.mkdir(this.paths.receipts, { recursive: true, mode: 0o700 });
    const fence = await WriterFence.acquire(this.paths.writerLock, 'agon.kernel.authority', { ...this.#options.writerLock, io: this.#io, now: this.#now, processIdentity: this.#options.processIdentity });
    const transactionId = randomUUID();
    const assignedSequence = await this.store.nextSequence();
    const appliedRecord = this.store.materialize(plan, approval, assignedSequence);
    const recordId = appliedRecord.recordId;
    const recordHash = sha256Canonical(appliedRecord);
    const recordPath = join(plan.kind === 'trust' ? this.store.paths.trust : this.store.paths.grants, `${recordId}.json`);
    const journalPath = join(this.paths.transactions, `${transactionId}.authority.json`);
    const startedAt = this.#now().toISOString();
    let journal: AuthorityTransactionJournal = Object.freeze({ schemaVersion: 1, kind: 'authority', transactionId, operation: operation(plan), state: 'preparing', planHash: plan.planHash, recordId, recordHash, recordPath, fenceToken: fence.record.fenceToken, startedAt, updatedAt: startedAt });
    try {
      await atomicWrite(this.#io, journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await this.#options.fault?.('after-authority-journal');
      await this.store.apply(plan, approval, assignedSequence);
      await fence.assertOwned();
      await this.#options.fault?.('after-authority-record');
      journal = Object.freeze({ ...journal, state: 'committed', updatedAt: this.#now().toISOString() });
      await atomicWrite(this.#io, journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      const receipt = this.#receipt(journal, 'committed');
      await writeNewImmutableFile(this.#io, join(this.paths.receipts, `${transactionId}.authority.committed.json`), `${JSON.stringify(receipt, null, 2)}\n`);
      await this.#options.fault?.('after-authority-commit');
      return receipt;
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async applyResumable(plan: AuthorityMutationPlan, approval: { readonly approvedPlanHash: string }): Promise<AuthorityTransactionReceipt> {
    const { planHash, ...unsigned } = plan;
    if (planHash !== sha256Canonical(unsigned) || approval.approvedPlanHash !== planHash) throw new TypeError('authority approval does not match exact plan');
    await this.recover();
    const recordPath = join(plan.kind === 'trust' ? this.store.paths.trust : this.store.paths.grants, `${plan.record.recordId}.json`);
    if (await pathExists(this.#io, recordPath)) {
      const record = await readJson<unknown>(this.#io, recordPath);
      const recordHash = sha256Canonical(record);
      const { sequence: _storedSequence, ...storedDecision } = record as Record<string, unknown>;
      const { sequence: _plannedSequence, ...plannedDecision } = plan.record as (TrustRecord | GrantRecord);
      if (sha256Canonical(storedDecision) !== sha256Canonical(plannedDecision)) throw new TypeError('resumed authority record does not match exact approved plan');
      return Object.freeze({
        schemaVersion: 1, transactionId: plan.record.recordId, operation: operation(plan), outcome: 'recovered-committed',
        planHash, recordId: plan.record.recordId, recordHash, finishedAt: this.#now().toISOString(),
      });
    }
    return this.apply(plan, approval);
  }

  async recover(): Promise<readonly AuthorityTransactionReceipt[]> {
    if (!await pathExists(this.#io, this.paths.transactions)) return Object.freeze([]);
    const fence = await WriterFence.acquire(this.paths.writerLock, 'agon.kernel.authority-recovery', { ...this.#options.writerLock, io: this.#io, now: this.#now, processIdentity: this.#options.processIdentity });
    const receipts: AuthorityTransactionReceipt[] = [];
    try {
      const names = (await this.#io.readdir(this.paths.transactions)).map(String).filter((name) => name.endsWith('.authority.json')).sort();
      for (const name of names) {
        const path = join(this.paths.transactions, name);
        const journal = parseJournal(await readJson<unknown>(this.#io, path), this.store);
        if (journal.state !== 'preparing') continue;
        const exists = await pathExists(this.#io, journal.recordPath);
        const state = exists ? 'committed' : 'rolled-back';
        if (exists) {
          const record = await readJson<unknown>(this.#io, journal.recordPath);
          if (sha256Canonical(record) !== journal.recordHash) throw new TypeError(`authority recovery found a mismatched record: ${journal.recordId}`);
        }
        const recovered = Object.freeze({ ...journal, state, updatedAt: this.#now().toISOString() }) as AuthorityTransactionJournal;
        await atomicWrite(this.#io, path, `${JSON.stringify(recovered, null, 2)}\n`);
        const receipt = this.#receipt(recovered, exists ? 'recovered-committed' : 'recovered-rolled-back');
        await writeNewImmutableFile(this.#io, join(this.paths.receipts, `${journal.transactionId}.authority.${receipt.outcome}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
        receipts.push(receipt);
      }
      return Object.freeze(receipts);
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  #receipt(journal: AuthorityTransactionJournal, outcome: AuthorityTransactionReceipt['outcome']): AuthorityTransactionReceipt {
    return Object.freeze({ schemaVersion: 1, transactionId: journal.transactionId, operation: journal.operation, outcome, planHash: journal.planHash, recordId: journal.recordId, recordHash: journal.recordHash, finishedAt: this.#now().toISOString() });
  }
}
