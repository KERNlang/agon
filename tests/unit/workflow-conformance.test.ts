import { describe, expect, it } from 'vitest';

import { compileWorkflowSpec } from '../../packages/core/src/generated/workflows/compiler.js';
import {
  createWorkflowConformanceError,
  createWorkflowIssue,
  hasWorkflowConformanceErrors,
} from '../../packages/core/src/generated/workflows/conformance.js';

describe('workflow conformance errors', () => {
  it('creates named errors carrying structured issues', () => {
    const issue = createWorkflowIssue('mutation-denied', 'no writes', 'phases[0]');
    const err = createWorkflowConformanceError([issue]);

    expect(err.name).toBe('WorkflowConformanceError');
    expect((err as Error & { issues: unknown[] }).issues).toEqual([issue]);
    expect(hasWorkflowConformanceErrors([issue])).toBe(true);
  });

  it('throws core conformance errors for unknown capabilities and denied mutation', () => {
    try {
      compileWorkflowSpec({
        id: 'bad',
        version: '1',
        capabilities: [{ id: 'read' }],
        mutationPolicy: { allow: false, maxLevel: 'none' },
        phases: [{ id: 'write', requires: ['missing'], mutation: 'workspace' }],
      });
      throw new Error('expected compileWorkflowSpec to throw');
    } catch (err) {
      expect((err as Error).name).toBe('WorkflowConformanceError');
      expect((err as Error & { issues: { code: string }[] }).issues.map((issue) => issue.code)).toEqual([
        'unknown-capability',
        'mutation-denied',
        'mutation-denied',
      ]);
    }
  });
});
