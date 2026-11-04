import { isBuildScript, isMutationTestFile, profileFor } from '@kernlang/agon-support-worktree';

const LEGACY_TEST_PATH = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./i;
const LEGACY_SOURCE_PATH = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt)$/;

export function isGoalTestPath(path: string): boolean {
  return LEGACY_TEST_PATH.test(path) || isMutationTestFile(path);
}

export function isGoalSourcePath(path: string): boolean {
  return (LEGACY_SOURCE_PATH.test(path) || profileFor(path) !== undefined) && !isGoalTestPath(path) && !isBuildScript(path);
}
