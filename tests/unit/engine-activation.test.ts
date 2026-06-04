import { describe, expect, it, afterEach } from 'vitest';
import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import type { AgonConfig, EngineDefinition } from '../../packages/core/src/generated/models/types.js';

const envKey = 'AGON_TEST_ENGINE_KEY';

function makeEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'user',
    timeout: 30,
    exec: { args: [] },
    api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: envKey, model: id, format: 'openai' },
  };
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
});
