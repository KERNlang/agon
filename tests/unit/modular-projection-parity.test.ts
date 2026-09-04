import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_SURFACE_CATALOG,
  generateLegacySurfaceProjections,
} from '../../packages/mod-kernel/src/index.js';

const inventory = JSON.parse(readFileSync('docs/specs/evidence/modular-agon-current-inventory.json', 'utf8')) as {
  categories: Record<string, { id: string; source: string }[]>;
};
const ownership = JSON.parse(readFileSync('docs/specs/evidence/modular-agon-ownership.json', 'utf8')) as {
  assignments: { category: string; id: string; source: string; package: string }[];
};

const projectedCategories = [
  'cliCommands',
  'tuiSlashCommands',
  'tuiKeyboardActions',
  'builtinCommandMetadata',
  'intentVariants',
  'mcpTools',
  'cesarTools',
  'cesarRoutes',
  'generatedDocumentation',
] as const;

function occurrenceKey(category: string, id: string, source: string): string {
  return `${category}\0${id}\0${source}`;
}

describe('legacy compatibility surface generation', () => {
  it('has byte-for-occurrence parity with every frozen legacy surface catalog', () => {
    const generated = new Set(LEGACY_SURFACE_CATALOG.map(({ payload }) => occurrenceKey(payload.category, payload.publicId, payload.source)));
    const legacy = new Set(projectedCategories.flatMap((category) => inventory.categories[category]!.map(({ id, source }) => occurrenceKey(category, id, source))));
    expect(generated.size).toBe(449);
    expect(generated).toEqual(legacy);
  });

  it('preserves the frozen owner assignment for every occurrence', () => {
    const expected = new Map(ownership.assignments.map(({ category, id, source, package: packageName }) => [occurrenceKey(category, id, source), packageName]));
    for (const { payload } of LEGACY_SURFACE_CATALOG) {
      expect(payload.ownerPackage, occurrenceKey(payload.category, payload.publicId, payload.source)).toBe(expected.get(occurrenceKey(payload.category, payload.publicId, payload.source)));
    }
  });

  it('generates CLI, TUI, MCP, Cesar, and docs from one generation', () => {
    const projections = generateLegacySurfaceProjections();
    expect(Object.fromEntries(Object.entries(projections).map(([surface, projection]) => [surface, projection.entries.length]))).toEqual({
      cli: 77,
      tui: 237,
      mcp: 33,
      cesar: 99,
      docs: 3,
    });
    expect(new Set(Object.values(projections).map(({ generation }) => generation)).size).toBe(1);
  });

  it('makes a disabled fixture owner unreachable from every generated surface', () => {
    const disabledOwnerId = 'agon.brainstorm';
    expect(LEGACY_SURFACE_CATALOG.some(({ owner }) => owner.id === disabledOwnerId)).toBe(true);
    const projections = generateLegacySurfaceProjections({ disabledOwnerIds: [disabledOwnerId] });
    for (const projection of Object.values(projections)) {
      expect(projection.entries.some(({ owner }) => owner.id === disabledOwnerId), projection.surface).toBe(false);
    }
  });
});
