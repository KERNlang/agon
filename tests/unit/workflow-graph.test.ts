import { describe, expect, it } from 'vitest';

import {
  assertValidWorkflowGraphSpec,
  validateWorkflowGraphSpec,
  workflowGraphFromSpec,
} from '../../packages/core/src/generated/workflows/graph.js';

describe('workflow graph validation', () => {
  it('builds a graph from phase dependencies', () => {
    const graph = workflowGraphFromSpec({
      id: 'core',
      version: '1',
      phases: [{ id: 'inspect' }, { id: 'patch', dependsOn: ['inspect'] }],
    });

    expect(graph).toEqual({
      nodes: [{ id: 'inspect', phaseId: 'inspect' }, { id: 'patch', phaseId: 'patch' }],
      edges: [{ from: 'inspect', to: 'patch' }],
    });
    expect(validateWorkflowGraphSpec(graph)).toEqual([]);
  });

  it('reports missing nodes and cycles', () => {
    expect(validateWorkflowGraphSpec({
      nodes: [{ id: 'a' }],
      edges: [{ from: 'a', to: 'missing' }],
    })).toMatchObject([{ code: 'missing-node' }]);

    const cyclic = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    };
    expect(validateWorkflowGraphSpec(cyclic).map((issue) => issue.code)).toContain('cycle');
    expect(() => assertValidWorkflowGraphSpec(cyclic)).toThrowError(/invalid/);
  });
});
