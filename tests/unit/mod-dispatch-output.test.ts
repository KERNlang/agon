import { describe, expect, it } from 'vitest';
import {
  classifyModEngineFault, cleanEngineText, describeModEngines, modDispatchCeilingSeconds, modDispatchFields, modDispatchMaxTokens, modDispatchTimeoutSeconds, modEngineBackend,
  resolveReviewMaxTokens, resolveReviewMaxWallSeconds, resolveReviewTimeoutSeconds,
} from '../../packages/core/src/blocks/mod-dispatch-output.js';
import { classifyApiFailure } from '../../packages/core/src/api/failure-classify.js';
import { stripReasoning as cliStripReasoning, stripTuiChrome as cliStripTuiChrome } from '../../packages/cli/src/blocks/engine-helpers.js';
import type { DispatchResult, EngineDefinition } from '../../packages/core/src/models/types.js';

const ok: DispatchResult = { exitCode: 0, stdout: 'answer', stderr: '', durationMs: 1, timedOut: false };

describe('mod dispatch engine faults', () => {
  it.each([
    ['timeout', { ...ok, exitCode: 124, timedOut: true, stdout: '' }],
    ['timeout', { ...ok, exitCode: 124, stdout: '' }],
    ['length', { ...ok, finishReason: 'length', stdout: 'partial' }],
    ['empty', { ...ok, stdout: '  <think>only reasoning</think>  ' }],
    ['rate_limit', { ...ok, exitCode: 2, stdout: '', stderr: 'API rate limited (retries exhausted): 429' }],
    ['rate_limit', { ...ok, exitCode: 1, stdout: '', stderr: 'Stream error: 429 Too Many Requests' }],
    ['auth', { ...ok, exitCode: 1, stdout: '', stderr: 'Stream error: 401 Unauthorized' }],
    ['error', { ...ok, exitCode: 1, stdout: '', stderr: 'Stream error: Connection refused' }],
  ] as const)('labels %s', (fault, result) => {
    expect(modDispatchFields(result as DispatchResult).engineFault).toBe(fault);
  });

  it('adds no fault, and keeps finishReason, for a healthy seat', () => {
    expect(modDispatchFields({ ...ok, finishReason: 'stop' })).toEqual({ cleanedText: 'answer', finishReason: 'stop' });
    expect(classifyModEngineFault(ok, 'answer')).toBeUndefined();
  });

  it('reports the output budget the host applied, and only a usable one', () => {
    expect(modDispatchFields(ok, 16384)).toMatchObject({ appliedMaxTokens: 16384 });
    expect(modDispatchFields(ok, 0)).not.toHaveProperty('appliedMaxTokens');
    expect(modDispatchFields(ok, Number.NaN)).not.toHaveProperty('appliedMaxTokens');
  });

  it('applies the configured review timeout only to review dispatches without an explicit timeout', () => {
    expect(modDispatchTimeoutSeconds('review', undefined, { reviewTimeout: 900, agentTimeout: 300 })).toBe(900);
    expect(modDispatchTimeoutSeconds('review', undefined, { agentTimeout: 300 })).toBe(300);
    expect(modDispatchTimeoutSeconds('review', undefined, { reviewTimeout: 0, agentTimeout: 'x' })).toBe(420);
    expect(modDispatchTimeoutSeconds('review', 60, { reviewTimeout: 900 })).toBe(60);
    expect(modDispatchTimeoutSeconds('exec', undefined, { reviewTimeout: 900 })).toBeUndefined();
  });

  it('caps the seat base timeout at an explicit wall-clock deadline for every backend', () => {
    expect(modDispatchTimeoutSeconds('review', undefined, { reviewTimeout: 900 }, 300)).toBe(300);
    expect(modDispatchTimeoutSeconds('review', 60, { reviewTimeout: 900 }, 300)).toBe(60);
    expect(modDispatchTimeoutSeconds('exec', undefined, {}, 300)).toBeUndefined();
    expect(resolveReviewTimeoutSeconds({})).toBe(420);
    expect(modDispatchFields(ok, undefined, 900)).toMatchObject({ appliedTimeoutSeconds: 900 });
    expect(modDispatchFields(ok)).not.toHaveProperty('appliedTimeoutSeconds');
  });

  it('cleans exactly like the legacy review path', () => {
    const raw = '  ✻ Cogitating… <think>plan</think>Real review\n\n\n\nbody  ';
    expect(cleanEngineText(raw)).toBe(cliStripReasoning(cliStripTuiChrome(raw.trim())));
  });
});

describe('mod dispatch review wall-clock ceiling', () => {
  it('defaults to 1800s and honours a positive configured value', () => {
    expect(resolveReviewMaxWallSeconds({})).toBe(1800);
    expect(resolveReviewMaxWallSeconds({ reviewMaxWallSeconds: 2400 })).toBe(2400);
    expect(resolveReviewMaxWallSeconds({ reviewMaxWallSeconds: 0 })).toBe(1800);
  });

  it('applies only to review dispatches on API engines, above the base timeout', () => {
    expect(modDispatchCeilingSeconds('review', 'api', 420, {})).toBe(1800);
    expect(modDispatchCeilingSeconds('review', 'api', 420, { reviewMaxWallSeconds: 2400 })).toBe(2400);
    expect(modDispatchCeilingSeconds('review', 'cli', 420, {})).toBeUndefined();
    expect(modDispatchCeilingSeconds('review', undefined, 420, {})).toBeUndefined();
    expect(modDispatchCeilingSeconds('exec', 'api', 420, {})).toBeUndefined();
    expect(modDispatchCeilingSeconds('review', 'api', 1800, {})).toBeUndefined();
    expect(modDispatchCeilingSeconds('review', 'api', 2000, { reviewMaxWallSeconds: 1000 })).toBeUndefined();
  });

  it('never lets a caller-requested cap exceed the configured ceiling', () => {
    expect(modDispatchCeilingSeconds('review', 'api', 420, {}, 900)).toBe(900);
    expect(modDispatchCeilingSeconds('review', 'api', 420, {}, 5000)).toBe(1800);
    expect(modDispatchCeilingSeconds('review', 'api', 420, {}, 300)).toBeUndefined();
  });

  it('classifies the backend the adapter will use', () => {
    const registry = { findBinary: (engine: EngineDefinition) => (engine.id === 'codex' ? '/usr/bin/codex' : null) };
    expect(modEngineBackend(registry, { id: 'codex', binary: 'codex' } as EngineDefinition)).toBe('cli');
    expect(modEngineBackend(registry, { id: 'kimi', api: { baseUrl: 'x' } } as unknown as EngineDefinition)).toBe('api');
    expect(modEngineBackend(registry, { id: 'gone', binary: 'gone', api: { baseUrl: 'x' } } as unknown as EngineDefinition)).toBe('api');
    expect(modEngineBackend(registry, { id: 'bare' } as EngineDefinition)).toBeUndefined();
  });

  it('reports the applied ceiling and the extension outcome', () => {
    const timedOut: DispatchResult = { ...ok, exitCode: 124, timedOut: true, stdout: 'partial', timeoutKind: 'ceiling', extendedSeconds: 1380 };
    expect(modDispatchFields(timedOut, undefined, 420, 1800)).toMatchObject({
      engineFault: 'timeout', appliedTimeoutSeconds: 420, appliedCeilingSeconds: 1800, timeoutKind: 'ceiling', extendedSeconds: 1380,
    });
    expect(modDispatchFields(ok, undefined, 420)).not.toHaveProperty('appliedCeilingSeconds');
    expect(modDispatchFields(ok)).not.toHaveProperty('timeoutKind');
    expect(modDispatchFields(ok)).not.toHaveProperty('extendedSeconds');
  });
});

describe('mod dispatch output budget', () => {
  const engine = { id: 'glm', api: { maxTokens: 16384 } } as unknown as EngineDefinition;

  it('applies the review default only for review mode without an explicit budget', () => {
    expect(modDispatchMaxTokens('review', undefined, {}, engine)).toBe(16384);
    expect(modDispatchMaxTokens('review', 4000, {}, engine)).toBe(4000);
    expect(modDispatchMaxTokens('exec', undefined, {}, engine)).toBeUndefined();
    expect(modDispatchMaxTokens('review', undefined, { reviewMaxTokens: 50000 }, engine)).toBe(50000);
  });

  it('keeps the legacy review budget floor and overrides', () => {
    expect(resolveReviewMaxTokens({}, {})).toBe(8192);
    expect(resolveReviewMaxTokens({ reviewMaxTokens: 1 }, {})).toBe(1);
    expect(resolveReviewMaxTokens({}, { api: { maxTokens: 100 } })).toBe(8192);
    expect(resolveReviewMaxTokens({}, { api: { maxTokens: 64000 } })).toBe(64000);
  });
});

describe('describeModEngines', () => {
  it('reports binary, api origin and the backend legacy review routing would use', () => {
    const engines: Record<string, EngineDefinition> = {
      codex: { id: 'codex', binary: 'codex' } as EngineDefinition,
      glm: { id: 'glm', api: { baseUrl: 'https://api.z.ai/api/coding/paas/v4' } } as unknown as EngineDefinition,
      missing: { id: 'missing', binary: 'not-installed', api: { baseUrl: 'https://x.test/v1' } } as unknown as EngineDefinition,
    };
    const registry = {
      get(id: string) { const engine = engines[id]; if (!engine) throw new Error('unknown'); return engine; },
      findBinary(engine: EngineDefinition) { return engine.id === 'codex' ? '/usr/bin/codex' : null; },
    };
    expect(describeModEngines(registry, ['codex', 'glm', 'missing', 'ghost'])).toEqual([
      { id: 'codex', binary: 'codex', backend: 'cli' },
      { id: 'glm', apiBaseUrl: 'https://api.z.ai/api/coding/paas/v4', backend: 'api' },
      { id: 'missing', binary: 'not-installed', apiBaseUrl: 'https://x.test/v1', backend: 'api' },
    ]);
  });
});

describe('classifyApiFailure', () => {
  it('uses the last retry cause rather than the retry wrapper', () => {
    const wrapper = Object.assign(new Error('Failed after 6 attempts'), {
      name: 'AI_RetryError',
      errors: [Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
        Object.assign(new Error('Cannot connect to API: Headers Timeout Error'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })],
    });
    expect(classifyApiFailure(wrapper).kind).toBe('timeout');
  });

  it('prefers an explicit status code', () => {
    expect(classifyApiFailure(Object.assign(new Error('x'), { lastError: Object.assign(new Error('Forbidden'), { statusCode: 403 }) })).kind).toBe('auth');
    expect(classifyApiFailure(Object.assign(new Error('x'), { lastError: Object.assign(new Error('timed out?'), { statusCode: 429 }) })).kind).toBe('rate_limit');
  });
});
