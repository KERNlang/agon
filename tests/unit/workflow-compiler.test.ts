import { describe, expect, it } from 'vitest';

import { compileWorkflowSpec } from '../../packages/core/src/generated/workflows/compiler.js';
import { verifyWorkflowExecutionPlanFlow } from '../../packages/core/src/generated/workflows/flow-verification.js';
import type { WorkflowSpec } from '../../packages/core/src/generated/workflows/specs.js';

describe('compileWorkflowSpec', () => {
  it('emits deterministic logical plans in dependency order', () => {
    const spec: WorkflowSpec = {
      id: 'full-vertical',
      version: '1.0.0',
      aliases: ['fv'],
      capabilities: [{ id: 'repo-read' }, { id: 'patch-write' }],
      mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: ['patch-write'] },
      phases: [
        { id: 'verify', dependsOn: ['patch'], requires: ['repo-read'] },
        { id: 'inspect', requires: ['repo-read'] },
        { id: 'patch', dependsOn: ['inspect'], requires: ['patch-write'], mutation: 'workspace' },
      ],
    };

    const first = compileWorkflowSpec(spec);
    const second = compileWorkflowSpec(structuredClone(spec));

    expect(first).toEqual(second);
    expect(first.logicalPlanId).toBe('full-vertical@1.0.0:true:workspace:patch-write:0:inspect::repo-read:none:|1:patch:inspect:patch-write:workspace:|2:verify:patch:repo-read:none:');
    expect(first.phases.map((phase) => phase.id)).toEqual(['inspect', 'patch', 'verify']);
    expect(verifyWorkflowExecutionPlanFlow(first)).toEqual([]);
  });

  it('includes plugin bindings and mutation policy in logical plan identity', () => {
    const base = compileWorkflowSpec({
      id: 'identity',
      version: '1.0.0',
      phases: [{ id: 'phase' }],
    });
    const withPlugin = compileWorkflowSpec({
      id: 'identity',
      version: '1.0.0',
      plugins: [{ id: 'trusted', trustedAdapter: true }],
      phases: [{ id: 'phase', pluginId: 'trusted' }],
    });
    const withPolicy = compileWorkflowSpec({
      id: 'identity',
      version: '1.0.0',
      mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: [] },
      phases: [{ id: 'phase' }],
    });

    expect(new Set([base.logicalPlanId, withPlugin.logicalPlanId, withPolicy.logicalPlanId]).size).toBe(3);
  });

  it('rejects invalid mutation levels and empty phase lists', () => {
    expect(() =>
      compileWorkflowSpec({
        id: 'empty',
        version: '1.0.0',
        phases: [],
      }),
    ).toThrow(/Workflow spec failed conformance/);

    expect(() =>
      compileWorkflowSpec({
        id: 'bad-mutation',
        version: '1.0.0',
        capabilities: [{ id: 'patch-write' }],
        mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: ['patch-write'] },
        phases: [{ id: 'patch', requires: ['patch-write'], mutation: 'filesystem' as never }],
      }),
    ).toThrow(/Workflow spec failed conformance/);
  });

  it('requires mutating phases to use a policy-authorized capability', () => {
    expect(() =>
      compileWorkflowSpec({
        id: 'unauthorized-mutation',
        version: '1.0.0',
        capabilities: [{ id: 'repo-read' }, { id: 'patch-write' }],
        mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: ['patch-write'] },
        phases: [{ id: 'patch', requires: ['repo-read'], mutation: 'workspace' }],
      }),
    ).toThrow(/Workflow spec failed conformance/);
  });

  it('rejects duplicate capabilities, unknown plugins, malformed phases, and exceeded capability mutation levels', () => {
    expect(() =>
      compileWorkflowSpec({
        id: 'duplicate-capability',
        version: '1.0.0',
        capabilities: [{ id: 'patch-write' }, { id: 'patch-write' }],
        phases: [{ id: 'inspect' }],
      }),
    ).toThrow(/Workflow spec failed conformance/);

    expect(() =>
      compileWorkflowSpec({
        id: 'unknown-plugin',
        version: '1.0.0',
        phases: [{ id: 'plugin-step', pluginId: 'missing-plugin' }],
      }),
    ).toThrow(/Workflow spec failed conformance/);

    expect(() =>
      compileWorkflowSpec({
        id: 'malformed-phases',
        version: '1.0.0',
        phases: undefined as never,
      }),
    ).toThrow(/Workflow spec failed conformance/);

    expect(() =>
      compileWorkflowSpec({
        id: 'exceeded-capability-mutation',
        version: '1.0.0',
        capabilities: [{ id: 'patch-write', mutations: ['none'] }],
        mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: ['patch-write'] },
        phases: [{ id: 'patch', requires: ['patch-write'], mutation: 'workspace' }],
      }),
    ).toThrow(/Workflow spec failed conformance/);
  });
});
