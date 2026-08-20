import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const chatModelMock = vi.hoisted(() => vi.fn((model: string) => ({ id: model })));
const createOpenAICompatibleMock = vi.hoisted(() => vi.fn(() => ({ chatModel: chatModelMock })));

vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: createOpenAICompatibleMock }));

import { buildModel, _modelCache } from '../../packages/core/src/api/dispatch.js';
import type { ApiConfig } from '../../packages/core/src/api/dispatch.js';

// The model cache is keyed by baseUrl|model|format but validated against the
// API KEY: a cached model built with a stale key must be rebuilt, and a cached
// model built with the SAME key must be reused. Inverting that check either
// hands back a model authenticated with a revoked key (401 loop after `agon
// login --force`) or rebuilds a provider on every dispatch.

const KEY_ENV = 'AGON_TEST_MODEL_CACHE_KEY';

function config(baseUrl: string): ApiConfig {
  return { baseUrl, apiKeyEnv: KEY_ENV, model: 'test-model' };
}

beforeEach(() => {
  _modelCache.clear();
  createOpenAICompatibleMock.mockClear();
  chatModelMock.mockClear();
});

afterEach(() => {
  delete process.env[KEY_ENV];
  _modelCache.clear();
});

describe('buildModel provider cache', () => {
  it('returns null without an API key', () => {
    delete process.env[KEY_ENV];
    expect(buildModel(config('https://one.test/v1'))).toBeNull();
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it('reuses the cached model while the API key is unchanged', () => {
    process.env[KEY_ENV] = 'sk-first';
    const cfg = config('https://two.test/v1');
    const first = buildModel(cfg);
    const second = buildModel(cfg);

    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('rebuilds with the NEW key when the API key rotates', () => {
    process.env[KEY_ENV] = 'sk-first';
    const cfg = config('https://three.test/v1');
    buildModel(cfg);
    expect(createOpenAICompatibleMock).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-first' }));

    process.env[KEY_ENV] = 'sk-rotated';
    buildModel(cfg);

    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(2);
    expect(createOpenAICompatibleMock).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-rotated' }));
  });

  it('keys the cache by baseUrl + model + format', () => {
    process.env[KEY_ENV] = 'sk-first';
    buildModel(config('https://four.test/v1'));
    buildModel(config('https://five.test/v1'));
    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(2);
    expect(_modelCache.size).toBe(2);
  });
});
