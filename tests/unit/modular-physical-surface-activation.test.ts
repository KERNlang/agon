import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  FIRST_PARTY_SURFACE_CATALOG,
  activateFirstPartySurfaceGeneration,
} from '../../packages/mod-kernel/src/index.js';
import type { GeneratedSurfaceRuntime } from '../../packages/mod-kernel/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const packageMap = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const physicalPackageIds: string[] = packageMap.packages
  .filter((entry: { class: string }) => entry.class === 'user-toggleable-mod-package')
  .map((entry: { id: string }) => entry.id);

const runtime: GeneratedSurfaceRuntime = Object.freeze({
  command: () => ({ exitCode: 0 }),
  tool: () => null,
  parseIntent: () => undefined,
  renderDocs: (publicId: string) => ({ text: publicId }),
});

function services(manifest: any): any {
  return {
    identity: { id: manifest.id, version: manifest.version, contentHash: manifest.assets[0]?.contentHash ?? `sha256:${'0'.repeat(64)}` },
    source: { kind: 'bundled', locator: manifest.id },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'receipt') },
    permissions: { check: vi.fn(async () => ({ allowed: true })) },
    state: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) },
    engines: { dispatch: vi.fn(async () => null) },
    firstPartyCompatibility: {
      command: runtime.command,
      tool: runtime.tool,
      parseIntent: runtime.parseIntent,
      lifecycle: async () => undefined,
      render: runtime.renderDocs,
    },
  };
}

async function loadPhysicalPackages() {
  return Promise.all(physicalPackageIds.map(async (id) => {
    const loaded: any = await import(id);
    const injected = services(loaded.MANIFEST);
    return { manifest: loaded.MANIFEST, mod: await loaded.createMod(injected), services: injected };
  }));
}

describe('physical first-party surface activation', () => {
  it('activates all 36 physical mod packages into the single five-surface generation', async () => {
    const packages = await loadPhysicalPackages();
    expect(packages).toHaveLength(36);
    const activated = await activateFirstPartySurfaceGeneration({
      id: 'generated:s6-physical', catalog: FIRST_PARTY_SURFACE_CATALOG, runtime, packages,
    });
    for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
      expect(activated.generation.project(surface).entries).toHaveLength(
        FIRST_PARTY_SURFACE_CATALOG.filter((entry) => entry.surface === surface).length,
      );
    }
    await activated.dispose();
    for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
      expect(activated.generation.project(surface).entries.some(({ owner }) => physicalPackageIds.includes('@kernlang/agon-mod-' + owner.id.slice(5)))).toBe(false);
    }
  });

  it('never activates a disabled physical owner', async () => {
    const packages = await loadPhysicalPackages();
    const disabled = packages.find(({ manifest }) => manifest.id === 'agon.brainstorm')!;
    const activated = await activateFirstPartySurfaceGeneration({
      id: 'generated:s6-disabled-physical', catalog: FIRST_PARTY_SURFACE_CATALOG, runtime, packages,
      disabledOwnerIds: [disabled.manifest.id],
    });
    for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
      expect(activated.generation.project(surface).entries.some(({ owner }) => owner.id === disabled.manifest.id)).toBe(false);
    }
    await activated.dispose();
  });
  it("fails closed when an active user owner has no physical package", async () => {
    const packages = await loadPhysicalPackages();
    await expect(activateFirstPartySurfaceGeneration({
      id: "generated:s6-missing-physical", catalog: FIRST_PARTY_SURFACE_CATALOG, runtime, packages: packages.slice(1),
    })).rejects.toThrow(/lack physical packages/);
  });
});
