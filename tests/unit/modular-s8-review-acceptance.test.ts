import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { validateManifest, type ModManifest, type ModServices } from '../../packages/mod-api/src/index.js';
import { activateFirstPartySurfaceGeneration, type FirstPartySurfacePackage } from '../../packages/mod-kernel/src/activated-surface-generation.js';
import { readExactBounded, type PositionalReadable } from '../../packages/mod-kernel/src/bounded-file-read.js';
import { mapSettledBounded } from '../../packages/mod-kernel/src/bounded-work.js';
import { ExternalActivationStore, type ExternalActivationIdentity } from '../../packages/mod-kernel/src/external-activation-state.js';
import { createSafeExternalModServices } from '../../packages/mod-kernel/src/external-mod-services-safe.js';
import { resolveExternalFolderMods, resolveExternalFolderModsIsolated } from '../../packages/mod-kernel/src/external-resolution.js';
import { createExternalSurfaceCatalog } from '../../packages/mod-kernel/src/external-surface-catalog.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import type { FolderModCandidate } from '../../packages/mod-kernel/src/folder-mods.js';
import { SurfaceGenerationError, type GeneratedSurfaceCatalogEntry } from '../../packages/mod-kernel/src/surface-generation.js';
import { activatePreparedThirdPartyMod, type PreparedThirdPartyMod } from '../../packages/mod-kernel/src/third-party-activation.js';
import { bootstrapFirstPartySurfaceGeneration } from '../../packages/mod-kernel/src/first-party-surface-bootstrap.js';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createFirstPartyModCatalog, createFullCompatDesiredState } from '../../packages/mod-kernel/src/desired-state.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { manifest } from '../helpers/modular-agon.js';

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const runtime = { command: () => ({ exitCode: 0 }), tool: () => ({}), parseIntent: () => undefined, renderDocs: (id: string) => ({ text: id }) };

function validManifest(id: string, overrides: Partial<ModManifest> = {}): ModManifest {
  const base = manifest(id, '1.0.0', { compatibility: { kernelRange: '^1.0.0', nodeRange: '>=22 <27' } });
  return { ...base, pack: { ...base.pack, include: [...new Set([...base.pack.include, 'package.json'])] }, ...overrides };
}

function candidate(shape: ModManifest): FolderModCandidate {
  return { packageRoot: `/tmp/${shape.id}`, manifest: shape, manifestHash: hash('a'), contentHash: hash('b'),
    source: 'user-folder', sourceLocator: `/tmp/${shape.id}`, inspection: {} as never };
}

function services(shape: ModManifest): ModServices {
  return { identity: { id: shape.id, version: shape.version, contentHash: sha256Canonical(shape) }, source: 'bundled',
    logger: { debug() {}, info() {}, warn() {} }, receipts: { record: async () => 'r' }, permissions: { check: async () => 'deny' },
    state: { read: async () => undefined, write: async () => undefined }, engines: { dispatch: async () => ({}) } };
}

function surfaceEntry(shape: ModManifest, id: string): GeneratedSurfaceCatalogEntry {
  return { surface: 'cli', kind: 'cli-command', registryId: id, publicId: id, category: 'external:cliCommands', group: 'test', source: shape.id,
    aliases: [], owner: services(shape).identity, ownerClass: shape.packageClass, description: id,
    accessibility: { label: id, fallbackText: id, keyboardAccessible: true, colorIndependent: true } };
}

describe('S8 independent review acceptance controls', () => {
  it('bounds parallel inspection work while preserving deterministic result order', async () => {
    let active = 0; let peak = 0;
    const results = await mapSettledBounded([0, 1, 2, 3, 4], 2, async (value) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (5 - value) * 2));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBe(2);
    expect(results.map((result) => result.status === 'fulfilled' ? result.value : -1)).toEqual([0, 2, 4, 6, 8]);
  });

  it('rejects file growth and shrinkage during a bounded positional read', async () => {
    const readable = (bytes: Buffer): PositionalReadable => ({ async read(buffer, offset, length, position) {
      const slice = bytes.subarray(position, position + length); slice.copy(buffer, offset); return { bytesRead: slice.length };
    } });
    await expect(readExactBounded(readable(Buffer.from('abcd')), 3, 10)).rejects.toThrow(/changed during bounded read/);
    await expect(readExactBounded(readable(Buffer.from('ab')), 3, 10)).rejects.toThrow(/changed during bounded read/);
    await expect(readExactBounded(readable(Buffer.from('abc')), 3, 10)).resolves.toEqual(Buffer.from('abc'));
  });

  it('rejects ambiguous permissions, portable path collisions, missing ESM metadata, and uppercase TUI IDs', () => {
    const base = validManifest('example.manifest');
    expect(() => validateManifest({ ...base, permissions: [
      { capability: 'state.read', resources: ['key'], required: true },
      { capability: 'state.read', resources: ['other'], required: true },
    ] })).toThrow(/duplicate permission capability/);
    expect(() => validateManifest({ ...base, permissions: [{ capability: 'state.read', resources: ['key', 'key'], required: true }] })).toThrow(/duplicate permission resource/);
    expect(() => validateManifest({ ...base, permissions: [{ capability: 'state.read', resources: ['bad\0key'], required: true }] })).toThrow(/pattern|printable ASCII/);
    expect(() => validateManifest({ ...base, pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'DIST/index.js', 'dist/index.d.ts'], executable: [] } })).toThrow(/portable package path collision/);
    expect(() => validateManifest({ ...base, pack: { include: ['agon.mod.json', 'dist/index.js', 'dist/index.d.ts'], executable: [] } })).toThrow(/package.json/);
    expect(() => validateManifest({ ...base, contributes: { ...base.contributes, tuiActions: [{ id: 'Uppercase', aliases: [] }] } })).toThrow(/lowercase/);
  });

  it('projects non-UI ownership for lifecycle, result, and config contributions', () => {
    const shape = validManifest('example.non-ui', { contributes: {
      cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], generatedDocs: [],
      lifecycleHooks: [{ id: 'session.start', aliases: [] }], resultTypes: [{ id: 'example.result', aliases: [] }], configKeys: [{ id: 'example.config', aliases: [] }],
    } });
    expect(createExternalSurfaceCatalog([candidate(shape)]).map(({ kind }) => kind).sort()).toEqual(['config', 'lifecycle', 'result-type']);
  });

  it('rejects host packages that claim an unfrozen kernel capability', () => {
    const shape = validManifest('example.host-package', { dependencies: {
      required: [{ id: 'agon.unknown-host-capability', range: '^1' }], optional: [], conflicts: [],
    } });
    const hostPackage: FirstPartySurfacePackage = { manifest: shape, services: services(shape),
      mod: { apiVersion: '1', async activate() {} } };
    expect(() => resolveExternalFolderMods({ candidates: [], hostPackages: [hostPackage], kernelVersion: '1.0.0' }))
      .toThrow(/not a frozen host capability/);
  });

  it('isolates an unresolvable external package while retaining a healthy sibling', () => {
    const good = candidate(validManifest('example.good'));
    const badShape = validManifest('example.bad', { dependencies: { required: [{ id: 'example.missing', range: '^1' }], optional: [], conflicts: [] } });
    const result = resolveExternalFolderModsIsolated({ candidates: [candidate(badShape), good], hostPackages: [], kernelVersion: '1.0.0' });
    expect(result.candidates.map(({ manifest: shape }) => shape.id)).toEqual(['example.good']);
    expect(result.diagnostics).toMatchObject([{ code: 'EXTERNAL_RESOLUTION_FAILED', details: { modId: 'example.bad' } }]);
  });

  it('isolates activation failure and keeps healthy owners callable', async () => {
    const bad = validManifest('example.bad', { contributes: { ...validManifest('example.bad').contributes, cliCommands: [{ id: 'bad', aliases: [] }] } });
    const good = validManifest('example.good', { contributes: { ...validManifest('example.good').contributes, cliCommands: [{ id: 'good', aliases: [] }] } });
    const packages: FirstPartySurfacePackage[] = [
      { manifest: bad, services: services(bad), mod: { apiVersion: '1', async activate() { throw new Error('broken mod'); } } },
      { manifest: good, services: services(good), mod: { apiVersion: '1', async activate(registrar) { registrar.command('cli', { id: 'good', aliases: [], description: 'good', async run() { return { exitCode: 0 }; } }); } } },
    ];
    const isolated = vi.fn(async ({ manifest: shape }: FirstPartySurfacePackage) => shape.id === 'example.bad');
    const activated = await activateFirstPartySurfaceGeneration({ id: 'isolated', catalog: [surfaceEntry(bad, 'bad'), surfaceEntry(good, 'good')], runtime,
      packages, isolatePackageFailure: isolated });
    expect(activated.failedOwnerIds).toEqual(['example.bad']);
    expect(activated.generation.assertAvailable('cli', 'good').owner.id).toBe('example.good');
    expect(() => activated.generation.assertAvailable('cli', 'bad')).toThrow(SurfaceGenerationError);
    await activated.dispose();
  });

  it('bounds activation itself and validates the disposer contract', async () => {
    const shape = validManifest('example.timeout');
    const prepared = { candidate: candidate(shape), manifest: shape, services: services(shape), contentHash: hash('b'),
      trustRecordId: 'trust', grantRecordIds: [], trustModel: 'full-code' as const, dispose: async () => undefined,
      mod: { apiVersion: '1' as const, activate: async () => new Promise<never>(() => undefined) } } satisfies PreparedThirdPartyMod;
    await expect(activatePreparedThirdPartyMod(prepared, {} as never, 5)).rejects.toThrow(/timed out/);
    const invalid = { ...prepared, mod: { apiVersion: '1' as const, activate: async () => 'not-a-disposer' as never } };
    await expect(activatePreparedThirdPartyMod(invalid, {} as never, 50)).rejects.toThrow(/disposer must be a function/);
  });

  it('rejects non-canonical activation identities and timestamps before persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-activation-shape-'));
    const store = new ExternalActivationStore(root);
    const identity: ExternalActivationIdentity = { modId: 'example.valid', version: '1.0.0', source: 'user-folder', sourceLocator: '/mods/valid',
      contentHash: hash('a'), manifestHash: hash('b'), publisherHash: hash('c') };
    expect(() => store.preview({ ...identity, modId: 'INVALID' }, true, 'test')).toThrow(/text is invalid/);
    expect(() => store.preview({ ...identity, version: 'not-semver' }, true, 'test')).toThrow(/text is invalid/);
    expect(() => store.preview({ ...identity, sourceLocator: '/mods/valid\0escape' }, true, 'test')).toThrow(/text is invalid/);
    expect(() => store.preview(identity, true, 'test', '2026-09-04T02:00:00+02:00')).toThrow(/text is invalid/);
  });

  it('recovers both pre-record and post-record activation transaction failures deterministically', async () => {
    const identity: ExternalActivationIdentity = { modId: 'example.recover', version: '1.0.0', source: 'user-folder', sourceLocator: '/mods/recover',
      contentHash: hash('a'), manifestHash: hash('b'), publisherHash: hash('c') };
    const beforeRoot = await mkdtemp(join(tmpdir(), 'agon-s8-activation-before-'));
    const before = new ExternalActivationStore(beforeRoot, undefined, { faultAt: 'after-preparing-journal' });
    const beforePlan = before.preview(identity, true, 'test');
    await expect(before.apply(beforePlan, beforePlan.planHash)).rejects.toThrow(/injected/);
    const beforeRecovery = new ExternalActivationStore(beforeRoot); await beforeRecovery.recover();
    expect(await beforeRecovery.enabled(identity)).toBe(false);
    const beforeJournal = JSON.parse(await readFile(join(beforeRoot, 'external-activation-transactions', (await readdir(join(beforeRoot, 'external-activation-transactions')))[0]!), 'utf8'));
    expect(beforeJournal.state).toBe('rolled-back');
    const beforeJournalPath = join(beforeRoot, 'external-activation-transactions', (await readdir(join(beforeRoot, 'external-activation-transactions')))[0]!);
    await writeFile(beforeJournalPath, JSON.stringify({ ...beforeJournal, unexpected: true }));
    await expect(new ExternalActivationStore(beforeRoot).recover()).rejects.toThrow(/activation journal is invalid/);

    const afterRoot = await mkdtemp(join(tmpdir(), 'agon-s8-activation-after-'));
    const after = new ExternalActivationStore(afterRoot, undefined, { faultAt: 'after-record-write' });
    const afterPlan = after.preview(identity, true, 'test');
    await expect(after.apply(afterPlan, afterPlan.planHash)).rejects.toThrow(/injected/);
    const afterRecovery = new ExternalActivationStore(afterRoot); await afterRecovery.recover();
    expect(await afterRecovery.enabled(identity)).toBe(true);
    const afterJournal = JSON.parse(await readFile(join(afterRoot, 'external-activation-transactions', (await readdir(join(afterRoot, 'external-activation-transactions')))[0]!), 'utf8'));
    expect(afterJournal.state).toBe('committed');
  });

  it('keeps management callable and binds safe mode to a verified recovery generation for valid or malformed pointers', async () => {
    for (const corruptPointer of [false, true]) {
      const root = await mkdtemp(join(tmpdir(), 'agon-s8-safe-pointer-'));
      const desired = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
      if (corruptPointer) await writeFile(host.paths.current, '{malformed');
      const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root, safeMode: true, runtime });
      expect(boot.pointerCanonical).not.toBeNull();
      expect(boot.activated.generation.assertAvailable('cli', 'mod')).toBeDefined();
      expect(boot.activated.generation.catalog().every(({ owner }) => owner.id === 'agon.kernel')).toBe(true);
      await boot.activated.dispose();
    }
  });

  it('boots kernel-only safe mode despite corrupt desired, trust, activation, and folder-mod state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-safe-corrupt-'));
    const hostRoot = join(root, 'host'); const modsRoot = join(root, 'mods');
    await mkdir(join(hostRoot, 'trust'), { recursive: true });
    await mkdir(join(hostRoot, 'external-activation'), { recursive: true });
    await mkdir(join(modsRoot, 'broken'), { recursive: true });
    await writeFile(join(hostRoot, 'desired-state.json'), '{broken');
    await writeFile(join(hostRoot, 'trust', 'broken.json'), '{broken');
    await writeFile(join(hostRoot, 'external-activation', 'broken.json'), '{broken');
    await writeFile(join(modsRoot, 'broken', 'agon.mod.json'), '{broken');
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot, modsRoot, runtime, safeMode: true });
    expect(boot.activePackageIds).toEqual([]);
    expect(boot.activated.generation.catalog().every(({ owner }) => owner.id === 'agon.kernel')).toBe(true);
    await boot.activated.dispose();
  });

  it('persists redacted log receipts for key names, bearer values, and caller-supplied secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-log-redaction-'));
    const shape = validManifest('example.logs');
    process.env.AGON_TEST_API_KEY = 'known-secret'; const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const external = createSafeExternalModServices({ hostRoot: root, manifest: shape, contentHash: hash('d'), source: 'user-folder' });
    expect(external.browser).toBeUndefined(); expect(external.workspace).toBeUndefined(); expect(external.runs).toBeUndefined(); expect(external.mutation).toBeUndefined();
    await external.logger.warn('Bearer abc.def known-secret a25vd24tc2VjcmV0 postgres://admin:uri-password@localhost/db?token=query-secret', { apiKey: 'hidden', nested: { value: 'known-secret' } });
    const receiptRoot = join(root, 'external-mod-data', (await readdir(join(root, 'external-mod-data')))[0]!, 'receipts');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await readdir(receiptRoot)).length > 0) break; } catch { /* asynchronous fire-and-record */ }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const content = await readFile(join(receiptRoot, (await readdir(receiptRoot))[0]!), 'utf8');
    delete process.env.AGON_TEST_API_KEY;
    expect(content).not.toContain('abc.def'); expect(content).not.toContain('known-secret'); expect(content).not.toContain('a25vd24tc2VjcmV0'); expect(content).not.toContain('uri-password'); expect(content).not.toContain('query-secret'); expect(content).not.toContain('hidden');
    expect(content).toContain('[redacted]');
    const warningText = JSON.stringify(warning.mock.calls); warning.mockRestore();
    expect(warningText).not.toContain('known-secret'); expect(warningText).not.toContain('a25vd24tc2VjcmV0'); expect(warningText).not.toContain('abc.def');
  });
});
