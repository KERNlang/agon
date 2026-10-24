import { mkdtemp, readFile, chmod, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DurableModHost, createFirstPartyActivationService, createFirstPartyModCatalog,
  createFullCompatDesiredState, parseDesiredState, bootstrapFirstPartySurfaceGeneration,
  FIRST_PARTY_SURFACE_CATALOG,
  ModActivationService,
} from '../../packages/mod-kernel/src/index.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

const catalog = createFirstPartyModCatalog();
const runtime = { command() { throw new Error('no workflow execution in activation fixture'); },
  tool() { throw new Error('no provider execution in activation fixture'); },
  parseIntent() { return undefined; }, renderDocs() { return { text: '' }; } };

describe('every first-party mod through durable activation and fresh surface bootstrap', () => {
  it.each(['snapshot.json', 'installed-index.json', 'mods.lock.json'])('rejects %s bytes changed between validation and copying', async name => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-artifact-copy-'));
    const desired = createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z');
    let armed = false;
    let copying = false;
    let reads = 0;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async path => {
        const bytes = await nodeHostIo.readFile(path);
        if (copying && path.endsWith('/' + name)) { reads++; return Buffer.from('{"version":999}'); }
        return bytes;
      },
    } });
    const validateGeneration = host.validateGeneration.bind(host);
    host.validateGeneration = async generation => {
      const manifest = await validateGeneration(generation);
      if (armed) copying = true;
      return manifest;
    };
    await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {}, files: { 'snapshot.json': '{"version":1}' } });
    const normal = createFirstPartyActivationService(host);
    const service = new ModActivationService(host, catalog, async (...args) => {
      armed = true;
      return normal.buildArtifacts(...args);
    });
    const plan = await service.preview({ kind: 'disable', id: 'agon.forge' });
    await expect(service.apply(plan)).rejects.toThrow(/artifact.*changed/);
    expect(reads).toBe(1);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });

  it('rejects a plan after selection changes away and back during artifact construction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-activation-aba-'));
    const desired = createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    const normal = createFirstPartyActivationService(host);
    const raced = new ModActivationService(host, catalog, async (...args) => {
      const artifacts = await normal.buildArtifacts(...args);
      await normal.apply(await normal.preview({ kind: 'disable', id: 'agon.forge' }));
      await normal.rollback(1);
      return artifacts;
    });
    await expect(raced.apply(await raced.preview({ kind: 'disable', id: 'agon.review' }))).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });

  it('retains committed artifacts through disable, re-enable, rollback and re-entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-artifacts-'));
    const desired = createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z');
    const lock = await surfaceLockFor(desired);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const files = {
      'settings/snapshot.json': Buffer.from('{ "schemaVersion": 1, "mods": { "agon.forge": { "future": true } } }\n'),
      'migration/original.bin': Buffer.from([0, 255, 128, 13, 10]),
      'migration/receipt.json': Buffer.from('{"sourcePreserved":true}\n'),
      'installation.json': Buffer.from('{"installationId":"fixture-install"}\n'),
    };
    await host.commitGeneration({ operation: 'install', lock, desiredState: desired, installedIndex: { installationId: 'fixture-install' }, files });
    const service = createFirstPartyActivationService(host);
    const checkArtifacts = async (generation: number) => {
      const manifest = await host.validateGeneration(generation);
      for (const [name, bytes] of Object.entries(files)) {
        expect(manifest.files).toHaveProperty(name);
        expect(await readFile(join(host.generationPath(generation), name))).toEqual(bytes);
      }
    };
    const disabled = await service.apply(await service.preview({ kind: 'disable', id: 'agon.forge' }));
    await checkArtifacts(disabled.pointer.generation);
    expect(JSON.parse(await readFile(join(host.generationPath(disabled.pointer.generation), 'desired-state.json'), 'utf8')).disabled).toContain('agon.forge');
    const enabled = await service.apply(await service.preview({ kind: 'enable', id: 'agon.forge' }));
    await checkArtifacts(enabled.pointer.generation);
    await service.rollback(1);
    await checkArtifacts(1);
    const reentered = await service.apply(await service.preview({ kind: 'disable', id: 'agon.forge' }));
    expect(reentered.pointer.generation).toBeGreaterThan(enabled.pointer.generation);
    await checkArtifacts(reentered.pointer.generation);
    await checkArtifacts(1);
  });

  it.each(['missing', 'corrupt'])('refuses a %s retained artifact without changing selection', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-artifact-invalid-'));
    const desired = createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {}, files: { 'snapshot.json': '{"version":1}' } });
    const service = createFirstPartyActivationService(host);
    const plan = await service.preview({ kind: 'disable', id: 'agon.forge' });
    const pointer = await readFile(host.paths.current);
    const path = join(host.generationPath(1), 'snapshot.json');
    if (fault === 'missing') {
      await chmod(host.generationPath(1), 0o700);
      await unlink(path);
    } else {
      await chmod(path, 0o600);
      await writeFile(path, '{"version":999}');
    }
    await expect(service.apply(plan)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(await readFile(host.paths.current)).toEqual(pointer);
  });

  it('refuses an installed index whose descriptor is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-installation-missing-'));
    const desired = createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: { installationId: 'missing' } });
    const service = createFirstPartyActivationService(host);
    await expect(service.apply(await service.preview({ kind: 'disable', id: 'agon.forge' }))).rejects.toThrow(/descriptor.*missing/);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });

  it.each(catalog.mods.map(({ modId }) => modId))('%s: disable and re-enable retain identity and enforce all five surfaces', async (id) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-cycle-'));
    // Install all fixture identities, including non-default mods. Registration
    // does not execute workflows or dispatch providers.
    const desired = parseDesiredState({ ...createFullCompatDesiredState(catalog, '2026-09-05T00:00:00.000Z'),
      selected: catalog.mods.map(({ modId }) => modId).sort(), profile: null });
    const original = await surfaceLockFor(desired);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: original, desiredState: desired, installedIndex: {} });
    const service = createFirstPartyActivationService(host);
    await service.apply(await service.preview({ kind: 'disable', id }));
    const disabled = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root, runtime });
    try {
      expect(disabled.disabledOwnerIds).toContain(id);
      expect(FIRST_PARTY_SURFACE_CATALOG.some((entry) => entry.owner.id === id)).toBe(true);
      for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
        expect(disabled.activated.generation.catalog(surface).some((entry) => entry.owner.id === id)).toBe(false);
        for (const entry of FIRST_PARTY_SURFACE_CATALOG.filter((entry) => entry.surface === surface && entry.owner.id === id)) {
          expect(() => disabled.activated.generation.assertAvailable(surface, entry.publicId)).toThrow();
        }
      }
    } finally { await disabled.activated.dispose(); }
    await service.apply(await service.preview({ kind: 'enable', id }));
    const enabled = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root, runtime });
    try {
      expect(enabled.disabledOwnerIds).not.toContain(id);
      expect((['cli', 'tui', 'mcp', 'cesar', 'docs'] as const).some((surface) =>
        enabled.activated.generation.catalog(surface).some((entry) => entry.owner.id === id))).toBe(true);
      const pointer = (await host.readCurrentPointer())!;
      const lock = JSON.parse(await readFile(join(host.generationPath(pointer.generation), 'mods.lock.json'), 'utf8'));
      const before = original.packages.find((entry) => entry.id === id)!;
      expect(lock.packages.find((entry: { id: string }) => entry.id === id)).toMatchObject({ id, version: before.version, contentHash: before.contentHash, manifestHash: before.manifestHash });
    } finally { await enabled.activated.dispose(); }
  });
});
