import { describe, expect, it, vi } from 'vitest';
import { ModRegistry, RegistryInvariantError } from '../../packages/mod-kernel/src/index.js';
import type { LegacyRegistryEntry } from '../../packages/mod-kernel/src/index.js';
import type { ModIdentity } from '../../packages/mod-api/src/index.js';
import { manifest } from '../helpers/modular-agon.js';

const hash = `sha256:${'a'.repeat(64)}` as const;
const active: ModIdentity = { id: 'example.active', version: '1.0.0', contentHash: hash };
const disabled: ModIdentity = { id: 'example.disabled', version: '1.0.0', contentHash: hash };
const competitor: ModIdentity = { id: 'example.competitor', version: '1.0.0', contentHash: hash };

describe('owner-tagged ModRegistry', () => {
  it('projects one registry into all five surfaces and excludes disabled owners', () => {
    const entries: LegacyRegistryEntry[] = [
      { surface: 'cli', kind: 'cli-command', id: 'active-cli', owner: active },
      { surface: 'tui', kind: 'tui-action', id: 'active-tui', owner: active },
      { surface: 'mcp', kind: 'mcp-tool', id: 'active-mcp', owner: active },
      { surface: 'cesar', kind: 'cesar-tool', id: 'active-cesar', owner: active },
      { surface: 'docs', kind: 'docs', id: 'active-docs', owner: active },
      { surface: 'cli', kind: 'cli-command', id: 'disabled-cli', owner: disabled },
      { surface: 'tui', kind: 'tui-action', id: 'disabled-tui', owner: disabled },
      { surface: 'mcp', kind: 'mcp-tool', id: 'disabled-mcp', owner: disabled },
      { surface: 'cesar', kind: 'cesar-tool', id: 'disabled-cesar', owner: disabled },
      { surface: 'docs', kind: 'docs', id: 'disabled-docs', owner: disabled },
    ];
    const registry = ModRegistry.fromLegacy({ generation: 'fixture:1', activeOwners: [active] }, entries);
    const projections = registry.projections();
    expect(Object.keys(projections)).toEqual(['cli', 'tui', 'mcp', 'cesar', 'docs']);
    for (const projection of Object.values(projections)) {
      expect(projection.entries).toHaveLength(1);
      expect(projection.entries[0]?.owner.id).toBe(active.id);
      expect(projection.entries[0]?.id).not.toContain('disabled');
    }
  });

  it('enforces declarations, collisions, aliases, and late-registration sealing', () => {
    const registry = new ModRegistry({ generation: 'fixture:2', activeOwners: [active] });
    const contribution = {
      id: 'hello', aliases: ['hi'], description: 'hello',
      run: vi.fn(async () => ({ exitCode: 0 })),
    };
    const modManifest = manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: 'hello', aliases: ['hi'] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    });
    const session = registry.beginRegistration(modManifest);
    session.registrar.command('cli', contribution);
    session.commit();
    expect(registry.resolve('cli-command', 'hello')?.owner.id).toBe(active.id);
    expect(registry.resolve('cli-command', 'hi')?.id).toBe('hello');
    expect(() => session.registrar.command('cli', contribution)).toThrow(/committed/);

    const second = new ModRegistry({ generation: 'fixture:3', activeOwners: [active] }).beginRegistration(modManifest);
    expect(() => second.registrar.command('cli', { ...contribution, id: 'undeclared' })).toThrow(/did not declare/);
  });

  it('disposes contributions in owner scope and makes them unreachable', async () => {
    const registry = ModRegistry.fromLegacy({ generation: 'fixture:4', activeOwners: [active] }, [
      { surface: 'cli', kind: 'cli-command', id: 'one', owner: active },
      { surface: 'mcp', kind: 'mcp-tool', id: 'two', owner: active },
    ]);
    await registry.disposeOwner(active.id);
    expect(registry.resolve('cli-command', 'one')).toBeUndefined();
    expect(registry.resolve('mcp-tool', 'two')).toBeUndefined();
    expect(registry.project('cli').entries).toEqual([]);
    expect(registry.project('mcp').entries).toEqual([]);
  });

  it('rejects inactive registration and duplicate owner identity', () => {
    expect(() => new ModRegistry({ generation: 'fixture:5', activeOwners: [active, active] })).toThrow(RegistryInvariantError);
    const registry = new ModRegistry({ generation: 'fixture:6', activeOwners: [] });
    expect(() => registry.beginRegistration(manifest(active.id))).toThrow(/not active/);
  });

  it('keeps staged registrations invisible until commit', () => {
    const registry = new ModRegistry({ generation: 'fixture:7', activeOwners: [active] });
    const modManifest = manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: 'hello', aliases: [] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    });
    const session = registry.beginRegistration(modManifest);
    session.registrar.command('cli', { id: 'hello', run: async () => ({ exitCode: 0 }) });
    expect(registry.resolve('cli-command', 'hello')).toBeUndefined();
    session.commit();
    expect(registry.resolve('cli-command', 'hello')?.id).toBe('hello');
  });

  it('rejects reserved IDs used as aliases', () => {
    const registry = new ModRegistry({
      generation: 'fixture:8', activeOwners: [active], reservedIds: { 'cli-command': ['doctor'] },
    });
    const modManifest = manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: 'friendly', aliases: ['doctor'] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    });
    const session = registry.beginRegistration(modManifest);
    expect(() => session.registrar.command('cli', {
      id: 'friendly', aliases: ['doctor'], run: async () => ({ exitCode: 0 }),
    })).toThrow(/reserved/);
  });

  it('refuses to commit when a declared contribution was not registered', () => {
    const registry = new ModRegistry({ generation: 'fixture:9', activeOwners: [active] });
    const session = registry.beginRegistration(manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: 'missing', aliases: [] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    }));
    expect(() => session.commit()).toThrow(/not registered/);
    expect(registry.resolve('cli-command', 'missing')).toBeUndefined();
  });

  it('activates declared tool aliases and prevents one declaration from registering two kinds', () => {
    const registry = new ModRegistry({ generation: 'fixture:10', activeOwners: [active] });
    const toolManifest = manifest(active.id, active.version, {
      contributes: {
        cliCommands: [], tuiActions: [], mcpTools: [{ id: 'lookup', aliases: ['find'] }], cesarTools: [],
        lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    });
    const session = registry.beginRegistration(toolManifest);
    session.registrar.tool('mcp', {
      id: 'lookup', aliases: ['find'], description: 'lookup', inputSchema: {}, effect: 'read', run: async () => null,
    });
    session.commit();
    expect(registry.resolve('mcp-tool', 'find')?.id).toBe('lookup');

    const ambiguous = new ModRegistry({ generation: 'fixture:11', activeOwners: [active] });
    const ambiguousManifest = manifest(active.id, active.version, {
      contributes: {
        cliCommands: [], tuiActions: [{ id: 'same', aliases: [] }], mcpTools: [], cesarTools: [],
        lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    });
    const ambiguousSession = ambiguous.beginRegistration(ambiguousManifest);
    ambiguousSession.registrar.command('tui', { id: 'same', run: async () => ({ exitCode: 0 }) });
    expect(() => ambiguousSession.registrar.intent({ id: 'same', description: 'same', inputSchema: {}, parse: async () => null, run: async () => null })).toThrow(/more than once/);
  });

  it('rolls back every published record when a concurrent session wins a commit collision', () => {
    const registry = new ModRegistry({ generation: 'fixture:12', activeOwners: [active, competitor] });
    const first = registry.beginRegistration(manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: 'first-only', aliases: [] }, { id: 'shared', aliases: [] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    }));
    first.registrar.command('cli', { id: 'first-only', description: 'first', run: async () => ({ exitCode: 0 }) });
    first.registrar.command('cli', { id: 'shared', description: 'shared', run: async () => ({ exitCode: 0 }) });

    const winner = registry.beginRegistration(manifest(competitor.id, competitor.version, {
      contributes: {
        cliCommands: [{ id: 'shared', aliases: [] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    }));
    winner.registrar.command('cli', { id: 'shared', description: 'winner', run: async () => ({ exitCode: 0 }) });
    winner.commit();

    expect(() => first.commit()).toThrow(/duplicate/);
    expect(registry.resolve('cli-command', 'first-only')).toBeUndefined();
    expect(registry.resolve('cli-command', 'shared')?.owner.id).toBe(competitor.id);
  });
});
