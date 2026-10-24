import { describe, expect, it } from 'vitest';

import { PIPELINE_DELIVERY_WORKFLOW } from '../../packages/mod-pipeline-delivery/src/implementation.js';
import { PIPELINE_ORCHESTRATION_WORKFLOW } from '../../packages/mod-pipeline-orchestration/src/implementation.js';

describe('modular pipeline workflow identities', () => {
  it('keeps the two pipeline semantics distinct behind explicit compatibility aliases', () => {
    expect(PIPELINE_ORCHESTRATION_WORKFLOW.id).toBe('agon.workflow.pipeline-orchestration.v1');
    expect(PIPELINE_ORCHESTRATION_WORKFLOW.stages).toEqual(['brainstorm', 'forge', 'tribunal']);
    expect(PIPELINE_ORCHESTRATION_WORKFLOW.compatibilityAliases).toEqual(['mcp:Pipeline']);

    expect(PIPELINE_DELIVERY_WORKFLOW.id).toBe('agon.workflow.pipeline-delivery.v1');
    expect(PIPELINE_DELIVERY_WORKFLOW.stages).toEqual(['build', 'review', 'fix']);
    expect(PIPELINE_DELIVERY_WORKFLOW.compatibilityAliases).toEqual(['tui:/pipeline', 'cesar:pipeline']);
    expect(PIPELINE_DELIVERY_WORKFLOW.id).not.toBe(PIPELINE_ORCHESTRATION_WORKFLOW.id);
  });
});
