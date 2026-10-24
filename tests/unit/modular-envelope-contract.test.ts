import { describe, expect, it } from 'vitest';
import { validatePersistedEnvelope } from '../../packages/mod-api/src/envelopes.js';

const hash = `sha256:${'a'.repeat(64)}`;
const base = {
  schemaVersion: 1 as const, id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
  ownerModId: 'agon.persistence', ownerModVersion: '1.0.0', ownerContentHash: hash,
  kernelVersion: '1.0.0', graphHash: hash, contributionId: 'agon.legacy-record',
  sessionId: '22222222-2222-4222-8222-222222222222', traceId: '33333333-3333-4333-8333-333333333333',
  payloadVersion: '0.2.5', payloadEncoding: 'application/json' as const, receiptIds: [],
  payload: { unknownLegacyField: { preserved: true } },
};

describe('public persisted envelope contract', () => {
  it('validates every frozen envelope kind without discarding opaque payload fields', () => {
    expect(validatePersistedEnvelope({ ...base, kind: 'plan', status: 'paused' }).payload).toEqual(base.payload);
    expect(validatePersistedEnvelope({ ...base, kind: 'result', status: 'succeeded' }).payload).toEqual(base.payload);
    expect(validatePersistedEnvelope({ ...base, kind: 'session', status: 'closed', childEnvelopeIds: [] }).payload).toEqual(base.payload);
    expect(validatePersistedEnvelope({ ...base, kind: 'job', status: 'interrupted' }).payload).toEqual(base.payload);
  });
  it('rejects unversioned and structurally plausible legacy wrappers', () => {
    expect(() => validatePersistedEnvelope({ kind: 'legacy-record', payload: {} })).toThrow();
    expect(() => validatePersistedEnvelope({ ...base, kind: 'result', status: 'succeeded', extra: true })).toThrow();
  });
});
