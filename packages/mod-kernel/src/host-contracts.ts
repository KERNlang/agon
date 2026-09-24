import type {
  GenerationLease,
  GenerationManifest,
  GenerationPointer,
  HostJournalState,
  HostJournalStep,
  HostTransactionJournal,
  HostTransactionOperation,
} from './durable-host.js';

const OPERATIONS = new Set<HostTransactionOperation>([
  'install', 'update', 'enable', 'disable', 'remove', 'import', 'profile-update',
  'grant', 'revoke', 'trust', 'untrust', 'setup-action', 'rollback', 'purge',
  'garbage-collect', 'kernel-switch',
]);
const JOURNAL_STATES = new Set<HostJournalState>(['preparing', 'verified', 'committed', 'rolled-back', 'failed']);
const STEP_STATES = new Set<HostJournalStep['state']>(['pending', 'running', 'passed', 'failed', 'rolled-back']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${label} has unknown or missing fields`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function uuid(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!UUID.test(parsed)) throw new TypeError(`${label} must be a UUID`);
  return parsed;
}

function hash(value: unknown, label: string): `sha256:${string}` {
  const parsed = string(value, label);
  if (!HASH.test(parsed)) throw new TypeError(`${label} must be a SHA-256 hash`);
  return parsed as `sha256:${string}`;
}

function nullableHash(value: unknown, label: string): `sha256:${string}` | null {
  return value === null ? null : hash(value, label);
}

function timestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new TypeError(`${label} must be a UTC ISO timestamp`);
  }
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value as number;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

export function parseGenerationPointer(value: unknown): GenerationPointer {
  const input = record(value, 'generation pointer');
  exact(input, ['schemaVersion', 'generation', 'graphHash', 'lockHash', 'transactionId', 'selectedAt'], 'generation pointer');
  if (input.schemaVersion !== 1) throw new TypeError('generation pointer schema version must be 1');
  return Object.freeze({
    schemaVersion: 1,
    generation: nonnegativeInteger(input.generation, 'pointer generation'),
    graphHash: hash(input.graphHash, 'pointer graph hash'),
    lockHash: hash(input.lockHash, 'pointer lock hash'),
    transactionId: uuid(input.transactionId, 'pointer transaction ID'),
    selectedAt: timestamp(input.selectedAt, 'pointer selectedAt'),
  });
}

function parseStep(value: unknown, index: number): HostJournalStep {
  const input = record(value, `journal step ${index}`);
  const allowed = ['id', 'state', ...(input.receiptId === undefined ? [] : ['receiptId']), ...(input.error === undefined ? [] : ['error'])];
  exact(input, allowed, `journal step ${index}`);
  const state = string(input.state, `journal step ${index} state`) as HostJournalStep['state'];
  if (!STEP_STATES.has(state)) throw new TypeError(`journal step ${index} state is invalid`);
  return Object.freeze({
    id: string(input.id, `journal step ${index} ID`),
    state,
    ...(input.receiptId === undefined ? {} : { receiptId: optionalString(input.receiptId, `journal step ${index} receipt ID`) }),
    ...(input.error === undefined ? {} : { error: optionalString(input.error, `journal step ${index} error`) }),
  });
}

export function parseHostTransactionJournal(value: unknown): HostTransactionJournal {
  const input = record(value, 'transaction journal');
  exact(input, [
    'schemaVersion', 'transactionId', 'operation', 'state', 'startedAt', 'updatedAt',
    'baseGeneration', 'candidateGeneration', 'fenceToken', 'previousLockHash',
    'candidateLockHash', 'steps', 'rollback',
  ], 'transaction journal');
  if (input.schemaVersion !== 1) throw new TypeError('journal schema version must be 1');
  const operation = string(input.operation, 'journal operation') as HostTransactionOperation;
  const state = string(input.state, 'journal state') as HostJournalState;
  if (!OPERATIONS.has(operation)) throw new TypeError('journal operation is invalid');
  if (!JOURNAL_STATES.has(state)) throw new TypeError('journal state is invalid');
  if (!Array.isArray(input.steps)) throw new TypeError('journal steps must be an array');
  const rollback = record(input.rollback, 'journal rollback');
  const rollbackKeys = ['attempted', 'completed', ...(rollback.receiptId === undefined ? [] : ['receiptId'])];
  exact(rollback, rollbackKeys, 'journal rollback');
  if (typeof rollback.attempted !== 'boolean' || typeof rollback.completed !== 'boolean') throw new TypeError('journal rollback flags must be booleans');
  return Object.freeze({
    schemaVersion: 1,
    transactionId: uuid(input.transactionId, 'journal transaction ID'),
    operation,
    state,
    startedAt: timestamp(input.startedAt, 'journal startedAt'),
    updatedAt: timestamp(input.updatedAt, 'journal updatedAt'),
    baseGeneration: nonnegativeInteger(input.baseGeneration, 'journal base generation'),
    candidateGeneration: nonnegativeInteger(input.candidateGeneration, 'journal candidate generation'),
    fenceToken: uuid(input.fenceToken, 'journal fence token'),
    previousLockHash: nullableHash(input.previousLockHash, 'journal previous lock hash'),
    candidateLockHash: nullableHash(input.candidateLockHash, 'journal candidate lock hash'),
    steps: Object.freeze(input.steps.map(parseStep)),
    rollback: Object.freeze({
      attempted: rollback.attempted,
      completed: rollback.completed,
      ...(rollback.receiptId === undefined ? {} : { receiptId: optionalString(rollback.receiptId, 'journal rollback receipt ID') }),
    }),
  });
}

export function parseGenerationLease(value: unknown): GenerationLease {
  const input = record(value, 'generation lease');
  exact(input, ['schemaVersion', 'leaseId', 'generation', 'ownerId', 'pid', 'processIdentity', 'createdAt', 'heartbeatAt', 'releasedAt'], 'generation lease');
  if (input.schemaVersion !== 1) throw new TypeError('generation lease schema version must be 1');
  const pid = nonnegativeInteger(input.pid, 'lease PID');
  if (pid === 0) throw new TypeError('lease PID must be positive');
  return Object.freeze({
    schemaVersion: 1, leaseId: uuid(input.leaseId, 'lease ID'),
    generation: nonnegativeInteger(input.generation, 'lease generation'),
    ownerId: string(input.ownerId, 'lease owner ID'), pid,
    processIdentity: string(input.processIdentity, 'lease process identity'),
    createdAt: timestamp(input.createdAt, 'lease createdAt'),
    heartbeatAt: timestamp(input.heartbeatAt, 'lease heartbeatAt'),
    releasedAt: input.releasedAt === null ? null : timestamp(input.releasedAt, 'lease releasedAt'),
  });
}

export function parseGenerationManifest(value: unknown): GenerationManifest {
  const input = record(value, 'generation manifest');
  exact(input, [
    'schemaVersion', 'generation', 'graphHash', 'lockHash', 'kernelVersion',
    'transactionId', 'createdAt', 'files', 'contentHash',
  ], 'generation manifest');
  if (input.schemaVersion !== 1) throw new TypeError('generation manifest schema version must be 1');
  const files = record(input.files, 'generation manifest files');
  return Object.freeze({
    schemaVersion: 1,
    generation: nonnegativeInteger(input.generation, 'manifest generation'),
    graphHash: hash(input.graphHash, 'manifest graph hash'),
    lockHash: hash(input.lockHash, 'manifest lock hash'),
    kernelVersion: string(input.kernelVersion, 'manifest kernel version'),
    transactionId: uuid(input.transactionId, 'manifest transaction ID'),
    createdAt: timestamp(input.createdAt, 'manifest createdAt'),
    files: Object.freeze(Object.fromEntries(Object.entries(files).map(([path, digest]) => [path, hash(digest, `manifest file ${path}`)]))),
    contentHash: hash(input.contentHash, 'manifest content hash'),
  });
}
