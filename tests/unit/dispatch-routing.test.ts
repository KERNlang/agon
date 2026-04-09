import { describe, it, expect } from 'vitest';
import { extractExecutionSpec } from '../../packages/cli/src/generated/signals/dispatch.js';

describe('Dispatch routing helpers', () => {
  it('extracts forge fitness commands from conversational input', () => {
    expect(extractExecutionSpec('fix login race test with npm test')).toEqual({
      task: 'fix login race',
      fitnessCmd: 'npm test',
    });
  });

  it('supports alternative fitness prefixes', () => {
    expect(extractExecutionSpec('add retries fitness: vitest run')).toEqual({
      task: 'add retries',
      fitnessCmd: 'vitest run',
    });
  });

  it('leaves plain conversational tasks untouched', () => {
    expect(extractExecutionSpec('fix login race')).toEqual({
      task: 'fix login race',
      fitnessCmd: null,
    });
  });
});
