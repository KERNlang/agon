import { describe, expect, it } from 'vitest';

import { defaultFinalizeOnScoreForTask } from '@kernlang/agon-core';

describe('defaultFinalizeOnScoreForTask', () => {
  it('returns 75 for docs tasks', () => {
    expect(defaultFinalizeOnScoreForTask('update the README and changelog')).toBe(75);
  });

  it('returns 75 for test tasks', () => {
    expect(defaultFinalizeOnScoreForTask('add tests for the validator')).toBe(75);
  });

  it('returns 85 for bugfix tasks', () => {
    expect(defaultFinalizeOnScoreForTask('fix the off-by-one bug in the loop')).toBe(85);
  });

  it('returns 85 for refactor tasks', () => {
    expect(defaultFinalizeOnScoreForTask('refactor the auth module to use the new interface')).toBe(85);
  });

  it('returns undefined for algorithm tasks (always wait for full panel)', () => {
    expect(defaultFinalizeOnScoreForTask('implement a sorting algorithm with O(n log n) worst case')).toBeUndefined();
  });

  it('returns undefined for feature tasks (always wait for full panel)', () => {
    expect(defaultFinalizeOnScoreForTask('add a new authentication feature')).toBeUndefined();
  });

  it('returns undefined for unclassified tasks', () => {
    expect(defaultFinalizeOnScoreForTask('xyzzy plugh')).toBeUndefined();
  });
});
