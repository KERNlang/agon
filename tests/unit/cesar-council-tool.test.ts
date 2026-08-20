import { describe, expect, it } from 'vitest';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { executeToolCall } from '@kernlang/agon-core';
import { extractDelegation, shouldStopAfterXmlToolCall } from '../../packages/cli/src/cesar/brain-helpers.js';

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

// isReadOnly is not decoration: the registry's investigation-phase gate skips
// every non-read-only tool while Cesar is still investigating. Council only
// SIGNALS the orchestrator (it mutates nothing), so mislabelling it as
// mutating makes it unavailable in exactly the phase where a hard decision is
// most likely to need the panel.
describe('Council tool read-only classification', () => {
  it('declares itself read-only and concurrency-safe', () => {
    const council = createCesarToolRegistry('claude').get('Council');

    expect(council.definition.isReadOnly).toBe(true);
    expect(council.definition.isConcurrencySafe).toBe(true);
  });

  it('survives the investigation-phase read-only gate', async () => {
    const registry = createCesarToolRegistry('claude');

    const result = await executeToolCall(
      { id: 'c1', name: 'Council', input: { question: 'REST or GraphQL?' } },
      { cwd: process.cwd(), readOnlyMode: true, readFileState: new Map() } as any,
      registry,
    );

    expect(result.result.terminalReason).not.toBe('skipped_policy');
    expect(result.result.ok).toBe(true);
    expect(result.result.content).toContain('Council delegation accepted');
  });
});
