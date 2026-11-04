import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import * as runtime from '../../packages/support-engine-runtime/src/index.js';
import type { EngineSettings } from '../../packages/support-engine-runtime/src/index.js';
import type { AgonConfig } from '../../packages/core/src/models/types.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

vi.mock('@kernlang/agon-support-engine-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-support-engine-runtime')>();
  return { ...actual, normalizeEngineSettings: vi.fn(actual.normalizeEngineSettings) };
});

// Frozen normalization from fb77dc97, before the policy owner moved.
function legacyNormalize(settings: any): void {
  if (!Array.isArray(settings.forgeEnabledEngines)) settings.forgeEnabledEngines = [];
  if (!Array.isArray(settings.hiddenEngines)) settings.hiddenEngines = [];
  if (!Array.isArray(settings.removedEngines)) settings.removedEngines = [];
  if (!['auto', 'explicit'].includes(String(settings.engineActivationMode))) settings.engineActivationMode = 'auto';
  if (!settings.engineModels || typeof settings.engineModels === 'string') settings.engineModels = {};
}

describe('physical engine settings owner', () => {
  it('provides the existing engine defaults from the assigned support package', () => {
    expect(runtime.DEFAULT_ENGINE_SETTINGS).toEqual({
      forgeDispatchTimeout: 480,
      reviewDefaultEngine: '',
      engineActivationMode: 'auto',
      forgeEnabledEngines: ['claude', 'codex', 'agy'],
      forgeJudgeEngine: '',
      cesarEngine: 'claude',
      hiddenEngines: [],
      removedEngines: [],
      engineModels: {},
      engineEfforts: {},
      engineIsolation: 'workspace-pure',
      ratingsPurgeKeepEngines: [],
      commitCoAuthor: 'agon (KERN) <292465531+KERN-Agon@users.noreply.github.com>',
    });
  });

  it('owns exactly the ledger keys with unchanged optional and required types', () => {
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    const keys = ledger.assignments.filter((entry: { category: string; package: string }) =>
      entry.category === 'configKeys' && entry.package === '@kernlang/agon-support-engine-runtime'
    ).map((entry: { id: string }) => entry.id).sort();
    expect(Object.keys(runtime.DEFAULT_ENGINE_SETTINGS).sort()).toEqual(keys);
    expectTypeOf<Pick<AgonConfig, keyof EngineSettings>>().toEqualTypeOf<EngineSettings>();
  });

  it('matches the old policy on valid and malformed settings without coercing other fields', () => {
    const values = [undefined, null, false, true, 0, 42, '', 'auto', 'explicit', 'invalid', [], ['engine'], {}, { engine: 'model' }];
    for (const value of values) {
      const input = {
        forgeEnabledEngines: value, hiddenEngines: value, removedEngines: value,
        engineActivationMode: value, engineModels: value,
        engineEfforts: value, engineIsolation: value, extra: 'retained',
      };
      const before = structuredClone(input);
      const after = structuredClone(input);
      legacyNormalize(before);
      runtime.normalizeEngineSettings(after as unknown as EngineSettings);
      expect(after).toEqual(before);
    }
  });

  it('uses the physical defaults and policy through Core without changing its public API', async () => {
    const home = setupTestAgonHome('engine-settings-owner');
    try {
      const owner = await import('@kernlang/agon-support-engine-runtime');
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/models/types.js');
      for (const [key, value] of Object.entries(owner.DEFAULT_ENGINE_SETTINGS)) {
        expect(DEFAULT_AGON_CONFIG[key as keyof EngineSettings]).toBe(value);
      }
      writeFileSync(agonHomePath('config.json'), JSON.stringify({
        forgeEnabledEngines: 'wrong', hiddenEngines: null, removedEngines: false,
        engineModels: 'wrong', engineActivationMode: 'wrong',
      }));
      const { loadConfig } = await import('../../packages/core/src/signals/config.js');
      const config = loadConfig();
      expect(owner.normalizeEngineSettings).toHaveBeenCalledTimes(1);
      expect(config.forgeEnabledEngines).toEqual([]);
      expect(config.hiddenEngines).toEqual([]);
      expect(config.removedEngines).toEqual([]);
      expect(config.engineModels).toEqual({});
      expect(config.engineActivationMode).toBe('auto');
    } finally { cleanupTestAgonHome(home); }
  });
});
