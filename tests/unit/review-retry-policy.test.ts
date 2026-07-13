import { describe, expect, it } from 'vitest';
import { remainingReviewRetrySeconds, shouldRetryReviewAttempt } from '../../packages/cli/src/generated/handlers/review.js';

describe('standalone Review retry policy', () => {
  it('keeps a retry inside the original total timeout', () => {
    expect(remainingReviewRetrySeconds(1_000, 180, 31_000)).toBe(150);
    expect(remainingReviewRetrySeconds(1_000, 180, 181_000)).toBe(0);
    expect(remainingReviewRetrySeconds(1_000, 180, -10_000)).toBe(180);
  });

  it('retries an early hard error when meaningful budget remains', () => {
    expect(shouldRetryReviewAttempt('error', 150)).toBe(true);
  });

  it('keeps timeouts final and never extends an exhausted budget', () => {
    expect(shouldRetryReviewAttempt('timeout', 90)).toBe(false);
    expect(shouldRetryReviewAttempt('timeout', 0)).toBe(false);
    expect(shouldRetryReviewAttempt('error', 4)).toBe(false);
    expect(shouldRetryReviewAttempt('ok', 150)).toBe(false);
  });
});
