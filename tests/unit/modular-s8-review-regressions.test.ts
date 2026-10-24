import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModManifest, ModServices } from '../../packages/mod-api/src/index.js';
import { activateFirstPartySurfaceGeneration, type FirstPartySurfacePackage } from '../../packages/mod-kernel/src/activated-surface-generation.js';
import { discoverUserFolderModsDetailed } from '../../packages/mod-kernel/src/folder-mod-diagnostics.js';
import { ExternalActivationStore } from '../../packages/mod-kernel/src/external-activation-state.js';
import { createSafeExternalModServices } from '../../packages/mod-kernel/src/external-mod-services-safe.js';
import { resolveExternalFolderMods } from '../../packages/mod-kernel/src/external-resolution.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import type { FolderModCandidate } from '../../packages/mod-kernel/src/folder-mods.js';
import type { GeneratedSurfaceCatalogEntry } from '../../packages/mod-kernel/src/surface-generation.js';
import { manifest } from '../helpers/modular-agon.js';

const hash = (value: string): `sha256:${string}` => `sha256:${value.repeat(64)}`;
function services(shape: ModManifest): ModServices {
  return { identity: { id: shape.id, version: shape.version, contentHash: sha256Canonical(shape) }, source: 'bundled',
    logger: { debug() {}, info() {}, warn() {} }, receipts: { record: async () => 'r' }, permissions: { check: async () => 'deny' },
    state: { read: async () => undefined, write: async () => undefined }, engines: { dispatch: async () => ({}) } };
}
function physical(shape: ModManifest, activate = async () => undefined): FirstPartySurfacePackage {
  return { manifest: shape, services: services(shape), mod: { apiVersion: '1', activate } };
}
function external(shape: ModManifest): FolderModCandidate {
  return { packageRoot: '/tmp/example', manifest: shape, manifestHash: hash('a'), contentHash: hash('b'),
    source: 'user-folder', sourceLocator: `/tmp/${shape.id}`, inspection: {} as never };
}

describe('S8 independent-review regressions', () => {
  it('resolves external dependencies and compatibility before import', () => {
    const hostManifest = manifest('agon.host', '1.0.0');
    const host = physical(hostManifest);
    const valid = external(manifest('example.valid', '1.0.0', { dependencies: { required: [{ id: 'agon.host', range: '^1' }], optional: [], conflicts: [] } }));
    expect(resolveExternalFolderMods({ candidates: [valid], hostPackages: [host], kernelVersion: '1.0.0' }).map(({ manifest: value }) => value.id)).toEqual(['example.valid']);
    const missing = external(manifest('example.missing', '1.0.0', { dependencies: { required: [{ id: 'example.absent', range: '^1' }], optional: [], conflicts: [] } }));
    expect(() => resolveExternalFolderMods({ candidates: [missing], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/missing|disabled dependency/i);
    const conflict = external(manifest('example.conflict', '1.0.0', { dependencies: { required: [], optional: [], conflicts: ['agon.host'] } }));
    expect(() => resolveExternalFolderMods({ candidates: [conflict], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/conflict/i);
    const incompatible = external(manifest('example.incompatible', '1.0.0', { compatibility: { kernelRange: '>=9', nodeRange: '>=22' } }));
    expect(() => resolveExternalFolderMods({ candidates: [incompatible], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/incompatible/i);
    const left = external(manifest('example.left', '1.0.0', { dependencies: { required: [{ id: 'example.right', range: '^1' }], optional: [], conflicts: [] } }));
    const incompatibleApi = external(manifest('example.incompatible-api', '1.0.0', { apiRange: '>=9' }));
    expect(() => resolveExternalFolderMods({ candidates: [incompatibleApi], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/incompatible/i);
    const incompatibleNode = external(manifest('example.incompatible-node', '1.0.0', { compatibility: { kernelRange: '^1', nodeRange: '>=99' } }));
    expect(() => resolveExternalFolderMods({ candidates: [incompatibleNode], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/incompatible/i);
    const otherPlatform = process.platform === 'darwin' ? 'linux-x64' : 'darwin-x64';
    const incompatiblePlatform = external(manifest('example.incompatible-platform', '1.0.0', { platforms: [otherPlatform] }));
    expect(() => resolveExternalFolderMods({ candidates: [incompatiblePlatform], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/platform/i);
    const wrongRange = external(manifest('example.wrong-version', '1.0.0', { dependencies: { required: [{ id: 'agon.host', range: '^2' }], optional: [], conflicts: [] } }));
    expect(() => resolveExternalFolderMods({ candidates: [wrongRange], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/range|version|satisf/i);
    const right = external(manifest('example.right', '1.0.0', { dependencies: { required: [{ id: 'example.left', range: '^1' }], optional: [], conflicts: [] } }));
    expect(() => resolveExternalFolderMods({ candidates: [left, right], hostPackages: [host], kernelVersion: '1.0.0' })).toThrow(/cycle/i);
  });

  it('isolates malformed and over-deep sibling packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-diagnostics-'));
    const validRoot = join(root, 'valid'); await mkdir(join(validRoot, 'dist'), { recursive: true });
    const shape = manifest('example.valid');
    await Promise.all([writeFile(join(validRoot, 'agon.mod.json'), JSON.stringify(shape)), writeFile(join(validRoot, 'dist/index.js'), ''), writeFile(join(validRoot, 'dist/index.d.ts'), ''), writeFile(join(validRoot, 'package.json'), JSON.stringify({ type: 'module' }))]);
    const malformed = join(root, 'malformed'); await mkdir(malformed); await writeFile(join(malformed, 'agon.mod.json'), '{');
    let deep = join(root, 'deep'); await mkdir(deep); await writeFile(join(deep, 'agon.mod.json'), JSON.stringify(shape));
    for (let index = 0; index < 34; index += 1) { deep = join(deep, 'x'); await mkdir(deep); }
    const result = await discoverUserFolderModsDetailed(root);
    expect(result.candidates.map(({ manifest: value }) => value.id)).toEqual(['example.valid']);
    expect(result.diagnostics.map(({ entry }) => entry).sort()).toEqual(['deep', 'malformed']);
  });

  it('rejects duplicate mod IDs even when their versions differ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-duplicate-id-'));
    for (const [folder, version] of [['one', '1.0.0'], ['two', '2.0.0']] as const) {
      const packageRoot = join(root, folder); await mkdir(join(packageRoot, 'dist'), { recursive: true });
      const shape = manifest('example.same-id', version);
      await Promise.all([writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(shape)),
        writeFile(join(packageRoot, 'dist/index.js'), ''), writeFile(join(packageRoot, 'dist/index.d.ts'), ''),
        writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }))]);
    }
    const result = await discoverUserFolderModsDetailed(root);
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every(({ message }) => message === 'duplicate folder mod identity')).toBe(true);
  });

  it('keeps trust-independent activation state exact and reversible', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-enable-'));
    const store = new ExternalActivationStore(root);
    const identity = { modId: 'example.enabled', version: '1.0.0', source: 'user-folder' as const, sourceLocator: '/mods/enabled', contentHash: hash('c'), manifestHash: hash('d'), publisherHash: hash('e') };
    expect(await store.enabled(identity)).toBe(false);
    const enable = store.preview(identity, true, 'enable', '2026-09-04T00:00:00.000Z'); await store.apply(enable, enable.planHash);
    expect(await new ExternalActivationStore(root).enabled(identity)).toBe(true);
    const disable = store.preview(identity, false, 'disable', '2026-09-04T00:00:01.000Z'); await store.apply(disable, disable.planHash);
    expect(await store.enabled(identity)).toBe(false);
    expect(await store.enabled({ ...identity, contentHash: hash('e') })).toBe(false);
  });

  it('settles every disposer after commit collision and reports cleanup failure', async () => {
    const firstDispose = vi.fn(async () => { throw new Error('first cleanup failed'); });
    const secondDispose = vi.fn(async () => undefined);
    const contribution = (id: string) => manifest(id, '1.0.0', { contributes: { cliCommands: [{ id: 'shared', aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] } });
    const one = contribution('example.a'); const two = contribution('example.b');
    const entry = (owner: ModManifest, publicId: string): GeneratedSurfaceCatalogEntry => ({ surface: 'cli', kind: 'cli-command', registryId: 'shared', publicId,
      category: 'external:cliCommands', group: 'test', source: owner.id, aliases: [], owner: services(owner).identity,
      ownerClass: owner.packageClass, description: owner.id, accessibility: { label: owner.id, fallbackText: owner.id, keyboardAccessible: true, colorIndependent: true } });
    const activate = (dispose: () => Promise<void>) => async (registrar: Parameters<FirstPartySurfacePackage['mod']['activate']>[0]) => {
      registrar.command('cli', { id: 'shared', aliases: [], description: 'shared', async run() { return { exitCode: 0 }; } }); return dispose;
    };
    await expect(activateFirstPartySurfaceGeneration({ id: 'cleanup', runtime: { command: () => ({ exitCode: 0 }), tool: () => ({}), parseIntent: () => undefined, renderDocs: (id) => ({ text: id }) },
      catalog: [entry(one, 'one'), entry(two, 'two')], packages: [physical(one, activate(firstDispose)), physical(two, async () => secondDispose)] })).rejects.toThrow(/cleanup|activation/i);
    expect(firstDispose).toHaveBeenCalledOnce(); expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('persists owner-scoped state and redacted receipts across service recreation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-services-')); const shape = manifest('example.state');
    const first = createSafeExternalModServices({ hostRoot: root, manifest: shape, contentHash: hash('f'), source: 'user-folder' });
    await first.state.write('counter', 7); await first.receipts.record('network', { token: 'do-not-store', result: 'ok' });
    const second = createSafeExternalModServices({ hostRoot: root, manifest: shape, contentHash: hash('f'), source: 'user-folder' });
    expect(await second.state.read('counter')).toBe(7);
    const ownerRoot = join(root, 'external-mod-data'); const owner = (await readdir(ownerRoot))[0]!;
    const receiptNames = await readdir(join(ownerRoot, owner, 'receipts'));
    const contents = await Promise.all(receiptNames.map((name) => readFile(join(ownerRoot, owner, 'receipts', name), 'utf8')));
    expect(contents.join('\n')).not.toContain('do-not-store'); expect(contents.join('\n')).toContain('[redacted]');
  });
});
