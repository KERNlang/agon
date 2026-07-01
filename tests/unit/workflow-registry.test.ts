import { describe, expect, it } from 'vitest';

import { WorkflowRegistry } from '../../packages/core/src/index.js';
import type { WorkflowSpec } from '../../packages/core/src/generated/workflows/specs.js';

function spec(overrides: Partial<WorkflowSpec> = {}): WorkflowSpec {
  return {
    id: 'vertical-core',
    version: '1',
    aliases: ['core-flow'],
    phases: [{ id: 'inspect' }],
    ...overrides,
  };
}

describe('WorkflowRegistry', () => {
  it('resolves registered workflows by id and normalized alias', () => {
    const registry = new WorkflowRegistry([spec()]);

    expect(registry.resolve('vertical-core')?.id).toBe('vertical-core');
    expect(registry.resolve(' VERTICAL-CORE ')?.id).toBe('vertical-core');
    expect(registry.resolve(' CORE-FLOW ')?.id).toBe('vertical-core');
    expect(registry.has('core-flow')).toBe(true);
    expect(registry.list().map((workflow) => workflow.id)).toEqual(['vertical-core']);
  });

  it('blocks alias collisions at registration time', () => {
    const registry = new WorkflowRegistry([spec()]);

    expect(() => registry.register(spec({ id: 'other', aliases: ['CORE-FLOW'] }))).toThrowError(/rejected/);
  });

  it('blocks id collisions using normalized ids', () => {
    const registry = new WorkflowRegistry([spec({ id: 'MyWorkflow', aliases: [] })]);

    expect(registry.resolve('myworkflow')?.id).toBe('MyWorkflow');
    expect(() => registry.register(spec({ id: ' myworkflow ', aliases: [] }))).toThrowError(/rejected/);
  });
});
