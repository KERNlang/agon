import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrateStagedCopy } from '../../packages/mod-kernel/src/migration-engine.js';
import { validatePersistedEnvelope } from '../../packages/mod-api/src/envelopes.js';

const corpusPath = join(process.cwd(), 'docs/specs/evidence/modular-agon-legacy-oracle/persisted-envelopes.raw.ndjson');

function migrateLegacyNdjson(bytes: Uint8Array): Uint8Array {
  const records = Buffer.from(bytes).toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  const uuid = (seed: string) => {
    const value = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
    value[12] = '4';
    value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16]!, 16) % 4]!;
    const hex = value.join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const sessionId = uuid('legacy-session');
  return Buffer.from(`${records.map((payload, index) => JSON.stringify({
    schemaVersion: 1,
    id: uuid(`legacy-${index}`),
    createdAt: typeof payload.startedAt === 'string' ? payload.startedAt : typeof payload.createdAt === 'string' ? payload.createdAt : '2026-08-23T00:00:00.000Z',
    updatedAt: typeof payload.startedAt === 'string' ? payload.startedAt : typeof payload.createdAt === 'string' ? payload.createdAt : '2026-08-23T00:00:00.000Z',
    ownerModId: 'agon.persistence', ownerModVersion: '1.0.0', ownerContentHash: hash,
    kernelVersion: '1.0.0', graphHash: hash, contributionId: 'agon.legacy-record',
    sessionId, traceId: uuid(`legacy-trace-${index}`), payloadVersion: '0.2.5',
    payloadEncoding: 'application/json', receiptIds: [], payload,
    kind: index === 0 ? 'session' : 'result',
    status: index === 0 ? 'closed' : payload.is_error === true ? 'failed' : 'succeeded',
    ...(index === 0 ? { childEnvelopeIds: records.slice(1).map((_, child) => uuid(`legacy-${child + 1}`)) } : {}),
  })).join('\n')}\n`);
}

describe('S9 historical persisted-state qualification', () => {
  it('migrates only a staged copy and preserves every legacy payload after decoding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s9-state-'));
    const source = join(root, 'legacy.ndjson');
    const staged = join(root, 'current.ndjson');
    const original = await readFile(corpusPath);
    await writeFile(source, original);
    const receipt = await migrateStagedCopy({ ownerId: 'agon.support.persistence', sourcePath: source, stagedPath: staged, fromVersion: 0, toVersion: 1,
      migrations: [{ id: 'legacy-0.2.x-to-envelope-v1', fromVersion: 0, toVersion: 1, migrate: migrateLegacyNdjson }] });
    expect(await readFile(source)).toEqual(original);
    const migrated = (await readFile(staged, 'utf8')).trimEnd().split('\n').map((line) => validatePersistedEnvelope(JSON.parse(line)));
    const decoded = migrated.map((envelope) => envelope.payload);
    const legacy = original.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(decoded).toEqual(legacy);
    expect(migrated[0]?.kind).toBe('session');
    expect(migrated.slice(1).every((envelope) => envelope.kind === 'result')).toBe(true);
    expect(receipt.sourcePreserved).toBe(true);
    expect(receipt.steps).toEqual(['legacy-0.2.x-to-envelope-v1']);
  });

  it('preserves unknown historical fields inside the versioned payload', () => {
    const input = Buffer.from(`${JSON.stringify({ id: 'old', futureAtTheTime: { nested: [1, true, 'x'] } })}\n`);
    const migrated = Buffer.from(migrateLegacyNdjson(input)).toString('utf8').trim();
    expect(JSON.parse(migrated).payload.futureAtTheTime).toEqual({ nested: [1, true, 'x'] });
  });

  it('has a discriminating oracle: dropping a legacy record is detected', async () => {
    const legacy = (await readFile(corpusPath, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    const migrated = Buffer.from(migrateLegacyNdjson(await readFile(corpusPath))).toString('utf8').trimEnd().split('\n');
    const mutated = migrated.slice(1).map((line) => JSON.parse(line).payload);
    expect(mutated).not.toEqual(legacy);
    expect(mutated).toHaveLength(legacy.length - 1);
  });
});
