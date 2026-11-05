import type { ModelCallFailure } from '@kernlang/agon-support-engine-runtime';

import { classifyApiFailure } from './failure-classify.js';

export interface ModelRetryConfig {
  modelRetryMaxAttempts?: number;
  modelRetryMaxWaitMs?: number;
  modelRetryBaseDelayMs?: number;
  modelRetryMaxDelayMs?: number;
}

export interface ModelRetryPolicy {
  maxAttempts: number;
  maxWaitMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type ModelRetryDecision =
  | { retry: true; delayMs: number }
  | { retry: false; reason: 'not_retryable' | 'output_started' | 'attempts_exhausted' | 'wait_cap_exhausted' };

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
    maxAttempts: nonNegativeInteger(config?.modelRetryMaxAttempts, 5),
    maxWaitMs: nonNegativeInteger(config?.modelRetryMaxWaitMs, 120_000),
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

export function decideModelCallRetry(input: { failure: ModelCallFailure; attempt: number; waitedMs: number; policy: ModelRetryPolicy; random?: () => number }): ModelRetryDecision {
  const { failure, attempt, waitedMs, policy } = input;
  if (failure.outputStarted) return { retry: false, reason: 'output_started' };
  if (!failure.retryable) return { retry: false, reason: 'not_retryable' };
  if (attempt >= policy.maxAttempts) return { retry: false, reason: 'attempts_exhausted' };
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  const jittered = Math.round(exponential * (0.5 + (input.random ?? Math.random)() * 0.5));
  const delayMs = failure.retryAfterMs ?? jittered;
  if (waitedMs + delayMs > policy.maxWaitMs) return { retry: false, reason: 'wait_cap_exhausted' };
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
 * Per-model-call retry state for the Cesar API loop. Attempts and waited time reset as soon as a call returns without failing.
 */
export function createModelCallRetryGate(config: ModelRetryConfig | undefined, signal?: AbortSignal) {
  const policy = resolveModelRetryPolicy(config);
  let attempt = 0;
  let waitedMs = 0;
  let refusal: ModelRetryDecision | undefined;

  return {
    plan(failure: ModelCallFailure | undefined): ModelRetryPlan | null {
      refusal = undefined;
      if (!failure) {
        attempt = 0;
        waitedMs = 0;
        return null;
      }
      const decision = decideModelCallRetry({ failure, attempt, waitedMs, policy });
      if (!decision.retry) {
        refusal = decision;
        return null;
      }
      attempt++;
      waitedMs += decision.delayMs;
      return { delayMs: decision.delayMs, attempt, failure };
    },

    async *wait(plan: ModelRetryPlan) {
      const label = failureLabel(plan.failure);
      const metadata = { kind: 'model-retry', attempt: plan.attempt, maxAttempts: policy.maxAttempts, delayMs: plan.delayMs, statusCode: plan.failure.statusCode };
      let remaining = plan.delayMs;
      while (remaining > 0 && !signal?.aborted) {
        yield { type: 'status' as const, content: `${label}, retry ${plan.attempt}/${policy.maxAttempts} in ${Math.ceil(remaining / 1000)}s (Esc to cancel)`, metadata };
        const tick = Math.min(remaining, STATUS_TICK_MS);
        await abortableDelay(tick, signal);
        remaining -= tick;
      }
      if (!signal?.aborted) {
        yield { type: 'status' as const, content: `${label}, retrying now (${plan.attempt}/${policy.maxAttempts})…`, metadata };
      }
    },

    finalError(stderr: string, failure: ModelCallFailure | undefined): { content: string; metadata?: Record<string, unknown> } {
      if (!failure) return { content: stderr };
      const final = failure.statusCode !== undefined || attempt > 0;
      const metadata = { modelRetryFinal: final, statusCode: failure.statusCode, modelRetries: attempt };
      const reason = refusal && !refusal.retry ? refusal.reason : undefined;
      if (reason === 'wait_cap_exhausted') {
        return { content: `Not retrying, the wait would pass the ${Math.round(policy.maxWaitMs / 1000)}s retry cap after ${attempt} retries: ${stderr}`, metadata };
      }
      if (reason === 'attempts_exhausted') {
        return { content: `Gave up after ${attempt} retries, ${Math.round(waitedMs / 1000)}s waited: ${stderr}`, metadata };
      }
      return { content: stderr, metadata };
    },
  };
}
