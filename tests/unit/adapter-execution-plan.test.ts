import { describe, expect, it } from 'vitest';

import { safeAgentVisibleText, StreamParser } from '@kernlang/agon-core';
import type { DispatchOptions, EngineDefinition } from '@kernlang/agon-core';
import {
  buildApiDispatchConfig,
  encodeAgentStreamText,
  normalizeDispatchOptions,
  normalizeApiAgentOutcome,
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
  it('encodes narration as a parser-compatible transient status', () => {
    const parser = new StreamParser();
    expect(parser.feed(encodeAgentStreamText('Inspecting safely.', 'narration'))).toEqual([
      { type: 'status', content: 'Inspecting safely.' },
    ]);
  });

  it('encodes final prose as parser-compatible assistant text', () => {
    const parser = new StreamParser();
    expect(parser.feed(encodeAgentStreamText('Done.', 'final'))).toEqual([
      { type: 'text', content: 'Done.' },
    ]);
  });

  it.each([
    'prefix <tool_ca',
    'prefix <invoke name="Read">truncated provider wrapper',
    'prefix <antml:function_call>truncated provider wrapper',
  ])('fails closed for provider-specific tool markup: %s', (text) => {
    expect(safeAgentVisibleText(text)).toBe('');
  });

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

  it('normalizes a successful API agent result without inventing an error', () => {
    expect(normalizeApiAgentOutcome({ response: 'done', toolCalls: 2, steps: 3 })).toEqual({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      timedOut: false,
    });
  });

  it('turns a missing API agent result into a truthful failure', () => {
    expect(normalizeApiAgentOutcome(undefined)).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'API agent returned no terminal result',
      timedOut: false,
      engineFault: true,
    });
  });

  it('preserves partial API agent output while surfacing an execution failure', () => {
    expect(normalizeApiAgentOutcome({
      response: 'partial work',
      toolCalls: 1,
      steps: 2,
      failed: true,
      errorReason: 'upstream stream closed',
      engineFault: true,
    })).toEqual({
      exitCode: 1,
      stdout: 'partial work',
      stderr: 'upstream stream closed',
      timedOut: false,
      engineFault: true,
    });
  });

  it('gives cancellation precedence over a generic failure', () => {
    expect(normalizeApiAgentOutcome({
      response: 'Error: aborted',
      toolCalls: 0,
      steps: 1,
      failed: true,
      cancelled: true,
      errorReason: 'aborted by caller',
    })).toEqual({
      exitCode: 130,
      stdout: 'Error: aborted',
      stderr: 'aborted by caller',
      timedOut: false,
    });
  });

  it('normalizes an API agent deadline as a timeout', () => {
    expect(normalizeApiAgentOutcome({
      response: 'partial before timeout',
      toolCalls: 4,
      steps: 5,
      failed: true,
      timedOut: true,
      errorReason: 'API agent deadline exceeded',
    })).toEqual({
      exitCode: 124,
      stdout: 'partial before timeout',
      stderr: 'API agent deadline exceeded',
      timedOut: true,
    });
  });
});
