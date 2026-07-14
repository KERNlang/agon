import { describe, expect, it } from 'vitest';

import type { DispatchOptions, EngineDefinition } from '@kernlang/agon-core';
import {
  buildApiDispatchConfig,
  normalizeDispatchOptions,
  planEngineExecution,
} from '../../packages/adapter-cli/src/generated/execution-plan.js';

const API = {
  baseUrl: 'https://example.com/v1',
  apiKeyEnv: 'PLANNER_API_KEY',
  model: 'configured-model',
  maxTokens: 4096,
  contextWindow: 200_000,
  format: 'openai' as const,
  firstChunkTimeoutMs: 45_000,
  idleTimeoutMs: 120_000,
  firstChunkRetryCount: 2,
  firstChunkRetryBackoffMs: 1_500,
};

function engine(overrides: Partial<EngineDefinition> = {}): EngineDefinition {
  return {
    schemaVersion: 3,
    id: 'planner-engine',
    displayName: 'Planner Engine',
    binary: 'planner-cli',
    isLocal: false,
    tier: 'user',
    timeout: 300,
    exec: { args: ['run', '{prompt}'] },
    api: API,
    ...overrides,
  } as EngineDefinition;
}

function options(overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  return {
    engine: engine(),
    prompt: 'hello',
    cwd: '/tmp/planner',
    mode: 'exec',
    timeout: 120,
    outputDir: '/tmp/planner-output',
    ...overrides,
  } as DispatchOptions;
}

describe('execution planner', () => {
  it('raises the dispatch timeout to the engine floor without mutating the caller', () => {
    const input = options();
    const normalized = normalizeDispatchOptions(input);

    expect(normalized).not.toBe(input);
    expect(normalized.timeout).toBe(300);
    expect(input.timeout).toBe(120);
  });

  it('keeps the caller object when its timeout already satisfies the engine floor', () => {
    const input = options({ timeout: 450 });
    expect(normalizeDispatchOptions(input)).toBe(input);
  });

  it.each([
    ['/usr/local/bin/planner-cli', true, 'cli'],
    ['/usr/local/bin/planner-cli', false, 'cli'],
    [null, true, 'api'],
    [null, false, 'missing'],
  ] as const)('selects %s/key=%s as %s', (binaryPath, apiKeyAvailable, backend) => {
    const plan = planEngineExecution(options(), binaryPath, apiKeyAvailable, 'resolved-model');

    expect(plan.backend).toBe(backend);
    expect(plan.binaryPath).toBe(binaryPath);
  });

  it('selects API for an API-only engine with a usable key', () => {
    const input = options({ engine: engine({ binary: undefined }) });
    expect(planEngineExecution(input, null, true, null).backend).toBe('api');
  });

  it('does not select API when an engine has no API definition', () => {
    const input = options({ engine: engine({ api: undefined }) });
    expect(planEngineExecution(input, null, true, null).backend).toBe('missing');
  });

  it('retains advanced API configuration while applying per-dispatch overrides', () => {
    const config = buildApiDispatchConfig(engine(), 'resolved-model', 16_384);

    expect(config).toEqual({
      ...API,
      model: 'resolved-model',
      maxTokens: 16_384,
    });
  });

  it('keeps configured model/token values when no override is supplied', () => {
    const config = buildApiDispatchConfig(engine(), null, undefined);
    expect(config).toEqual(API);
  });

  it('carries normalized options and API config in one plan', () => {
    const input = options({ maxTokens: 12_000 });
    const plan = planEngineExecution(input, null, true, 'resolved-model');

    expect(plan.options.timeout).toBe(300);
    expect(plan.apiConfig).toEqual({ ...API, model: 'resolved-model', maxTokens: 12_000 });
    expect(input.timeout).toBe(120);
  });
});
