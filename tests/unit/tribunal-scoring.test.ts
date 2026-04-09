import { describe, it, expect } from 'vitest';

/**
 * Tests for the tribunal Glicko-2 scoring logic.
 * The scoring formula: substantiveRounds * 1000 + min(cappedAvgPerRound, 2000)
 * where substantive = args > 20 chars and not '(failed to respond)'.
 */

// Replicate the scoring logic from tribunal.kern for unit testing
function tribunalScore(args: string[]): number {
  const substantive = args.filter((a) => a.length > 20 && a !== '(failed to respond)');
  const roundCredit = substantive.length;
  const cappedAvg = roundCredit > 0
    ? substantive.reduce((sum, a) => sum + Math.min(a.length, 2000), 0) / roundCredit
    : 0;
  return roundCredit * 1000 + Math.min(cappedAvg, 2000);
}

describe('tribunal scoring — anti-verbosity', () => {
  it('concise multi-round engine beats verbose single-round engine', () => {
    const concise = tribunalScore([
      'Authentication should use JWT with short-lived tokens for security.',
      'Rate limiting at the gateway prevents abuse of the token endpoint.',
      'Session revocation needs a server-side blocklist for compromised tokens.',
    ]);
    const verbose = tribunalScore([
      'A'.repeat(5000), // one enormous argument
    ]);
    expect(concise).toBeGreaterThan(verbose);
  });

  it('failed responses are excluded from scoring', () => {
    const withFailures = tribunalScore([
      '(failed to respond)',
      'Valid argument about database indexing strategy for performance.',
      '(failed to respond)',
    ]);
    // Only 1 substantive round
    expect(withFailures).toBeGreaterThanOrEqual(1000);
    expect(withFailures).toBeLessThan(2000);
  });

  it('very short arguments (<=20 chars) are excluded', () => {
    const tooShort = tribunalScore(['yes', 'no', 'maybe']);
    expect(tooShort).toBe(0);
  });

  it('length is capped at 2000 chars per argument', () => {
    const oneRound = tribunalScore(['A'.repeat(10000)]);
    const oneCapped = tribunalScore(['A'.repeat(2000)]);
    expect(oneRound).toBe(oneCapped);
  });

  it('equal rounds, scores differ by average substance', () => {
    const detailed = tribunalScore([
      'This is a fairly detailed argument about architecture.',
      'Another detailed point about testing strategies in CI.',
    ]);
    const sparse = tribunalScore([
      'Short but valid argument.',
      'Another short valid one.',
    ]);
    // Both have 2 rounds (same primary score), but detailed has higher avg
    expect(detailed).toBeGreaterThan(sparse);
  });

  it('zero arguments returns zero score', () => {
    expect(tribunalScore([])).toBe(0);
  });
});
