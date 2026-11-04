import { createHash } from 'node:crypto';
import { validatePersistedEnvelope, type Json, type PersistedEnvelope } from '@kernlang/agon-kernel';

export interface PersistenceEnvelopeOwner {
  readonly ownerModId: string;
  readonly ownerModVersion?: string;
  readonly ownerContentHash?: string;
  readonly contributionId: string;
  readonly payloadVersion?: string;
}
export interface PersistenceEnvelopeRuntime {
  readonly kernelVersion: string;
  readonly graphHash: string;
  readonly sessionId: string;
  readonly traceId: string;
}

const sha256 = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
function uuid(seed: string): string {
  const value = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  value[12] = '4'; value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16]!, 16) % 4]!;
  const hex = value.join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const defaultRuntime: PersistenceEnvelopeRuntime = Object.freeze({
  kernelVersion: '1.0.0',
  graphHash: sha256('agon:legacy-compatible-runtime-graph:v1'),
  sessionId: uuid(`session:${process.pid}:${process.cwd()}`),
  traceId: uuid(`trace:${process.pid}:${process.cwd()}`),
});

export function createPersistenceEnvelope(input: PersistenceEnvelopeOwner & {
  readonly kind: 'plan'|'result'|'session'|'job'; readonly status: string; readonly payload: unknown;
  readonly idSeed: string; readonly createdAt?: string; readonly updatedAt?: string; readonly childEnvelopeIds?: readonly string[]; readonly leaseId?: string;
  readonly runtime?: PersistenceEnvelopeRuntime;
}): PersistedEnvelope {
  const now = new Date().toISOString(), version = input.ownerModVersion ?? '1.0.0', runtime = input.runtime ?? defaultRuntime;
  const common = {
    schemaVersion: 1 as const, id: uuid(`${input.kind}:${input.idSeed}`), createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now,
    ownerModId: input.ownerModId, ownerModVersion: version, ownerContentHash: input.ownerContentHash ?? sha256(`${input.ownerModId}@${version}`),
    kernelVersion: runtime.kernelVersion, graphHash: runtime.graphHash, contributionId: input.contributionId,
    sessionId: runtime.sessionId, traceId: runtime.traceId, payloadVersion: input.payloadVersion ?? version,
    payloadEncoding: 'application/json' as const, receiptIds: [], payload: input.payload as Json,
  };
  if (input.kind === 'plan') return validatePersistedEnvelope({ ...common, kind: 'plan', status: input.status });
  if (input.kind === 'result') return validatePersistedEnvelope({ ...common, kind: 'result', status: input.status });
  if (input.kind === 'job') return validatePersistedEnvelope({ ...common, kind: 'job', status: input.status, ...(input.leaseId ? { leaseId: input.leaseId } : {}) });
  return validatePersistedEnvelope({ ...common, kind: 'session', status: input.status, childEnvelopeIds: [...(input.childEnvelopeIds ?? [])] });
}

export function unwrapPersistenceEnvelope<T>(input: unknown, kind: PersistedEnvelope['kind']): T {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('schemaVersion' in input) || !('kind' in input) || !('payload' in input)) return input as T;
  const envelope = validatePersistedEnvelope(input);
  if (envelope.kind !== kind) throw new TypeError(`expected ${kind} envelope, received ${envelope.kind}`);
  return envelope.payload as T;
}
