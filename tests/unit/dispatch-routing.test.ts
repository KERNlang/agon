import { describe, it, expect } from 'vitest';
import { buildAgentAutoResumePrompt, extractExecutionSpec, shouldAutoResumeAgentResult } from '../../packages/cli/src/generated/signals/dispatch.js';

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

  it('builds an auto-resume prompt for team-agent results with unapplied patch context', () => {
    const prompt = buildAgentAutoResumePrompt('fix the compiler output', {
      kind: 'team-agent',
      status: 'completed',
      taskKind: 'edit',
      patchPath: '/tmp/team-agent-123/winner.patch',
      summary: '[team-agent] "fix the compiler output" — completed',
    });
    expect(prompt).toContain('Do not ask the user what happened');
    expect(prompt).toContain('/tmp/team-agent-123/winner.patch');
    expect(prompt).toContain('not applied to the main workspace yet');
  });

  it('resumes only when the same user turn is still active', () => {
    const ctx = {
      inputEpoch: 4,
      chatSession: {
        messages: [
          { role: 'user', content: 'fix it' },
          { role: 'engine', content: 'delegating' },
        ],
      },
    } as any;
    expect(shouldAutoResumeAgentResult({ status: 'completed' }, 4, 1, ctx)).toBe(true);
    expect(shouldAutoResumeAgentResult({ status: 'completed' }, 5, 1, ctx)).toBe(false);
    expect(shouldAutoResumeAgentResult({ status: 'completed' }, 4, 2, ctx)).toBe(false);
    expect(shouldAutoResumeAgentResult({ status: 'cancelled' }, 4, 1, ctx)).toBe(false);
  });
});
