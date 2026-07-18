import { describe, expect, it } from 'vitest';

import { validateEngineConfig } from './engine-schema.js';

const completeEngine = {
  schemaVersion: 3,
  id: 'complete-engine',
  displayName: 'Complete Engine',
  binary: 'complete',
  isLocal: false,
  tier: 'user',
  timeout: 180,
  exec: { args: ['run', '{prompt}'] },
  effort: {
    configKey: 'reasoning_effort',
    levels: ['low', 'high'],
    default: 'high',
  },
  family: 'complete-family',
  derivedFrom: 'complete-engine-v1',
  modes: ['exec', 'agent'],
  adapterType: 'cli',
  cliModels: {
    default: 'complete-model',
    list: [{ id: 'complete-model', name: 'Complete Model' }],
    dynamicListCmd: ['models', '--json'],
  },
  api: {
    baseUrl: 'https://example.com/v1',
    apiKeyEnv: 'COMPLETE_API_KEY',
    model: 'complete-model',
    maxTokens: 8192,
    contextWindow: 200_000,
    format: 'openai',
    firstChunkTimeoutMs: 45_000,
    idleTimeoutMs: 120_000,
    firstChunkRetryCount: 2,
    firstChunkRetryBackoffMs: 1_500,
    emptyResponseRetryCount: 4,
  },
} as const;

describe('EngineDefinitionSchema execution metadata', () => {
  it('retains every supported engine and API execution field', () => {
    const result = validateEngineConfig(completeEngine, 'complete-engine.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.effort).toEqual(completeEngine.effort);
    expect(result.data.family).toBe(completeEngine.family);
    expect(result.data.derivedFrom).toBe(completeEngine.derivedFrom);
    expect(result.data.modes).toEqual(completeEngine.modes);
    expect(result.data.adapterType).toBe(completeEngine.adapterType);
    expect(result.data.cliModels).toEqual(completeEngine.cliModels);
    expect(result.data.api).toEqual(completeEngine.api);
  });

  it.each([
    ['contextWindow', 0],
    ['contextWindow', 1.5],
    ['firstChunkTimeoutMs', 0],
    ['firstChunkTimeoutMs', 1.5],
    ['idleTimeoutMs', -1],
    ['firstChunkRetryCount', -1],
    ['firstChunkRetryCount', 1.5],
    ['firstChunkRetryBackoffMs', -1],
    ['emptyResponseRetryCount', -1],
    ['emptyResponseRetryCount', 1.5],
  ])('rejects invalid api.%s values', (field, value) => {
    const result = validateEngineConfig({
      ...completeEngine,
      api: { ...completeEngine.api, [field]: value },
    }, 'invalid-api.json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`api.${field}`);
  });

  it.each(['apiKeyEnv', 'model'])('rejects an empty api.%s identifier', (field) => {
    const result = validateEngineConfig({
      ...completeEngine,
      api: { ...completeEngine.api, [field]: '' },
    }, 'invalid-api.json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`api.${field}`);
  });

  it('rejects an effort default outside the declared levels', () => {
    const result = validateEngineConfig({
      ...completeEngine,
      effort: { ...completeEngine.effort, default: 'medium' },
    }, 'invalid-effort.json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('effort.default');
  });

  it('rejects an effort block with no dispatch mechanism', () => {
    const result = validateEngineConfig({
      ...completeEngine,
      effort: { levels: ['low', 'high'], default: 'high' },
    }, 'invalid-effort.json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('effort.flag');
  });

  it.each([
    [{}, 'cliModels.list'],
    [{ list: [] }, 'cliModels.list'],
    [{ default: 'missing', list: [{ id: 'present' }] }, 'cliModels.default'],
    [{ dynamicListCmd: ['models', ''] }, 'cliModels.dynamicListCmd'],
    [{ dynamicListCmd: ['   '] }, 'cliModels.dynamicListCmd'],
  ])('rejects an unusable static cliModels config', (cliModels, errorPath) => {
    const result = validateEngineConfig({ ...completeEngine, cliModels }, 'invalid-cli-models.json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(errorPath);
  });

  it('allows a dynamic model probe to resolve a default outside its static fallback', () => {
    const result = validateEngineConfig({
      ...completeEngine,
      cliModels: {
        default: 'dynamic-model',
        list: [{ id: 'fallback-model' }],
        dynamicListCmd: ['models', '--json'],
      },
    }, 'dynamic-cli-models.json');

    expect(result.ok).toBe(true);
  });
});
