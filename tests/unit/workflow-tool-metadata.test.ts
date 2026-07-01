import { describe, expect, it } from 'vitest';

import { createPipelineTool } from '../../packages/core/src/tools.js';
import { ORCHESTRATION_TOOLS, listMcpTools, workflowToolMetadata } from '../../packages/mcp/src/generated/agon-orchestration.js';

describe('workflow tool metadata', () => {
  it('exposes certified workflow metadata on the core Pipeline tool', () => {
    const tool = createPipelineTool();
    expect(tool.definition.metadata?.workflow).toEqual({
      id: 'agon.build-review-fix',
      version: 'v1',
      alias: 'agon.build-review-fix@v1',
      phases: ['build', 'review', 'fix'],
      conformance: 'core-workflow-registry',
    });
  });

  it('exposes certified workflow metadata for MCP Pipeline discovery', () => {
    const mcpPipelineTool = ORCHESTRATION_TOOLS.find((tool) => tool.name === 'Pipeline');

    expect(mcpPipelineTool?.annotations?.workflow).toEqual({
      id: 'agon.brainstorm-forge-tribunal',
      version: 'v1',
      alias: 'agon.brainstorm-forge-tribunal@v1',
      phases: ['brainstorm', 'forge', 'tribunal'],
      conformance: 'core-workflow-registry',
    });
    expect(workflowToolMetadata('Pipeline')?.workflow).toEqual({
      id: 'agon.brainstorm-forge-tribunal',
      version: 'v1',
      alias: 'agon.brainstorm-forge-tribunal@v1',
      phases: ['brainstorm', 'forge', 'tribunal'],
      conformance: 'core-workflow-registry',
    });
    expect(workflowToolMetadata('Forge')).toBeUndefined();
  });

  it('includes Pipeline workflow annotations in the MCP tools/list payload', () => {
    const pipelineTool = listMcpTools().find((tool) => tool.name === 'Pipeline');

    expect(pipelineTool?.annotations?.workflow).toEqual({
      id: 'agon.brainstorm-forge-tribunal',
      version: 'v1',
      alias: 'agon.brainstorm-forge-tribunal@v1',
      phases: ['brainstorm', 'forge', 'tribunal'],
      conformance: 'core-workflow-registry',
    });
    expect(pipelineTool?.metadata).toBeUndefined();
  });
});
