import { writeFileSync, renameSync } from 'node:fs';
import { createPersistenceEnvelope } from '@kernlang/agon-support-persistence';

interface ResultEnvelopeInput {
  readonly resultPath: string;
  readonly payload: unknown;
  readonly status: 'succeeded' | 'failed' | 'cancelled' | 'partial';
  readonly idSeed: string;
  readonly ownerModId: string;
  readonly contributionId: string;
  readonly createdAt?: string;
}

/**
 * Persist the executable-free, versioned sibling of a run's generic result.json.
 * The generic snapshot remains stable for old readers; the envelope is the
 * authoritative ownership/version record used by modular readers and migrations.
 */
export function writeVersionedResultEnvelope(input: ResultEnvelopeInput): string {
  const path = input.resultPath.replace(/\.json$/u, '-envelope.json');
  const payload = JSON.parse(JSON.stringify(input.payload)) as unknown;
  const envelope = createPersistenceEnvelope({
    kind: 'result',
    status: input.status,
    payload,
    idSeed: input.idSeed,
    ownerModId: input.ownerModId,
    ownerModVersion: '1.0.0',
    contributionId: input.contributionId,
    createdAt: input.createdAt,
  });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}
