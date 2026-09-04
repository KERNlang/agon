import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { TrustGrantStore } from '../../packages/mod-kernel/src/trust-authority.js';
import { manifest } from '../helpers/modular-agon.js';
import { artifact, lifecycleLock, request } from '../helpers/modular-lifecycle.js';

const PUBLISHER = Object.freeze({ registryOrigin: 'local-user-folder', packageName: '',
  provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' as const });
const publisher = (packageName: string) => Object.freeze({ ...PUBLISHER, packageName });

describe('S8 third-party managed lifecycle admission', () => {
  it('admits only an exact authority proof bound to the canonical lock and requires full-code approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-third-party-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const packageManifest = manifest('evil.plausible', '1.0.0');
    const entry = artifact('evil.plausible', [], { trustTier: 'third-party', authoritySource: 'user-folder', publisher: publisher(packageManifest.id), manifest: packageManifest,
      manifestHash: sha256Canonical(packageManifest) });
    const store = new TrustGrantStore(root);
    const trustPlan = store.previewTrust({
      modId: entry.id,
      version: entry.version,
      source: 'user-folder',
      sourceLocator: entry.sourceLocator,
      contentHash: entry.contentHash,
      manifestHash: entry.manifestHash,
      decision: 'trusted',
      decidedAt: '2026-09-03T00:00:00.000Z',
      scope: 'exact-artifact',
      publisher: publisher(entry.id),
      reason: 'test approval',
    });
    const trust = await store.apply(trustPlan, { approvedPlanHash: trustPlan.planHash });
    const lock = lifecycleLock([entry]);
    const thirdPartyLock = { ...lock, packages: [{ ...lock.packages[0]!, source: 'user-folder' as const, trustRecordId: trust.recordId }] };
    const lifecycleRequest = request([entry], {
      lock: thirdPartyLock,
      thirdPartyAuthority: {
        [entry.id]: { trustRecordId: trust.recordId, grantRecordIds: [], contentHash: entry.contentHash, manifestHash: entry.manifestHash, trustModel: 'full-code' },
      },
    });
    const plan = await createManagedLifecyclePlan(host, lifecycleRequest);
    expect(plan.approvalReasons).toContain(`full-code-trust:${entry.id}`);
    expect(plan.packages.map(({ id }) => id)).toEqual([entry.id]);
    expect(await host.readCurrentPointer()).toBeNull();
    const revoke = store.previewTrust({ ...trust, recordId: undefined, decision: 'revoked', decidedAt: '2026-09-03T00:00:01.000Z', reason: 'revoked after preview' });
    await store.apply(revoke, { approvedPlanHash: revoke.planHash });
    await expect(createManagedLifecyclePlan(host, lifecycleRequest)).rejects.toThrow(/stale, revoked, denied/);
  });

  it('rejects proof drift against either artifact bytes or canonical lock authority IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-third-party-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const entry = artifact('evil.plausible', [], { trustTier: 'third-party', authoritySource: 'user-folder', publisher: publisher('evil.plausible') });
    await expect(createManagedLifecyclePlan(host, request([entry], {
      thirdPartyAuthority: { [entry.id]: { trustRecordId: 'wrong', grantRecordIds: [], contentHash: entry.contentHash, manifestHash: entry.manifestHash, trustModel: 'full-code' } },
    }))).rejects.toThrow(/canonical lock/);
  });

  it('rejects a structurally plausible caller proof when no immutable authority record exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-third-party-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const entry = artifact('evil.plausible', [], { trustTier: 'third-party', authoritySource: 'user-folder', publisher: publisher('evil.plausible') });
    const lock = lifecycleLock([entry]);
    const recordId = '00000000-0000-4000-8000-000000000001';
    const thirdPartyLock = { ...lock, packages: [{ ...lock.packages[0]!, source: 'user-folder' as const, trustRecordId: recordId }] };
    await expect(createManagedLifecyclePlan(host, request([entry], {
      lock: thirdPartyLock,
      thirdPartyAuthority: { [entry.id]: { trustRecordId: recordId, grantRecordIds: [], contentHash: entry.contentHash, manifestHash: entry.manifestHash, trustModel: 'full-code' } },
    }))).rejects.toThrow(/immutable record/);
  });

  it('rejects empty caller grant IDs when the hash-bound manifest requires a permission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-third-party-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const packageManifest = manifest('evil.required', '1.0.0', {
      permissions: [{ capability: 'network.fetch', resources: ['https://example.test'], required: true }],
    });
    const entry = artifact('evil.required', [], { trustTier: 'third-party', authoritySource: 'user-folder', publisher: publisher(packageManifest.id), manifest: packageManifest,
      manifestHash: sha256Canonical(packageManifest) });
    const store = new TrustGrantStore(root);
    const trustPlan = store.previewTrust({
      modId: entry.id, version: entry.version, source: 'user-folder', sourceLocator: entry.sourceLocator,
      contentHash: entry.contentHash, manifestHash: entry.manifestHash, decision: 'trusted',
      decidedAt: '2026-09-03T00:00:00.000Z', scope: 'exact-artifact',
      publisher: publisher(entry.id), reason: 'test approval',
    });
    const trust = await store.apply(trustPlan, { approvedPlanHash: trustPlan.planHash });
    const lock = lifecycleLock([entry]);
    const thirdPartyLock = { ...lock, packages: [{ ...lock.packages[0]!, source: 'user-folder' as const,
      trustRecordId: trust.recordId, grantRecordIds: [] }] };
    await expect(createManagedLifecyclePlan(host, request([entry], {
      lock: thirdPartyLock,
      thirdPartyAuthority: { [entry.id]: { trustRecordId: trust.recordId, grantRecordIds: [],
        contentHash: entry.contentHash, manifestHash: entry.manifestHash, trustModel: 'full-code' } },
    }))).rejects.toThrow(/required permission lacks one exact active grant/);
  });


  it('rejects a previously selected allow record after a newer exact deny', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-third-party-deny-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const packageManifest = manifest('evil.denied', '1.0.0', { permissions: [{ capability: 'network.fetch', resources: ['https://example.test'], required: true }] });
    const entry = artifact(packageManifest.id, [], { trustTier: 'third-party', authoritySource: 'user-folder', publisher: publisher(packageManifest.id),
      manifest: packageManifest, manifestHash: sha256Canonical(packageManifest) });
    const store = new TrustGrantStore(root);
    const trustPlan = store.previewTrust({ modId: entry.id, version: entry.version, source: 'user-folder', sourceLocator: entry.sourceLocator,
      contentHash: entry.contentHash, manifestHash: entry.manifestHash, decision: 'trusted', decidedAt: '2026-09-03T00:00:00.000Z',
      scope: 'exact-artifact', publisher: publisher(entry.id), reason: 'test' });
    const trust = await store.apply(trustPlan, { approvedPlanHash: trustPlan.planHash });
    const allowPlan = store.previewGrant({ modId: entry.id, contentHash: entry.contentHash, capability: 'network.fetch', resources: ['https://example.test'],
      decision: 'allow', grantedAt: '2026-09-03T00:00:00.000Z', grantedBy: 'local-user', reason: 'test' });
    const allow = await store.apply(allowPlan, { approvedPlanHash: allowPlan.planHash });
    const lock = lifecycleLock([entry]);
    const exactLock = { ...lock, packages: [{ ...lock.packages[0]!, source: 'user-folder' as const, trustRecordId: trust.recordId, grantRecordIds: [allow.recordId] }] };
    const lifecycleRequest = request([entry], { lock: exactLock, thirdPartyAuthority: { [entry.id]: { trustRecordId: trust.recordId,
      grantRecordIds: [allow.recordId], contentHash: entry.contentHash, manifestHash: entry.manifestHash, trustModel: 'full-code' } } });
    await expect(createManagedLifecyclePlan(host, lifecycleRequest)).resolves.toBeDefined();
    const denyPlan = store.previewGrant({ ...allow, recordId: undefined, decision: 'deny', grantedAt: '2026-09-03T00:00:01.000Z', reason: 'revoked after preview', revokedAt: '2026-09-03T00:00:01.000Z' });
    await store.apply(denyPlan, { approvedPlanHash: denyPlan.planHash });
    await expect(createManagedLifecyclePlan(host, lifecycleRequest)).rejects.toThrow(/stale, revoked, denied/);
  });
  it('admits a real pretty-printed discovered manifest using its canonical manifest hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-real-lifecycle-'));
    const packageRoot = join(root, 'mods', 'real');
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    const packageManifest = manifest('example.real-lifecycle');
    await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(packageManifest, null, 2) + '\n');
    await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(packageRoot, 'dist/index.js'), 'export default async()=>({apiVersion:"1",activate(){}});\n');
    await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
    const candidate = await inspectFolderMod(packageRoot);
    expect(candidate.manifestHash).toBe(sha256Canonical(candidate.manifest));
    const hostRoot = join(root, 'host');
    const host = new DurableModHost(hostRoot, { kernelVersion: '1.0.0' });
    const entry = artifact(candidate.manifest.id, [], { trustTier: 'third-party', authoritySource: 'user-folder',
      publisher: publisher(candidate.manifest.id), manifest: candidate.manifest, sourceLocator: candidate.sourceLocator,
      contentHash: candidate.contentHash, manifestHash: candidate.manifestHash });
    const store = new TrustGrantStore(hostRoot);
    const trustPlan = store.previewTrust({ modId: entry.id, version: entry.version, source: 'user-folder', sourceLocator: entry.sourceLocator,
      contentHash: entry.contentHash, manifestHash: entry.manifestHash, decision: 'trusted', decidedAt: '2026-09-04T00:00:00.000Z',
      scope: 'exact-artifact', publisher: publisher(entry.id), reason: 'real discovered fixture' });
    const accepted = await store.apply(trustPlan, { approvedPlanHash: trustPlan.planHash });
    const lock = lifecycleLock([entry]);
    const exactLock = { ...lock, packages: [{ ...lock.packages[0]!, source: 'user-folder' as const, trustRecordId: accepted.recordId }] };
    await expect(createManagedLifecyclePlan(host, request([entry], { lock: exactLock, thirdPartyAuthority: {
      [entry.id]: { trustRecordId: accepted.recordId, grantRecordIds: [], contentHash: entry.contentHash,
        manifestHash: entry.manifestHash, trustModel: 'full-code' } } }))).resolves.toBeDefined();
  });

});
