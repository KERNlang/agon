import { describe, expect, it } from 'vitest';
import { compareKernNativeCoverage } from '../../scripts/check-kern-native-coverage.mjs';

const policy = {
  root: 'packages',
  minimums: { nativeCoveragePct: 100, nativeCoverageUnits: 15 },
};

const greenSummary = {
  total: 201,
  failed: 0,
  coverage: { total: 15, percent: 100 },
};

describe('KERN native coverage gate', () => {
  it('accepts the configured non-vacuous coverage floor', () => {
    expect(compareKernNativeCoverage(greenSummary, policy)).toEqual([]);
  });

  it('rejects empty, partial, and malformed summaries', () => {
    expect(compareKernNativeCoverage(undefined, policy)).toContain('native test summary is missing');
    expect(compareKernNativeCoverage({ ...greenSummary, total: 0 }, policy)).toContain('no native KERN tests were discovered');
    expect(compareKernNativeCoverage({ ...greenSummary, total: undefined }, policy)).toContain('summary.total must be numeric');
    expect(compareKernNativeCoverage({ ...greenSummary, coverage: { total: 14, percent: 100 } }, policy).join('\n')).toContain('denominator 14');
    expect(compareKernNativeCoverage({ ...greenSummary, coverage: { total: 15, percent: 99 } }, policy).join('\n')).toContain('coverage 99%');
    expect(compareKernNativeCoverage({ ...greenSummary, failed: 1 }, policy).join('\n')).toContain('1 native assertion');
  });

  it('fails closed on malformed policy fields', () => {
    expect(compareKernNativeCoverage(greenSummary, {}).join('\n')).toContain('policy root');
    expect(compareKernNativeCoverage(greenSummary, {}).join('\n')).toContain('nativeCoveragePct');
    expect(compareKernNativeCoverage(greenSummary, {}).join('\n')).toContain('nativeCoverageUnits');
  });
});
