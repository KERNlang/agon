import { describe, expect, it } from 'vitest';

import { createGeneratedLazySubCommands, lazySubCommands } from '../../packages/cli/src/lazy-commands.js';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { createSlashCommands, createTuiSurfaceIds, detectIntent, SLASH_COMMANDS } from '../../packages/cli/src/signals/intent.js';
import { listMcpTools } from '../../packages/mcp/src/agon-orchestration.js';
import { FIRST_PARTY_SURFACE_CATALOG, SurfaceGeneration } from '../../packages/mod-kernel/src/index.js';

const names = (values: Iterable<string>) => [...values].sort();
const runtime = Object.freeze({
  command: () => ({ exitCode: 0 }),
  tool: () => null,
  parseIntent: () => undefined,
  renderDocs: (publicId: string) => ({ text: publicId }),
});
const projectedMcpTools = FIRST_PARTY_SURFACE_CATALOG.filter(({ category }) => category === 'mcpTools').map((entry) => ({
  name: entry.publicId,
  description: entry.description,
  inputSchema: {},
  ownerId: entry.owner.id,
}));

describe('generated surface cutover', () => {
  it('keeps CLI top-level exposure equal to the generated catalog', () => {
    const expected = FIRST_PARTY_SURFACE_CATALOG
      .filter(({ category, source }) => category === 'cliCommands' && source.includes('/lazy-commands.ts:'))
      .map(({ publicId }) => publicId);
    expect(names(Object.keys(lazySubCommands))).toEqual(names(expected));
  });

  it('keeps TUI slash metadata equal to the generated catalog', () => {
    const expected = FIRST_PARTY_SURFACE_CATALOG.filter(({ category }) => category === 'tuiSlashCommands').map(({ publicId }) => publicId);
    expect(names(SLASH_COMMANDS.map(({ cmd }) => cmd))).toEqual(names(expected));
  });

  it('keeps MCP listing equal to the generated catalog', () => {
    const expected = FIRST_PARTY_SURFACE_CATALOG.filter(({ category }) => category === 'mcpTools').map(({ publicId }) => publicId);
    expect(names(listMcpTools(new Set(expected), projectedMcpTools).map(({ name }) => name))).toEqual(names(expected));
  });

  it('keeps Cesar tool registration equal to the generated catalog', () => {
    const expected = FIRST_PARTY_SURFACE_CATALOG.filter(({ category }) => category === 'cesarTools').map(({ publicId }) => publicId);
    expect(names(createCesarToolRegistry().names())).toEqual(names(expected));
  });

  it('projects all five surfaces from the same generation ID', () => {
    const generation = new SurfaceGeneration({ id: 'generated:s6-parity', mode: 'generated-authoritative', catalog: FIRST_PARTY_SURFACE_CATALOG, runtime });
    const projections = generation.registry.projections();
    expect(Object.values(projections).map(({ generation }) => generation)).toEqual(Array(5).fill('generated:s6-parity'));
    expect(projections.docs.entries).toHaveLength(3);
  });

  it('removes a disabled owner from every real surface adapter', () => {
    const generation = new SurfaceGeneration({ id: 'generated:s6-disabled', mode: 'generated-authoritative', catalog: FIRST_PARTY_SURFACE_CATALOG, runtime, disabledOwnerIds: ['agon.brainstorm'] });
    const ids = (surface: 'cli' | 'tui' | 'mcp' | 'cesar' | 'docs') => new Set(generation.catalog(surface).map(({ publicId }) => publicId));
    expect(Object.keys(createGeneratedLazySubCommands(ids('cli')))).not.toContain('brainstorm');
    expect(createSlashCommands(ids('tui')).map(({ cmd }) => cmd)).not.toContain('/brainstorm');
    expect(detectIntent('/brainstorm ideas', undefined, createTuiSurfaceIds(generation.catalog('tui')))).toMatchObject({ type: 'unknown' });
    expect(listMcpTools(ids('mcp'), projectedMcpTools).map(({ name }) => name)).not.toContain('Brainstorm');
    expect(createCesarToolRegistry(undefined, ids('cesar')).names()).not.toContain('Brainstorm');
    expect(generation.catalog('docs').some(({ owner }) => owner.id === 'agon.brainstorm')).toBe(false);
  });

  it('negative control detects an implementation catalog entry missing from the generated authority', () => {
    const generated = new Set(FIRST_PARTY_SURFACE_CATALOG.filter(({ category }) => category === 'mcpTools').map(({ publicId }) => publicId));
    const mutated = [...listMcpTools(generated, projectedMcpTools), { name: '__legacy_bypass__', description: 'bypass', inputSchema: {} }];
    expect(mutated.some(({ name }) => !generated.has(name))).toBe(true);
  });
});
