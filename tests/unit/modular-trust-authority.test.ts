import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TrustGrantStore, evaluateThirdPartyAuthority, parseGrantRecord } from '../../packages/mod-kernel/src/trust-authority.js';
import { manifest } from '../helpers/modular-agon.js';

const h = (value: string) => `sha256:${value.repeat(64)}` as const;
const publisher = { registryOrigin: 'file:', packageName: 'example.third', provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' as const };
const identity = { modId: 'example.third', version: '1.0.0', source: 'user-folder' as const, sourceLocator: '/tmp/mod', contentHash: h('a'), manifestHash: h('b'), publisher };

describe('S8 trust and grant authority', () => {
  it('requires exact artifact trust and exact grants for every required permission', () => {
    const mod = manifest('example.third', '1.0.0', { permissions: [{ capability: 'network.fetch', resources: ['https://example.test'], required: true }] });
    const trust = { schemaVersion: 1 as const, recordId: '11111111-1111-4111-8111-111111111111', modId: identity.modId, version: identity.version, source: identity.source, sourceLocator: identity.sourceLocator, contentHash: identity.contentHash, manifestHash: identity.manifestHash, decision: 'trusted' as const, decidedAt: '2026-09-03T00:00:00Z', scope: 'exact-artifact' as const, publisher, reason: 'approved locally' };
    const grant = parseGrantRecord({ schemaVersion: 1, recordId: '22222222-2222-4222-8222-222222222222', modId: identity.modId, contentHash: identity.contentHash, capability: 'network.fetch', resources: ['https://example.test'], decision: 'allow', grantedAt: '2026-09-03T00:00:00Z', grantedBy: 'local-user', reason: 'approved locally' });
    expect(evaluateThirdPartyAuthority(identity, mod, [trust], [])).toMatchObject({ allowed: false, reason: 'permission-not-granted' });
    expect(evaluateThirdPartyAuthority(identity, mod, [trust], [grant])).toMatchObject({ allowed: true, trustModel: 'full-code' });
    expect(evaluateThirdPartyAuthority({ ...identity, contentHash: h('c') }, mod, [trust], [grant])).toMatchObject({ allowed: false, reason: 'untrusted-source' });
  });

  it('allows optional denial but blocks an explicitly denied required capability', () => {
    const mod = manifest('example.third', '1.0.0', { permissions: [
      { capability: 'network.fetch', resources: ['required'], required: true },
      { capability: 'state.read', resources: ['optional'], required: false },
    ] });
    const trust = { schemaVersion: 1 as const, recordId: '11111111-1111-4111-8111-111111111111', modId: identity.modId, version: identity.version, source: identity.source, sourceLocator: identity.sourceLocator, contentHash: identity.contentHash, manifestHash: identity.manifestHash, decision: 'trusted' as const, decidedAt: '2026-09-03T00:00:00Z', scope: 'exact-artifact' as const, publisher, reason: 'approved locally' };
    const requiredAllow = parseGrantRecord({ schemaVersion: 1, recordId: '22222222-2222-4222-8222-222222222222', modId: identity.modId, contentHash: identity.contentHash, capability: 'network.fetch', resources: ['required'], decision: 'allow', grantedAt: '2026-09-03T00:00:00Z', grantedBy: 'local-user', reason: 'allowed' });
    const optionalDeny = parseGrantRecord({ schemaVersion: 1, recordId: '33333333-3333-4333-8333-333333333333', modId: identity.modId, contentHash: identity.contentHash, capability: 'state.read', resources: ['optional'], decision: 'deny', grantedAt: '2026-09-03T00:00:00Z', grantedBy: 'local-user', reason: 'denied' });
    expect(evaluateThirdPartyAuthority(identity, mod, [trust], [requiredAllow, optionalDeny])).toMatchObject({ allowed: true });
    const requiredDeny = parseGrantRecord({ ...requiredAllow, recordId: '44444444-4444-4444-8444-444444444444', decision: 'deny', grantedAt: '2026-09-03T00:00:01Z' });
    expect(evaluateThirdPartyAuthority(identity, mod, [trust], [requiredAllow, requiredDeny, optionalDeny])).toMatchObject({ allowed: false, reason: 'permission-not-granted' });
  });

  it('invalidates explicit development path trust when bytes change', () => {
    const mod = manifest('example.third', '1.0.0', { permissions: [{ capability: 'process.exec', resources: ['git'], required: true }] });
    const dev = { ...identity, source: 'explicit-dev' as const };
    const trust = { schemaVersion: 1 as const, recordId: '11111111-1111-4111-8111-111111111111', modId: dev.modId, version: dev.version, source: dev.source, sourceLocator: dev.sourceLocator, contentHash: h('0'), manifestHash: h('0'), decision: 'trusted' as const, decidedAt: '2026-09-03T00:00:00Z', scope: 'explicit-dev-path' as const, publisher, reason: 'development path selected' };
    expect(evaluateThirdPartyAuthority({ ...dev, contentHash: h('c') }, mod, [trust], [])).toMatchObject({ allowed: false, reason: 'untrusted-source' });
  });

  it('fails closed on invalid provenance and revoked/latest authority', () => {
    const mod = manifest('example.third');
    expect(evaluateThirdPartyAuthority({ ...identity, publisher: { ...publisher, provenanceStatus: 'invalid' } }, mod, [], [])).toMatchObject({ allowed: false, reason: 'invalid-provenance' });
  });

  it('persists immutable user-owned records outside repository state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-'));
    const store = new TrustGrantStore(root);
    await store.initialize();
    const plan = store.previewTrust({ modId: identity.modId, version: identity.version, source: identity.source, sourceLocator: identity.sourceLocator, contentHash: identity.contentHash, manifestHash: identity.manifestHash, decision: 'trusted', decidedAt: '2026-09-03T00:00:00Z', scope: 'exact-artifact', publisher, reason: 'approved locally' });
    await expect(store.apply(plan, { approvedPlanHash: h('0') })).rejects.toThrow(/approval/);
    await store.apply(plan, { approvedPlanHash: plan.planHash });
    expect(await store.readTrust()).toHaveLength(1);
    expect(await store.readGrants()).toEqual([]);
  });

  it('rejects ambiguous or forged record shapes', () => {
    expect(() => parseGrantRecord({ schemaVersion: 1, __proto__: {}, recordId: 'bad' })).toThrow();
    expect(() => parseGrantRecord({ schemaVersion: 1, recordId: '22222222-2222-4222-8222-222222222222', modId: identity.modId, contentHash: identity.contentHash, capability: 'x', resources: ['same', 'same'], decision: 'allow', grantedAt: '2026-09-03T00:00:00Z', grantedBy: 'local-user', reason: 'x' })).toThrow(/unique/);
  });
});
