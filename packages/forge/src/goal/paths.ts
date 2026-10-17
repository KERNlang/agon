import { resolveWithinRoot } from '@kernlang/agon-core';
export { assertSafeGoalId, safePathSegment } from '@kernlang/agon-mod-goal';

/**
 * Resolve candidate against root and throw if it escapes root (absolute escapes, ../, and symlinks that leave the root). Delegates to core's resolveWithinRoot — this used to be a byte-identical copy of it, and a duplicated security boundary is the one kind of duplication that must never be allowed to drift.
 */
export function resolveWithin(root: string, candidate: string): string {
  return resolveWithinRoot(root, candidate);
}
