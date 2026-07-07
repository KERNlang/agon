import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import type { AgonConfig, EngineDefinition } from '../../packages/core/src/generated/models/types.js';

const envKey = 'AGON_TEST_ENGINE_KEY';
const kimiPathEnvKey = 'KIMI-CODE_PATH';
const tempDirs: string[] = [];
const savedAgonHome = process.env.AGON_HOME;

function makeEngine(id: string, apiKeyEnv = envKey): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'user',
    timeout: 30,
    exec: { args: [] },
    api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv, model: id, format: 'openai' },
  };
}

function makeKimiCodeEngine(overrides: Partial<EngineDefinition> = {}): EngineDefinition {
  return {
    schemaVersion: 3,
    id: 'kimi-code',
    displayName: 'Kimi Code',
    binary: 'kimi',
    searchPaths: [],
    versionCmd: ['--version'],
    isLocal: false,
    tier: 'builtin',
    timeout: 180,
    exec: { args: ['--output-format', 'text', '-p', '{prompt}'] },
    agent: { args: ['--output-format', 'text', '-p', '{prompt}'] },
    companion: { protocol: 'acp', serverCmd: ['acp'] },
    test: { args: ['--version'] },
    ...overrides,
  } as EngineDefinition;
}

function makeConfig(overrides: Partial<AgonConfig>): Pick<Required<AgonConfig>, 'engineActivationMode'|'forgeEnabledEngines'|'hiddenEngines'|'removedEngines'> {
  return {
    engineActivationMode: 'auto',
    forgeEnabledEngines: [],
    hiddenEngines: [],
    removedEngines: [],
    ...overrides,
  };
}

describe('engine activation', () => {
  afterEach(() => {
    delete process.env[envKey];
    delete process.env[kimiPathEnvKey];
    if (savedAgonHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = savedAgonHome;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves short engine aliases to canonical ids (prefix + substring)', () => {
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('kimi-for-coding-k2p6'));
    registry.register(makeEngine('zai-coding-plan-glm-5.1'));
    registry.register(makeEngine('minimax-coding-plan-minimax-m2.7-highspeed'));

    // exact id is returned unchanged
    expect(registry.resolveId('claude')).toBe('claude');
    // unique prefix match (the user's three buddy engines)
    expect(registry.resolveId('kimi')).toBe('kimi-for-coding-k2p6');
    expect(registry.resolveId('zai')).toBe('zai-coding-plan-glm-5.1');
    expect(registry.resolveId('minimax')).toBe('minimax-coding-plan-minimax-m2.7-highspeed');
    // case-insensitive
    expect(registry.resolveId('KIMI')).toBe('kimi-for-coding-k2p6');
    // and get() transparently resolves the alias
    expect(registry.get('kimi').id).toBe('kimi-for-coding-k2p6');
  });

  it('leaves ambiguous or unknown aliases unchanged so the caller fails loudly', () => {
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude-opus'));
    registry.register(makeEngine('claude-sonnet'));

    // ambiguous prefix → return input unchanged (no silent wrong guess)
    expect(registry.resolveId('claude')).toBe('claude');
    expect(() => registry.get('claude')).toThrow(/not found/);
    // unknown → unchanged
    expect(registry.resolveId('nonexistent')).toBe('nonexistent');
  });

  it('keeps auto mode broad and explicit mode limited to selected engines', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('api-sonnet'));

    expect(registry.activeIds(makeConfig({ engineActivationMode: 'auto' }))).toEqual([
      'claude',
      'codex',
      'api-sonnet',
    ]);
    expect(registry.activeIds(makeConfig({ engineActivationMode: 'explicit', forgeEnabledEngines: ['api-sonnet'] }))).toEqual([
      'api-sonnet',
    ]);
  });

  it('preserves explicit engine order and ignores unknown configured ids', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('api-sonnet'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['api-sonnet', 'missing-engine', 'codex'],
    }))).toEqual(['api-sonnet', 'codex']);
  });

  it('dedupes duplicate explicit engine ids without changing first-seen order', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('kimi'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['codex', 'kimi', 'codex', 'claude', 'kimi'],
    }))).toEqual(['codex', 'kimi', 'claude']);
  });

  it('resolves explicit engine aliases before matching active engines', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('kimi-for-coding'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi', 'claude'],
    }))).toEqual(['kimi-for-coding', 'claude']);
  });

  it('returns no engines for an empty explicit engine list', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: [],
    }))).toEqual([]);
  });

  it('drops explicit aliases that resolve to unavailable engines', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('kimi-for-coding', 'AGON_TEST_MISSING_ENGINE_KEY'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi', 'claude'],
    }))).toEqual(['claude']);
  });

  it('resolves hidden and removed aliases before filtering active engines', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('kimi-for-coding'));
    registry.register(makeEngine('codex'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi', 'claude', 'codex'],
      hiddenEngines: ['kimi'],
      removedEngines: ['cod'],
    }))).toEqual(['claude']);
  });

  it('expands ambiguous hidden and removed aliases so filters fail closed', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('kimi-for-coding'));
    registry.register(makeEngine('kimi-other', 'AGON_TEST_MISSING_ENGINE_KEY'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi', 'claude'],
      hiddenEngines: ['kimi'],
    }))).toEqual(['claude']);
  });

  it('resolves explicit aliases against available engines, not unavailable registry entries', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('kimi-for-coding'));
    registry.register(makeEngine('kimi-other', 'AGON_TEST_MISSING_ENGINE_KEY'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi'],
    }))).toEqual(['kimi-for-coding']);
  });

  it('drops ambiguous explicit config aliases when multiple available engines match', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('kimi-for-coding'));
    registry.register(makeEngine('kimi-other'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['kimi'],
    }))).toEqual([]);
  });

  it('removes hidden engines from auto and explicit routing', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('gemini'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'auto',
      hiddenEngines: ['codex'],
    }))).toEqual(['claude', 'gemini']);

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['claude', 'codex'],
      hiddenEngines: ['codex'],
    }))).toEqual(['claude']);
  });

  it('removes hard-removed engines from auto and explicit routing', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('gemini'));

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'auto',
      removedEngines: ['codex'],
    }))).toEqual(['claude', 'gemini']);

    expect(registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['claude', 'codex'],
      removedEngines: ['codex'],
    }))).toEqual(['claude']);
  });

  it('partitionRoster hard-blocks removed engines but still honors hidden ones on explicit requests', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('gemini'));

    // Explicit -e list: a HIDDEN engine (soft) is still honored, a REMOVED
    // engine (hard) is split into `removed` so the caller can fail loudly.
    const part = registry.partitionRoster(['claude', 'codex', 'gemini'], makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['claude'],
      hiddenEngines: ['codex'],
      removedEngines: ['gemini'],
    }));
    expect(part.active).toEqual(['claude', 'codex']);
    expect(part.removed).toEqual(['gemini']);

    // De-dupes and resolves aliases; an unknown id is dropped, not crashed.
    const dedup = registry.partitionRoster(['claude', 'claude', 'gemini', 'gemini'], makeConfig({
      removedEngines: ['gemini'],
    }));
    expect(dedup.active).toEqual(['claude']);
    expect(dedup.removed).toEqual(['gemini']);

    const aliasedRemoved = registry.partitionRoster(['gemini'], makeConfig({
      removedEngines: ['gem'],
    }));
    expect(aliasedRemoved.active).toEqual([]);
    expect(aliasedRemoved.removed).toEqual(['gemini']);

    registry.register(makeEngine('gemma', 'AGON_TEST_MISSING_ENGINE_KEY'));
    const ambiguousRemoved = registry.partitionRoster(['gemini'], makeConfig({
      removedEngines: ['gem'],
    }));
    expect(ambiguousRemoved.active).toEqual([]);
    expect(ambiguousRemoved.removed).toEqual(['gemini']);

    const removedAliasRequest = registry.partitionRoster(['gem'], makeConfig({
      removedEngines: ['gem'],
    }));
    expect(removedAliasRequest.active).toEqual([]);
    expect(removedAliasRequest.removed).toEqual(['gemini']);

    const aliasWithUnavailableSibling = registry.partitionRoster(['gem'], makeConfig({
      removedEngines: [],
    }));
    expect(aliasWithUnavailableSibling.active).toEqual(['gemini']);
    expect(aliasWithUnavailableSibling.removed).toEqual([]);

    const removedUnavailableSibling = registry.partitionRoster(['gem'], makeConfig({
      removedEngines: ['gemma'],
    }));
    expect(removedUnavailableSibling.active).toEqual(['gemini']);
    expect(removedUnavailableSibling.removed).toEqual([]);

    // null request → the automatic roster (which already excludes hidden +
    // removed), with an empty removed list.
    const auto = registry.partitionRoster(null, makeConfig({
      engineActivationMode: 'auto',
      hiddenEngines: ['codex'],
      removedEngines: ['gemini'],
    }));
    expect(auto.active).toEqual(['claude']);
    expect(auto.removed).toEqual([]);
  });

  it('reports canonical removed ids for ambiguous removed aliases', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('gemini'));
    registry.register(makeEngine('gemma'));

    const part = registry.partitionRoster(['gem'], makeConfig({
      removedEngines: ['gemma'],
    }));
    expect(part.active).toEqual([]);
    expect(part.removed).toEqual(['gemma']);
  });

  it('partitionRoster falls back to registered aliases and dedupes canonical ids', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('kimi-for-coding', 'AGON_TEST_MISSING_ENGINE_KEY'));
    registry.register(makeEngine('claude'));

    const unavailableAlias = registry.partitionRoster(['kimi'], makeConfig({}));
    expect(unavailableAlias.active).toEqual(['kimi-for-coding']);
    expect(unavailableAlias.removed).toEqual([]);

    const mixed = registry.partitionRoster(['claude', 'claude'], makeConfig({}));
    expect(mixed.active).toEqual(['claude']);
    expect(mixed.removed).toEqual([]);
  });

  it('restricts fallback candidates to the active engine list', () => {
    process.env[envKey] = 'test';
    const registry = new EngineRegistry();
    registry.register(makeEngine('claude'));
    registry.register(makeEngine('codex'));
    registry.register(makeEngine('api-sonnet'));

    const active = registry.activeIds(makeConfig({
      engineActivationMode: 'explicit',
      forgeEnabledEngines: ['codex', 'api-sonnet'],
    }));

    expect(registry.getFallbackChain('api-sonnet', 'bugfix', active)).toEqual(['codex']);
    expect(registry.getFallbackChain('api-sonnet', 'bugfix', active)).not.toContain('claude');
  });

  it("findBinary falls back to node's own bin dir when which fails and searchPaths miss (stripped-PATH native host / cron)", () => {
    // The running node binary is the one file guaranteed to exist in dirname(process.execPath).
    const engine = makeKimiCodeEngine({ id: 'stripped-env-probe', binary: basename(process.execPath), searchPaths: [] });
    const registry = new EngineRegistry();
    registry.register(engine);

    const prevPath = process.env.PATH;
    process.env.PATH = ''; // simulate Chrome's/launchd's stripped environment — `which` can't help
    try {
      expect(registry.findBinary(registry.get('stripped-env-probe'))).toBe(join(dirname(process.execPath), basename(process.execPath)));
    } finally {
      if (prevPath === undefined) delete process.env.PATH; else process.env.PATH = prevPath;
    }
  });

  it('keeps kimi-code active by default when the kimi binary is discoverable', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'agon-kimi-bin-'));
    tempDirs.push(binDir);
    const kimiPath = join(binDir, 'kimi');
    writeFileSync(kimiPath, '#!/bin/sh\n');
    process.env[kimiPathEnvKey] = kimiPath;

    const registry = new EngineRegistry();
    registry.register(makeKimiCodeEngine());

    expect(registry.resolveId('kimi-code')).toBe('kimi-code');
    expect(registry.findBinary(registry.get('kimi-code'))).toBe(kimiPath);
    expect(registry.activeIds(makeConfig({ engineActivationMode: 'auto' }))).toEqual(['kimi-code']);
  });

  it('allows user engine files to override builtin kimi-code by exact id', () => {
    const builtinDir = mkdtempSync(join(tmpdir(), 'agon-kimi-builtin-'));
    const agonHome = mkdtempSync(join(tmpdir(), 'agon-kimi-home-'));
    tempDirs.push(builtinDir, agonHome);
    const userDir = join(agonHome, 'engines');
    mkdirSync(userDir, { recursive: true });
    process.env.AGON_HOME = agonHome;

    writeFileSync(
      join(builtinDir, 'kimi-code.json'),
      JSON.stringify(makeKimiCodeEngine({ displayName: 'Builtin Kimi Code', tier: 'builtin' }), null, 2),
    );
    writeFileSync(
      join(userDir, 'kimi-code.json'),
      JSON.stringify(makeKimiCodeEngine({ displayName: 'User Kimi Code', tier: 'user', timeout: 45 }), null, 2),
    );

    const registry = new EngineRegistry();
    registry.load(builtinDir);

    expect(registry.get('kimi-code').displayName).toBe('User Kimi Code');
    expect(registry.get('kimi-code').tier).toBe('user');
    expect(registry.get('kimi-code').timeout).toBe(45);
  });
});
