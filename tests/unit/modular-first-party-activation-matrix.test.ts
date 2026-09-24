import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DurableModHost, createFirstPartyActivationService, createFirstPartyModCatalog,
  createFullCompatDesiredState, parseDesiredState, bootstrapFirstPartySurfaceGeneration,
  FIRST_PARTY_SURFACE_CATALOG,
} from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

const catalog = createFirstPartyModCatalog();
const runtime = { command() { throw new Error('no workflow execution in activation fixture'); },
  tool() { throw new Error('no provider execution in activation fixture'); },
  parseIntent() { return undefined; }, renderDocs() { return { text: '' }; } };

describe('every first-party mod through durable activation and fresh surface bootstrap', () => {
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
