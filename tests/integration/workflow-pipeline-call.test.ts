import { describe, expect, it } from 'vitest';

import { buildCallCommands } from '../../packages/cli/src/commands/call.js';
import { getCoreWorkflowRegistry, compileWorkflowSpec, verifyWorkflowExecutionPlanFlow } from '../../packages/core/src/index.js';

describe('workflow-pipeline-call — agon.brainstorm-forge-tribunal@v1 wiring', () => {
  it('certified spec is registered and resolvable by alias', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.resolve('agon.brainstorm-forge-tribunal@v1');
    expect(spec).toBeDefined();
    expect(spec!.id).toBe('agon.brainstorm-forge-tribunal');
    expect(spec!.version).toBe('v1');
    expect(spec!.phases.map((p) => p.id)).toEqual(['brainstorm', 'forge', 'tribunal']);
  });

  it('certified spec compiles without conformance errors', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.brainstorm-forge-tribunal@v1');
    expect(() => compileWorkflowSpec(spec)).not.toThrow();
  });

  it('compiled plan passes flow verification', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.brainstorm-forge-tribunal@v1');
    const plan = compileWorkflowSpec(spec);
    const issues = verifyWorkflowExecutionPlanFlow(plan);
    expect(issues).toHaveLength(0);
  });

  it('plan phases are ordered brainstorm → forge → tribunal with correct dependencies', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.brainstorm-forge-tribunal@v1');
    const plan = compileWorkflowSpec(spec);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases[0].id).toBe('brainstorm');
    expect(plan.phases[0].dependsOn).toEqual([]);
    expect(plan.phases[1].id).toBe('forge');
    expect(plan.phases[1].dependsOn).toEqual(['brainstorm']);
    expect(plan.phases[2].id).toBe('tribunal');
    expect(plan.phases[2].dependsOn).toEqual(['forge']);
  });

  it('buildCallCommands pipeline returns workflowMeta with workflow id and plan id', () => {
    const result = buildCallCommands({
      workflow: 'pipeline',
      input: 'Build a health endpoint',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
    });
    expect(result.workflowMeta).toBeDefined();
    expect(result.workflowMeta!.workflowId).toBe('agon.brainstorm-forge-tribunal');
    expect(result.workflowMeta!.version).toBe('v1');
    expect(typeof result.workflowMeta!.planId).toBe('string');
    expect(result.workflowMeta!.planId.length).toBeGreaterThan(0);
  });

  it('buildCallCommands pipeline preserves existing brainstorm → forge → tribunal command sequence', () => {
    const result = buildCallCommands({
      workflow: 'pipeline',
      input: 'Make the bridge live',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      tribunalMode: 'synthesis',
    });
    expect(result.commands).toEqual([
      ['brainstorm', 'Make the bridge live'],
      ['forge', 'Make the bridge live', '--test', 'npm test', '--cwd', '/tmp/project'],
      ['tribunal', 'Review the pipeline result for: Make the bridge live', '--rounds', '1', '--mode', 'synthesis'],
    ]);
  });

  it('buildCallCommands pipeline workflowMeta planId encodes workflow id and version', () => {
    const result = buildCallCommands({
      workflow: 'pipeline',
      input: 'Ship feature',
    });
    expect(result.workflowMeta!.planId).toContain('agon.brainstorm-forge-tribunal');
  });
});
