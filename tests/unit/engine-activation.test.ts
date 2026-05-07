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

function makeConfig(overrides: Partial<AgonConfig>): Pick<Required<AgonConfig>, 'engineActivationMode'|'forgeEnabledEngines'|'hiddenEngines'> {
  return {
    engineActivationMode: 'auto',
    forgeEnabledEngines: [],
    hiddenEngines: [],
    ...overrides,
  };
}

describe('engine activation', () => {
  afterEach(() => {
    delete process.env[envKey];
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
