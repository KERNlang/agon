import { describe, expect, it } from 'vitest';
import { compareKernSelfCoverage, parseKernJson } from '../../scripts/check-kern-self-coverage.mjs';

const policy = {
  minimums: { nativeAuthoredPct: 28.55, classifiedOrMigratablePct: 73.7 },
  maximums: { filesWithParseErrors: 0, blockedHandlers: 620 },
  blockerMaximums: { 'foreign-missing-reason': 70 },
};

const greenReport = {
  nativeAuthoredPct: 28.55,
  classifiedOrMigratablePct: 73.7,
  filesWithParseErrors: 0,
  blockedHandlers: 620,
  blockers: [{ reason: 'foreign-missing-reason', count: 70 }],
};

describe('KERN self-coverage regression gate', () => {
  it('accepts an equal baseline and improvements', () => {
    expect(compareKernSelfCoverage(greenReport, policy)).toEqual([]);
    expect(compareKernSelfCoverage({
      ...greenReport,
      nativeAuthoredPct: 30,
      classifiedOrMigratablePct: 80,
      blockedHandlers: 500,
      blockers: [],
    }, policy)).toEqual([]);
  });

  it.each([
    [{ ...greenReport, filesWithParseErrors: 1 }, 'filesWithParseErrors'],
    [{ ...greenReport, nativeAuthoredPct: 28.54 }, 'nativeAuthoredPct'],
    [{ ...greenReport, classifiedOrMigratablePct: 73.69 }, 'classifiedOrMigratablePct'],
    [{ ...greenReport, blockedHandlers: 621 }, 'blockedHandlers'],
    [{ ...greenReport, blockers: [{ reason: 'foreign-missing-reason', count: 71 }] }, 'foreign-missing-reason'],
  ])('rejects regression in %s', (report, expected) => {
    expect(compareKernSelfCoverage(report, policy).join('\n')).toContain(expected);
  });

  it('fails closed on missing required numeric fields', () => {
    expect(compareKernSelfCoverage({}, policy)).toHaveLength(5);
    expect(compareKernSelfCoverage(greenReport, {}).join('\n')).toContain('minimums.nativeAuthoredPct');
    expect(compareKernSelfCoverage(greenReport, {}).join('\n')).toContain('maximums.blockedHandlers');
    expect(compareKernSelfCoverage(greenReport, {}).join('\n')).toContain('blockerMaximums.foreign-missing-reason');
  });

  it('fails closed on a malformed blocker count', () => {
    expect(compareKernSelfCoverage({
      ...greenReport,
      blockers: [{ reason: 'foreign-missing-reason' }],
    }, policy).join('\n')).toContain('count must be numeric');
  });

  it('rejects malformed entries and sums duplicate blocker reasons', () => {
    expect(compareKernSelfCoverage({ ...greenReport, blockers: [null] }, policy).join('\n')).toContain('string reason');
    expect(compareKernSelfCoverage({
      ...greenReport,
      blockers: [
        { reason: 'foreign-missing-reason', count: 40 },
        { reason: 'foreign-missing-reason', count: 31 },
      ],
    }, policy).join('\n')).toContain('71 exceeds baseline 70');
  });

  it('parses machine JSON and rejects non-JSON output', () => {
    expect(parseKernJson('{"nativeAuthoredPct":28.55}')).toEqual({ nativeAuthoredPct: 28.55 });
    expect(() => parseKernJson('not json')).toThrow(/invalid JSON/);
  });
});
