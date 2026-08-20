import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const chatModelMock = vi.hoisted(() => vi.fn((model: string) => ({ id: model })));
const createOpenAICompatibleMock = vi.hoisted(() => vi.fn(() => ({ chatModel: chatModelMock })));
const anthropicModelMock = vi.hoisted(() => vi.fn((model: string) => ({ anthropic: model })));
const createAnthropicMock = vi.hoisted(() => vi.fn(() => anthropicModelMock));

vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: createOpenAICompatibleMock }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: createAnthropicMock }));

import { buildModel, _modelCache } from '../../packages/core/src/api/dispatch.js';
import type { ApiConfig } from '../../packages/core/src/api/dispatch.js';

// The model cache is keyed by baseUrl|model|format but validated against the
// API KEY: a cached model built with a stale key must be rebuilt, and a cached
// model built with the SAME key must be reused. Inverting that check either
// hands back a model authenticated with a revoked key (401 loop after `agon
// login --force`) or rebuilds a provider on every dispatch.

const KEY_ENV = 'AGON_TEST_MODEL_CACHE_KEY';

function config(baseUrl: string, overrides?: Partial<ApiConfig>): ApiConfig {
  return { baseUrl, apiKeyEnv: KEY_ENV, model: 'test-model', ...overrides };
}

/** Total provider constructions across BOTH provider factories. */
function providerBuilds(): number {
  return createOpenAICompatibleMock.mock.calls.length + createAnthropicMock.mock.calls.length;
}

beforeEach(() => {
  _modelCache.clear();
  createOpenAICompatibleMock.mockClear();
  createAnthropicMock.mockClear();
  chatModelMock.mockClear();
  anthropicModelMock.mockClear();
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

  it('keys the cache by baseUrl — a different host is a different entry', () => {
    process.env[KEY_ENV] = 'sk-first';
    const a = buildModel(config('https://four.test/v1'));
    const b = buildModel(config('https://five.test/v1'));
    expect(providerBuilds()).toBe(2);
    expect(_modelCache.size).toBe(2);
    expect(b).not.toBe(a);
  });

  it('keys the cache by MODEL — same host, different model is a different entry', () => {
    process.env[KEY_ENV] = 'sk-first';
    const base = 'https://six.test/v1';
    const a = buildModel(config(base, { model: 'small' }));
    const b = buildModel(config(base, { model: 'large' }));
    expect(providerBuilds()).toBe(2);
    expect(_modelCache.size).toBe(2);
    expect(b).not.toBe(a);
    expect(chatModelMock.mock.calls.map((c) => c[0])).toEqual(['small', 'large']);
    // …and each of those is independently cached.
    expect(buildModel(config(base, { model: 'small' }))).toBe(a);
    expect(buildModel(config(base, { model: 'large' }))).toBe(b);
    expect(providerBuilds()).toBe(2);
  });

  it('keys the cache by FORMAT — same host and model, different wire format', () => {
    process.env[KEY_ENV] = 'sk-first';
    const base = 'https://seven.test/v1';
    const openai = buildModel(config(base, { format: 'openai' }));
    const anthropic = buildModel(config(base, { format: 'anthropic' }));

    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    expect(createAnthropicMock).toHaveBeenCalledTimes(1);
    expect(_modelCache.size).toBe(2);
    expect(anthropic).not.toBe(openai);
    expect(anthropic).toEqual({ anthropic: 'test-model' });
    // Both stay cached independently.
    expect(buildModel(config(base, { format: 'openai' }))).toBe(openai);
    expect(buildModel(config(base, { format: 'anthropic' }))).toBe(anthropic);
    expect(providerBuilds()).toBe(2);
  });

  it('treats an omitted format as "openai" — same cache entry, no rebuild', () => {
    process.env[KEY_ENV] = 'sk-first';
    const base = 'https://eight.test/v1';
    const implicit = buildModel(config(base));
    const explicit = buildModel(config(base, { format: 'openai' }));
    expect(explicit).toBe(implicit);
    expect(providerBuilds()).toBe(1);
    expect(_modelCache.size).toBe(1);
  });

  it('invalidates every key variant on an API-key rotation', () => {
    process.env[KEY_ENV] = 'sk-first';
    const base = 'https://nine.test/v1';
    buildModel(config(base, { model: 'small' }));
    buildModel(config(base, { model: 'large' }));
    expect(providerBuilds()).toBe(2);

    process.env[KEY_ENV] = 'sk-rotated';
    buildModel(config(base, { model: 'small' }));
    buildModel(config(base, { model: 'large' }));
    expect(providerBuilds()).toBe(4);
    for (const call of createOpenAICompatibleMock.mock.calls.slice(2)) {
      expect(call[0]).toEqual(expect.objectContaining({ apiKey: 'sk-rotated' }));
    }
  });
});
