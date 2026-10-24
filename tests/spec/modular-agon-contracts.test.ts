import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CoverageLedgerSchema, GrantRecordSchema, JobEnvelopeSchema, JournalSchema, LockSchema, ManifestSchema, PlanEnvelopeSchema,
  ResultEnvelopeSchema, SessionEnvelopeSchema, TrustRecordSchema, VerificationContractSchema, VerificationReceiptSchema,
  canonicalJson, resolveCandidates, validateLock, validateManifest,
} from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = process.cwd();
const fixtures = JSON.parse(readFileSync(join(root, 'docs/specs/fixtures/modular-agon-valid-artifacts.json'), 'utf8'));
const hash = (char: string) => `sha256:${char.repeat(64)}`;

describe('Modular Agon v1 executable contracts', () => {
  it('accepts every canonical fixture', () => {
    expect(ManifestSchema.parse(fixtures.manifest).id).toBe('agon.brainstorm');
    LockSchema.parse(fixtures.lock); JournalSchema.parse(fixtures.journal); TrustRecordSchema.parse(fixtures.trust); GrantRecordSchema.parse(fixtures.grant);
    VerificationContractSchema.parse(fixtures.verificationContract); VerificationReceiptSchema.parse(fixtures.verificationReceipt);
    PlanEnvelopeSchema.parse(fixtures.planEnvelope); ResultEnvelopeSchema.parse(fixtures.resultEnvelope); SessionEnvelopeSchema.parse(fixtures.sessionEnvelope); JobEnvelopeSchema.parse(fixtures.jobEnvelope);
  });

  it('rejects unknown fields and unsafe/unversioned shapes', () => {
    expect(() => ManifestSchema.parse({ ...fixtures.manifest, surprise: true })).toThrow();
    const traversal = JSON.parse(readFileSync(join(root, 'docs/specs/fixtures/modular-agon-invalid-manifest-traversal.json'), 'utf8'));
    expect(() => ManifestSchema.parse(traversal)).toThrow();
    expect(() => LockSchema.parse({ ...fixtures.lock, schemaVersion: 2 })).toThrow();
    expect(() => VerificationReceiptSchema.parse({ ...fixtures.verificationReceipt, subjectHash: 'mutable' })).toThrow();
  });

  it('bounds mod IDs across manifests, grants, and persisted envelopes', () => {
    const oversizedId = `a.${'b'.repeat(255)}`;
    expect(() => ManifestSchema.parse({ ...fixtures.manifest, id: oversizedId })).toThrow();
    expect(() => GrantRecordSchema.parse({ ...fixtures.grant, modId: oversizedId })).toThrow();
    expect(() => JobEnvelopeSchema.parse({ ...fixtures.jobEnvelope, ownerModId: oversizedId })).toThrow();
  });

  it('keeps executable manifest validation aligned with the runtime package', () => {
    expect(() => validateManifest({
      ...fixtures.manifest,
      contributes: { ...fixtures.manifest.contributes, cliCommands: [{ id: 'unsafe id', aliases: [] }] },
    })).toThrow();
    expect(() => validateManifest({
      ...fixtures.manifest,
      pack: { ...fixtures.manifest.pack, include: fixtures.manifest.pack.include.filter((path: string) => path !== 'agon.mod.json') },
    })).toThrow(/agon\.mod\.json/);
    expect(() => validateManifest({ ...fixtures.manifest, pack: { ...fixtures.manifest.pack, include: ['agon.mod.json'] } }))
      .toThrow(/entrypoint, asset, or executable path/);
  });

  it('canonicalizes and validates deterministic lock ordering', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(canonicalJson({ a: { b: 3, y: 2 }, z: 1 })).toBe(canonicalJson({ z: 1, a: { y: 2, b: 3 } }));
    expect(validateLock(fixtures.lock).graphHash).toBe(fixtures.lock.graphHash);
    expect(() => validateLock({ ...fixtures.lock, packages: [{ ...fixtures.lock.packages[0], resolutionOrder: 1 }] })).toThrow(/resolution order/);
  });

  it('enforces executable and declarative host profiles', () => {
    expect(() => validateManifest({ ...fixtures.manifest, execution: 'executable', entrypoints: undefined })).toThrow(/requires entrypoints/);
    const declarative = { ...fixtures.manifest, execution: 'declarative', entrypoints: undefined, permissions: [], assets: [], contributes: { cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: fixtures.manifest.contributes.generatedDocs }, pack: { ...fixtures.manifest.pack, executable: [] } };
    expect(validateManifest(declarative).execution).toBe('declarative');
    expect(() => validateManifest({ ...declarative, permissions: [{ capability: 'process.spawn', resources: [], required: true }] })).toThrow(/cannot request permissions/);
    expect(() => validateManifest({ ...declarative, contributes: { ...declarative.contributes, cliCommands: [{ id: 'hidden-handler', aliases: [] }] } })).toThrow(/executable contributions/);
  });

  it('keeps resolver output invariant across 200 deterministic permutations', () => {
    const make = (id: string, required: string[] = [], source = 'bundled') => ({
      source, sourceLocator: `${source}:${id}`, contentHash: hash(id.charCodeAt(id.length - 1).toString(16).slice(-1)),
      manifest: { ...fixtures.manifest, id, name: id, dependencies: { required: required.map((dep) => ({ id: dep, range: '^1.0.0' })), optional: [], conflicts: [] } },
    });
    const base = [make('agon.alpha'), make('agon.beta', ['agon.alpha']), make('agon.gamma', ['agon.alpha'])];
    const expected = ['agon.alpha', 'agon.beta', 'agon.gamma'];
    let seed = 0x5eed;
    for (let run = 0; run < 200; run += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const shuffled = [...base].sort((a, b) => ((a.manifest.id.charCodeAt(5) ^ seed) - (b.manifest.id.charCodeAt(5) ^ seed)));
      expect(resolveCandidates(shuffled, expected).order).toEqual(expected);
    }
  });

  it('uses explicit source precedence and rejects ambiguous equal-rank collisions', () => {
    const candidate = (source: string, locator: string) => ({ source, sourceLocator: locator, contentHash: hash('a'), manifest: { ...fixtures.manifest, id: 'example.brainstorm' } });
    expect(resolveCandidates([candidate('bundled', 'a'), candidate('user-folder', 'b')], ['example.brainstorm']).selected[0].source).toBe('user-folder');
    expect(() => resolveCandidates([candidate('registry', 'a'), candidate('registry', 'b')], ['example.brainstorm'])).toThrow(/collision/);
  });

  it('prevents untrusted sources from shadowing reserved first-party ids', () => {
    const bundled = { source: 'bundled', sourceLocator: 'bundled:brainstorm', contentHash: hash('a'), manifest: fixtures.manifest };
    const folder = { ...bundled, source: 'user-folder', sourceLocator: 'folder:brainstorm', manifest: { ...fixtures.manifest, version: '99.0.0' } };
    const resolved = resolveCandidates([bundled, folder], ['agon.brainstorm']);
    expect(resolved.selected[0].source).toBe('bundled');
    expect(resolved.rejected).toEqual([expect.objectContaining({ reason: 'reserved-first-party-id' })]);
  });

  it('chooses the highest stable version satisfying the complete graph', () => {
    const candidate = (id: string, version: string, required: Array<{ id: string; range: string }> = []) => ({ source: 'registry', sourceLocator: `registry:${id}@${version}`, contentHash: hash('a'), publisherIdentity: 'kernlang:first-party-release-set', provenanceVerified: true, manifest: { ...fixtures.manifest, id, name: id, version, dependencies: { required, optional: [], conflicts: [] } } });
    const resolved = resolveCandidates([
      candidate('agon.consumer', '1.0.0', [{ id: 'agon.dependency', range: '^1.0.0' }]),
      candidate('agon.dependency', '2.0.0'), candidate('agon.dependency', '1.5.0'), candidate('agon.dependency', '1.4.0-beta.1'),
    ], ['agon.consumer', 'agon.dependency']);
    expect(resolved.selected.find((entry) => entry.manifest.id === 'agon.dependency')?.manifest.version).toBe('1.5.0');
  });

  it('requires explicit opt-in for prerelease, yanked, and downgrade selection', () => {
    const candidate = (version: string, extra = {}) => ({ source: 'bundled', sourceLocator: `bundled:${version}`, contentHash: hash('a'), ...extra, manifest: { ...fixtures.manifest, version } });
    expect(() => resolveCandidates([candidate('2.0.0-beta.1')], ['agon.brainstorm'])).toThrow(/eligible/);
    expect(resolveCandidates([candidate('2.0.0-beta.1')], ['agon.brainstorm'], { allowPrerelease: true }).selected[0].manifest.version).toBe('2.0.0-beta.1');
    expect(() => resolveCandidates([candidate('1.0.0', { yanked: true })], ['agon.brainstorm'])).toThrow(/eligible/);
    expect(() => resolveCandidates([candidate('1.0.0')], ['agon.brainstorm'], { currentVersions: { 'agon.brainstorm': '2.0.0' } })).toThrow(/eligible/);
    expect(resolveCandidates([candidate('1.0.0')], ['agon.brainstorm'], { currentVersions: { 'agon.brainstorm': '2.0.0' }, allowDowngrade: true }).selected[0].manifest.version).toBe('1.0.0');
  });

  it('rejects missing dependency closure, conflicts, and cycles', () => {
    const candidate = (id: string, required: string[] = [], conflicts: string[] = []) => ({ source: 'bundled', sourceLocator: id, contentHash: hash('a'), manifest: { ...fixtures.manifest, id, dependencies: { required: required.map((dep) => ({ id: dep, range: '^1.0.0' })), optional: [], conflicts } } });
    expect(() => resolveCandidates([candidate('agon.a', ['agon.b'])], ['agon.a'])).toThrow(/disabled dependency/);
    expect(() => resolveCandidates([candidate('agon.a', [], ['agon.b']), candidate('agon.b')], ['agon.a', 'agon.b'])).toThrow(/conflict/);
    expect(() => resolveCandidates([candidate('agon.a', ['agon.b']), candidate('agon.b', ['agon.a'])], ['agon.a', 'agon.b'])).toThrow(/cycle/);
  });

  it('validates a fully linked coverage cell', () => {
    CoverageLedgerSchema.parse({ schemaVersion: 1, generatedAt: '2026-08-22T12:00:00.000Z', cells: [{ lifecycle: 'resolve', artifact: 'manifest', owner: '@kernlang/agon-kernel', normativeClause: 'runtime § Deterministic resolution', evidenceId: 'TEST-RESOLVER-PROPERTIES', platform: 'all', status: 'tested' }] });
  });
});
