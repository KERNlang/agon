import { describe, expect, it } from 'vitest';
import { isGoalSourcePath, isGoalTestPath } from './test-paths.js';

describe('goal-multilang: test and source path predicates', () => {
  it.each(['test_x.py', 'pkg/x_test.go', 'XTest.java', 'conftest.py', 'src/foo.test.ts', 'tests/a.rs', '__tests__/a.js'])(
    'goal-multilang: %s is a test and not source', path => {
      expect(isGoalTestPath(path)).toBe(true);
      expect(isGoalSourcePath(path)).toBe(false);
    });

  it.each(['src/a.py', 'a.go', 'a.c', 'include/a.h', 'a.cs', 'src/a.ts'])('goal-multilang: %s is source and not a test', path => {
    expect(isGoalSourcePath(path)).toBe(true);
    expect(isGoalTestPath(path)).toBe(false);
  });

  it.each(['README.md', 'build.gradle.kts'])('goal-multilang: %s is neither test nor source', path => {
    expect(isGoalTestPath(path)).toBe(false);
    expect(isGoalSourcePath(path)).toBe(false);
  });
});
