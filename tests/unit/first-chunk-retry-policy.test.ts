import { describe, expect, it } from 'vitest';
import { decideFirstChunkRetry } from '../../packages/core/src/generated/sessions/first-chunk-retry-policy.js';

describe('first-chunk retry policy', () => {
  const timeout = 'API stream first-chunk idle timeout after 120s (received 1 chunks, 0 text chars)';

  it('permits one configured retry only before any side effect', () => {
    expect(decideFirstChunkRetry({
      error: timeout,
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: false,
    })).toEqual({ retry: true, reason: 'clean_first_chunk_timeout' });
  });

  it('fails closed after a side effect or when the configured budget is exhausted', () => {
    expect(decideFirstChunkRetry({
      error: timeout,
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: true,
      aborted: false,
    })).toEqual({ retry: false, reason: 'side_effect_already_started' });
    expect(decideFirstChunkRetry({
      error: timeout,
      retriesUsed: 1,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: false,
    })).toEqual({ retry: false, reason: 'retry_budget_exhausted' });
  });

  it('retries the hint-flavored first-chunk timeout variants (they used to dead-stop the turn)', () => {
    // Canonical message with the format-mismatch tip appended (current dispatch shape).
    expect(decideFirstChunkRetry({
      error: "API stream first-chunk idle timeout after 60s (received 0 chunks, 0 text chars)\ntip: format='anthropic' on 'api.kimi.com' — many OpenAI-compat providers claim Anthropic but serve OpenAI /chat/completions.",
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: false,
    })).toEqual({ retry: true, reason: 'clean_first_chunk_timeout' });
    // Legacy hint-branch phrasing (exitCode-1 era) — must also be retryable.
    expect(decideFirstChunkRetry({
      error: "API first-chunk timeout (60s). tip: format='anthropic' on 'api.kimi.com' — …",
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: false,
    })).toEqual({ retry: true, reason: 'clean_first_chunk_timeout' });
  });

  it('does not reinterpret generic empty responses or cancellation as a retryable timeout', () => {
    expect(decideFirstChunkRetry({
      error: 'Engine returned an empty response',
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: false,
    }).retry).toBe(false);
    expect(decideFirstChunkRetry({
      error: timeout,
      retriesUsed: 0,
      maxRetries: 1,
      hadSideEffects: false,
      aborted: true,
    })).toEqual({ retry: false, reason: 'aborted' });
  });
});
