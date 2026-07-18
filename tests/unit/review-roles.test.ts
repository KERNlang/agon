import { describe, expect, it } from 'vitest';

import {
  REVIEW_ROLES,
  assignReviewRoles,
  buildRoleInstructions,
  resolveReviewRole,
} from '../../packages/cli/src/generated/handlers/review.js';

describe('resolveReviewRole', () => {
  it('resolves a known role case-insensitively', () => {
    expect(resolveReviewRole('security')?.id).toBe('security');
    expect(resolveReviewRole('SECURITY')?.id).toBe('security');
    expect(resolveReviewRole('  Dryness ')?.id).toBe('dryness');
  });

  it('returns undefined for none or unknown ids', () => {
    expect(resolveReviewRole(undefined)).toBeUndefined();
    expect(resolveReviewRole('')).toBeUndefined();
    expect(resolveReviewRole('not-a-role')).toBeUndefined();
  });

  it('covers the fixed roster ids', () => {
    expect(REVIEW_ROLES.map((r) => r.id)).toEqual([
      'security',
      'correctness',
      'dryness',
      'performance',
      'overall',
    ]);
  });
});

describe('assignReviewRoles', () => {
  it('seats the overall backstop first on a full panel, then deals specialists', () => {
    const map = assignReviewRoles(['a', 'b', 'c', 'd', 'e', 'f', 'g'], undefined);
    expect(map.get('a')?.id).toBe('overall'); // backstop first
    expect(map.get('b')?.id).toBe('security');
    expect(map.get('c')?.id).toBe('correctness');
    expect(map.get('d')?.id).toBe('dryness');
    expect(map.get('e')?.id).toBe('performance');
    // Coverage is never partitioned away: engines past the roster are generalists.
    expect(map.get('f')?.id).toBe('overall');
    expect(map.get('g')?.id).toBe('overall');
  });

  it('always guarantees an overall backstop on small multi-engine panels', () => {
    // 2 engines: backstop + one specialist — nobody is left without a catch-all.
    const two = assignReviewRoles(['a', 'b'], undefined);
    expect(two.get('a')?.id).toBe('overall');
    expect(two.get('b')?.id).toBe('security');

    const three = assignReviewRoles(['a', 'b', 'c'], undefined);
    expect(three.get('a')?.id).toBe('overall');
    expect(three.get('b')?.id).toBe('security');
    expect(three.get('c')?.id).toBe('correctness');

    const four = assignReviewRoles(['a', 'b', 'c', 'd'], undefined);
    expect([...four.values()].some((r) => r.id === 'overall')).toBe(true);
  });

  it('gives a single engine the deepest lens (it IS the whole panel)', () => {
    const map = assignReviewRoles(['solo'], undefined);
    expect(map.get('solo')?.id).toBe('security');
  });

  it('zips an explicit role list engine i → role i', () => {
    const map = assignReviewRoles(['a', 'b'], ['correctness', 'security']);
    expect(map.get('a')?.id).toBe('correctness');
    expect(map.get('b')?.id).toBe('security');
  });

  it('cycles an explicit role list shorter than the engine list', () => {
    const map = assignReviewRoles(['a', 'b', 'c'], ['security']);
    expect(map.get('a')?.id).toBe('security');
    expect(map.get('b')?.id).toBe('security');
    expect(map.get('c')?.id).toBe('security');
  });

  it('falls back to overall for unknown explicit role ids', () => {
    const map = assignReviewRoles(['a'], ['bogus']);
    expect(map.get('a')?.id).toBe('overall');
  });
});

describe('buildRoleInstructions', () => {
  it('names the role and keeps the outside-role safety tail', () => {
    const role = resolveReviewRole('security');
    expect(role).toBeDefined();
    const text = buildRoleInstructions(role!);
    expect(text).toContain('Security reviewer');
    expect(text.toLowerCase()).toContain('outside your role');
  });

  it('preserves the shared verify/confidence discipline', () => {
    const role = resolveReviewRole('correctness');
    const text = buildRoleInstructions(role!);
    expect(text).toContain('VERIFY before you flag');
    expect(text).toContain('severity (blocking|important|nit)');
  });
});
