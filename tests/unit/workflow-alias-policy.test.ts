import { describe, expect, it } from 'vitest';

import {
  RESERVED_WORKFLOW_ALIASES,
  assertWorkflowAliasesAllowed,
  normalizeWorkflowAlias,
  validateWorkflowAliases,
} from '../../packages/core/src/generated/workflows/alias-policy.js';

describe('workflow alias policy', () => {
  it('normalizes aliases before policy checks', () => {
    expect(normalizeWorkflowAlias('  Review-Flow ')).toBe('review-flow');
  });

  it('blocks reserved aliases', () => {
    expect(RESERVED_WORKFLOW_ALIASES).toContain('run');

    const issues = validateWorkflowAliases(['run']);
    expect(issues).toMatchObject([{ code: 'reserved-alias' }]);
    expect(() => assertWorkflowAliasesAllowed(['run'])).toThrowError(/alias policy/);
  });

  it('blocks duplicate aliases after normalization', () => {
    expect(validateWorkflowAliases(['ship', ' SHIP ']).map((issue) => issue.code)).toContain('duplicate-alias');
  });
});
