import { describe, expect, it } from 'vitest';
import { createCesarToolRegistry } from '../../packages/cli/src/generated/cesar/tools.js';
import { extractDelegation, shouldStopAfterXmlToolCall } from '../../packages/cli/src/generated/cesar/brain-helpers.js';

describe('Cesar native Council tool', () => {
  it('is available to the native tool loop as an optional signal tool', () => {
    const registry = createCesarToolRegistry('claude');
    const council = registry.get('Council');

    expect(council.definition.name).toBe('Council');
    expect(council.validate({ question: 'Should we adopt event sourcing?' }, {} as any)).toBeNull();
    expect(council.checkPermission({}, {} as any).behavior).toBe('allow');
  });

  it('hands Council back to the orchestrator with the question intact', () => {
    expect(extractDelegation('Council', { question: 'REST or GraphQL?' })).toEqual(expect.objectContaining({
      action: 'council',
      task: 'REST or GraphQL?',
    }));
    expect(shouldStopAfterXmlToolCall('Council')).toBe(true);
  });
});
