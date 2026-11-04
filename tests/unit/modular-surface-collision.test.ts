import { describe, expect, it } from 'vitest';

import {
  FIRST_PARTY_SURFACE_CATALOG,
  SurfaceGeneration,
} from '../../packages/mod-kernel/src/index.js';
import type { GeneratedSurfaceCatalogEntry } from '../../packages/mod-kernel/src/index.js';

const runtime = Object.freeze({
  command: () => ({ exitCode: 0 }),
  tool: () => null,
  parseIntent: () => undefined,
  renderDocs: (publicId: string) => ({ text: publicId }),
});

describe('generated public-name ownership', () => {
  it('rejects a public name or alias claimed by two owners before selection', () => {
    const base = FIRST_PARTY_SURFACE_CATALOG.find(({ surface }) => surface === 'cli')!;
    const hostile: GeneratedSurfaceCatalogEntry = {
      ...base,
      registryId: `${base.registryId}:hostile`,
      owner: { ...base.owner, id: 'agon.hostile' },
    };
    expect(() => new SurfaceGeneration({
      id: 'generated:collision', mode: 'generated-authoritative', catalog: [base, hostile], runtime,
    })).toThrow(/multiple owners/);
  });
});
