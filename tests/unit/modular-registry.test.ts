import { describe, expect, it, vi } from 'vitest';
import { ModRegistry, RegistryInvariantError } from '../../packages/mod-kernel/src/index.js';
import type { LegacyRegistryEntry } from '../../packages/mod-kernel/src/index.js';
import type { CommandContribution, InvocationContext, ModIdentity } from '../../packages/mod-api/src/index.js';
import { manifest } from '../helpers/modular-agon.js';
import { resolveRegisteredModSettings } from '../../packages/mod-kernel/src/mod-settings.js';

const hash = `sha256:${'a'.repeat(64)}` as const;
const active: ModIdentity = { id: 'example.active', version: '1.0.0', contentHash: hash };
const disabled: ModIdentity = { id: 'example.disabled', version: '1.0.0', contentHash: hash };
const competitor: ModIdentity = { id: 'example.competitor', version: '1.0.0', contentHash: hash };

describe('owner-tagged ModRegistry', () => {
  it.each(['cli-command', 'tui-action', 'intent', 'mcp-tool', 'cesar-tool', 'plan-step'] as const)(
    'enforces only the owner schema for %s and rejects retained handles after disposal', async kind => {
      const registry = new ModRegistry({ generation: 'settings:kinds', activeOwners: [active, competitor] });
      const declaration = kind === 'cli-command' ? 'cliCommands' : kind === 'mcp-tool' ? 'mcpTools'
        : kind === 'cesar-tool' || kind === 'plan-step' ? 'cesarTools' : 'tuiActions';
      const session = registry.beginRegistration(manifest(active.id, active.version, { contributes: {
        cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [],
        configKeys: [{ id: active.id, aliases: [] }], generatedDocs: [], [declaration]: [{ id: 'configured', aliases: [] }],
      } }));
      const run = vi.fn((_input, context) => ({ exitCode: 0, result: context.config }));
      const contribution = { id: 'configured', description: 'fixture', inputSchema: { type: 'object' }, run };
      if (kind === 'cli-command' || kind === 'tui-action') session.registrar.command(kind === 'cli-command' ? 'cli' : 'tui', contribution);
      else if (kind === 'intent') session.registrar.intent({ ...contribution, parse: () => ({}) });
      else if (kind === 'plan-step') session.registrar.planStep({ ...contribution, resultSchema: { type: 'object' }, risk: 'read' });
      else session.registrar.tool(kind === 'mcp-tool' ? 'mcp' : 'cesar', { ...contribution, effect: 'read' });
      session.registrar.config(active.id, { type: 'object', properties: { count: { type: 'integer', default: 2 } } });
      session.commit();
      const other = registry.beginRegistration(manifest(competitor.id, competitor.version, { contributes: {
        cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [],
        configKeys: [{ id: competitor.id, aliases: [] }], generatedDocs: [],
      } }));
      other.registrar.config(competitor.id, { type: 'object', required: ['otherOwnerOnly'] });
      other.commit();
      const captured = registry.resolve(kind, 'configured')!.payload as CommandContribution;
      const context: InvocationContext = { invocationId: 'kinds', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
      expect(captured.run({}, context)).toEqual({ exitCode: 0, result: { count: 2 } });
      expect(() => captured.run({}, { ...context, config: { count: 'invalid' } })).toThrow(/mod settings/);
      expect(run).toHaveBeenCalledTimes(1);
      await registry.disposeOwner(active.id);
      expect(() => captured.run({}, context)).toThrow(/unavailable/);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it('combines disjoint nested defaults and rejects only conflicting leaves in either order', () => {
    const schema = (key: string, value: number) => ({ type: 'object', properties: {
      nested: { type: 'object', properties: { [key]: { type: 'integer', default: value } } },
    } });
    const first = schema('a', 1); const second = schema('b', 2);
    for (const schemas of [[first, second], [second, first]]) {
      expect(resolveRegisteredModSettings(active.id, { nested: {} }, schemas)).toEqual({ nested: { a: 1, b: 2 } });
      expect(resolveRegisteredModSettings(active.id, { nested: { a: 0 } }, schemas)).toEqual({ nested: { a: 0, b: 2 } });
    }
    const conflict = schema('a', 2);
    for (const schemas of [[first, conflict], [conflict, first]]) {
      expect(() => resolveRegisteredModSettings(active.id, { nested: {} }, schemas)).toThrow(/conflicting defaults/);
    }
    const arraySchema = (key: string, value: number) => ({ type: 'object', properties: {
      rows: { type: 'array', items: { type: 'object', properties: { [key]: { type: 'integer', default: value } } } },
    } });
    for (const schemas of [[arraySchema('a', 1), arraySchema('b', 2)], [arraySchema('b', 2), arraySchema('a', 1)]]) {
      expect(resolveRegisteredModSettings(active.id, { rows: [{ a: 0 }, {}] }, schemas))
        .toEqual({ rows: [{ a: 0, b: 2 }, { a: 1, b: 2 }] });
    }
  });

  it('applies defaults within existing additional properties without changing explicit values', () => {
    const schema = { type: 'object', additionalProperties: { type: 'object', required: ['retries'],
      properties: { retries: { type: 'integer', default: 3 } },
    } };
    expect(resolveRegisteredModSettings(active.id, { worker: {}, other: { retries: 0 } }, [schema]))
      .toEqual({ worker: { retries: 3 }, other: { retries: 0 } });
  });

  it('resolves nested defaults, rejects conflicting proposals independently of order, and preserves explicit null', () => {
    const schema = { type: 'object', default: { nested: {} }, properties: {
      nested: { type: 'object', properties: { size: { type: 'integer', default: 2 } } },
      optional: { type: 'null', default: null },
    } };
    expect(resolveRegisteredModSettings(active.id, { optional: null }, [schema])).toEqual({ nested: { size: 2 }, optional: null });
    const first = { type: 'object', properties: { size: { type: 'integer', default: 1 } } };
    const second = { type: 'object', properties: { size: { type: 'integer', default: 2 } } };
    for (const schemas of [[first, second], [second, first]]) {
      expect(() => resolveRegisteredModSettings(active.id, {}, schemas)).toThrow(/conflicting defaults/);
      expect(resolveRegisteredModSettings(active.id, { size: 0 }, schemas)).toEqual({ size: 0 });
    }
    expect(() => resolveRegisteredModSettings(active.id, {}, [{ type: 'object', default: 'wrong' }])).toThrow(/default must be an object/);
  });

  it('keeps command streams lazy and preserves cancellation context', async () => {
    const registry = new ModRegistry({ generation: 'settings:stream', activeOwners: [active] });
    const session = registry.beginRegistration(manifest(active.id, active.version, { contributes: {
      cliCommands: [{ id: 'stream', aliases: [] }], configKeys: [{ id: active.id, aliases: [] }],
      tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], generatedDocs: [],
    } }));
    const signal = new AbortController().signal;
    let started = false;
    session.registrar.command('cli', { id: 'stream', description: 'stream', async *run(_input, context) {
      started = true;
      expect(context.signal).toBe(signal);
      expect(context.invocationId).toBe('stream');
      yield { type: 'text', text: String(context.config.label) };
    } });
    session.registrar.config(active.id, { type: 'object', properties: { label: { type: 'string', default: 'default label' } } });
    session.commit();
    const contribution = registry.resolve('cli-command', 'stream')!.payload as CommandContribution;
    const output = contribution.run({}, { invocationId: 'stream', cwd: '/fixture', platform: 'darwin-arm64', signal, config: {} });
    expect(started).toBe(false);
    const events = [];
    for await (const event of output as AsyncIterable<unknown>) events.push(event);
    expect(events).toEqual([{ type: 'text', text: 'default label' }]);
  });
  it('applies owner schema defaults and rejects invalid settings before execution', async () => {
    const registry = new ModRegistry({ generation: 'settings:1', activeOwners: [active] });
    const session = registry.beginRegistration(manifest(active.id, active.version, { contributes: {
      cliCommands: [{ id: 'configured', aliases: [] }], configKeys: [{ id: active.id, aliases: [] }],
      tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], generatedDocs: [],
    } }));
    const run = vi.fn(async (_input, context) => ({ exitCode: 0, result: context.config }));
    const dispose = session.registrar.command('cli', { id: 'configured', description: 'fixture', run });
    session.registrar.config(active.id, { type: 'object', properties: {
      retries: { type: 'integer', minimum: 0, default: 3 }, enabled: { type: 'boolean', default: true },
    }, additionalProperties: false });
    session.commit();
    const command = registry.resolve('cli-command', 'configured')!.payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'settings', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    expect(await command.run({}, context)).toEqual({ exitCode: 0, result: { retries: 3, enabled: true } });
    expect(context.config).toEqual({});
    expect(Object.isFrozen(run.mock.calls[0][1].config)).toBe(true);
    expect(await command.run({}, { ...context, config: { retries: 0, enabled: false } })).toEqual({ exitCode: 0, result: { retries: 0, enabled: false } });
    run.mockClear();
    expect(() => command.run({}, { ...context, config: { retries: -1 } })).toThrow(/example.active.*config|settings.*example.active/);
    expect(run).not.toHaveBeenCalled();
    await dispose();
    expect(() => command.run({}, context)).toThrow(/unavailable|inactive/);
  });
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
  it("makes a committed contribution unreachable through its registrar disposer", async () => {
    const registry = new ModRegistry({ generation: "fixture:13", activeOwners: [active] });
    const session = registry.beginRegistration(manifest(active.id, active.version, {
      contributes: {
        cliCommands: [{ id: "temporary", aliases: [] }],
        tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
      },
    }));
    const dispose = session.registrar.command("cli", { id: "temporary", run: async () => ({ exitCode: 0 }) });
    session.commit();
    expect(registry.resolve("cli-command", "temporary")).toBeDefined();
    await dispose();
    expect(registry.resolve("cli-command", "temporary")).toBeUndefined();
  });
});
