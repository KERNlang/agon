import type { ModelCallFailure } from '@kernlang/agon-support-engine-runtime';

import { classifyApiFailure } from './failure-classify.js';

export interface ModelRetryConfig {
  modelRetryMaxRetries?: number;
  modelRetryMaxWaitMs?: number;
  modelRetryMaxElapsedMs?: number;
  modelRetryBaseDelayMs?: number;
  modelRetryMaxDelayMs?: number;
}

export interface ModelRetryPolicy {
  maxRetries: number;
  maxWaitMs: number;
  maxElapsedMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type ModelRetryDecision =
  | { retry: true; delayMs: number }
  | { retry: false; reason: 'not_retryable' | 'output_started' | 'retries_exhausted' | 'wait_cap_exhausted' | 'elapsed_cap_exhausted' };

export interface ModelRetryBudget {
  turnId?: string;
  spentMs: number;
}

export interface ModelRetryPlan {
  delayMs: number;
  attempt: number;
  failure: ModelCallFailure;
}

const NON_OUTPUT_STREAM_PARTS = new Set(['start', 'start-step', 'error', 'raw']);
const STATUS_TICK_MS = 5_000;

export function isModelOutputPart(partType: unknown): boolean {
  return !NON_OUTPUT_STREAM_PARTS.has(String(partType));
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function resolveModelRetryPolicy(config?: ModelRetryConfig): ModelRetryPolicy {
  return {
    maxRetries: nonNegativeInteger(config?.modelRetryMaxRetries, 5),
    maxWaitMs: nonNegativeInteger(config?.modelRetryMaxWaitMs, 120_000),
    maxElapsedMs: nonNegativeInteger(config?.modelRetryMaxElapsedMs, 300_000),
    baseDelayMs: nonNegativeInteger(config?.modelRetryBaseDelayMs, 2_000),
    maxDelayMs: nonNegativeInteger(config?.modelRetryMaxDelayMs, 30_000),
  };
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseRetryAfterMs(headers: unknown, nowMs: number = Date.now()): number | undefined {
  const millis = Number(headerValue(headers, 'retry-after-ms'));
  if (Number.isFinite(millis) && millis >= 0) return millis;
  const raw = headerValue(headers, 'retry-after');
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : undefined;
}

function underlyingError(err: unknown): Record<string, unknown> {
  let current = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const record = current as Record<string, unknown>;
    if (record.statusCode !== undefined) break;
    const next = record.lastError ?? record.cause;
    if (next === undefined) break;
    current = next;
  }
  return current && typeof current === 'object' ? current as Record<string, unknown> : {};
}

/**
 * Only 429 and 5xx retry; every other HTTP status is final. A failure with no status retries only when the SDK marked it transient (connection refused, headers timeout) or its text names a rate limit or overload.
 */
export function describeModelCallFailure(err: unknown, outputStarted: boolean): ModelCallFailure {
  const cause = underlyingError(err);
  const statusCode = Number(cause.statusCode);
  const retryAfterMs = parseRetryAfterMs(cause.responseHeaders);
  const kind = classifyApiFailure(err).kind;
  const retryable = Number.isFinite(statusCode)
    ? statusCode === 429 || (statusCode >= 500 && statusCode <= 599)
    : kind !== 'auth' && (cause.isRetryable === true || kind === 'rate_limit' || /overloaded/i.test(String(cause.message ?? err)));
  return {
    retryable,
    outputStarted,
    ...(Number.isFinite(statusCode) ? { statusCode } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function decideModelCallRetry(input: { failure: ModelCallFailure; retries: number; waitedMs: number; spentMs: number; policy: ModelRetryPolicy; random?: () => number }): ModelRetryDecision {
  const { failure, retries, waitedMs, spentMs, policy } = input;
  if (failure.outputStarted) return { retry: false, reason: 'output_started' };
  if (!failure.retryable) return { retry: false, reason: 'not_retryable' };
  if (retries >= policy.maxRetries) return { retry: false, reason: 'retries_exhausted' };
  const exponential = Math.min(policy.baseDelayMs * 2 ** retries, policy.maxDelayMs);
  const jittered = Math.round(exponential * (0.5 + (input.random ?? Math.random)() * 0.5));
  const delayMs = failure.retryAfterMs ?? jittered;
  if (waitedMs + delayMs > policy.maxWaitMs) return { retry: false, reason: 'wait_cap_exhausted' };
  if (spentMs + delayMs > policy.maxElapsedMs) return { retry: false, reason: 'elapsed_cap_exhausted' };
  return { retry: true, delayMs };
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function failureLabel(failure: ModelCallFailure): string {
  if (failure.statusCode === 429) return 'rate limited (429)';
  if (failure.statusCode !== undefined) return `engine error (${failure.statusCode})`;
  return 'engine unreachable';
}

/**
 * Retry state for the Cesar API loop. Retries and waited time are per model call and reset once a call returns without failing. The budget spans the whole turn, so it also bounds the time failing calls themselves take, which each get a fresh engine timeout.
 */
export function createModelCallRetryGate(config: ModelRetryConfig | undefined, signal?: AbortSignal, budget: ModelRetryBudget = { spentMs: 0 }) {
  const policy = resolveModelRetryPolicy(config);
  let retries = 0;
  let waitedMs = 0;
  let failingSince: number | undefined;
  let refusal: ModelRetryDecision | undefined;

  const closeFailureSpan = (): void => {
    if (failingSince !== undefined) budget.spentMs += Date.now() - failingSince;
    failingSince = undefined;
  };

  return {
    plan(failure: ModelCallFailure | undefined): ModelRetryPlan | null {
      refusal = undefined;
      if (!failure) {
        closeFailureSpan();
        retries = 0;
        waitedMs = 0;
        return null;
      }
      failingSince ??= Date.now();
      const spentMs = budget.spentMs + Date.now() - failingSince;
      const decision = decideModelCallRetry({ failure, retries, waitedMs, spentMs, policy });
      if (!decision.retry) {
        refusal = decision;
        closeFailureSpan();
        return null;
      }
      return { delayMs: decision.delayMs, attempt: retries + 1, failure };
    },

    async *wait(plan: ModelRetryPlan) {
      const label = failureLabel(plan.failure);
      const metadata = { kind: 'model-retry', attempt: plan.attempt, maxRetries: policy.maxRetries, delayMs: plan.delayMs, statusCode: plan.failure.statusCode };
      let remaining = plan.delayMs;
      let tick = 0;
      while (remaining > 0 && !signal?.aborted) {
        yield { type: 'status' as const, content: `${label}, retry ${plan.attempt}/${policy.maxRetries} in ${Math.ceil(remaining / 1000)}s (Esc to cancel)`, metadata: { ...metadata, phase: 'waiting', tick: tick++ } };
        const slice = Math.min(remaining, STATUS_TICK_MS);
        await abortableDelay(slice, signal);
        remaining -= slice;
      }
      if (!signal?.aborted) {
        retries = plan.attempt;
        waitedMs += plan.delayMs;
        yield { type: 'status' as const, content: `${label}, retrying now (${plan.attempt}/${policy.maxRetries})…`, metadata: { ...metadata, phase: 'retrying', tick } };
      }
    },

    finalError(stderr: string, failure: ModelCallFailure | undefined): { content: string; metadata?: Record<string, unknown> } {
      if (!failure) return { content: stderr };
      const final = failure.statusCode !== undefined || retries > 0;
      const metadata = { modelRetryFinal: final, statusCode: failure.statusCode, modelRetries: retries };
      const reason = refusal && !refusal.retry ? refusal.reason : undefined;
      if (reason === 'wait_cap_exhausted') {
        return { content: `Not retrying, the wait would pass the ${Math.round(policy.maxWaitMs / 1000)}s retry cap after ${retries} retries: ${stderr}`, metadata };
      }
      if (reason === 'elapsed_cap_exhausted') {
        return { content: `Not retrying, this turn used its ${Math.round(policy.maxElapsedMs / 1000)}s retry budget after ${retries} retries: ${stderr}`, metadata };
      }
      if (reason === 'retries_exhausted') {
        return { content: `Gave up after ${retries} retries, ${Math.round(waitedMs / 1000)}s waited: ${stderr}`, metadata };
      }
      return { content: stderr, metadata };
    },
  };
}
