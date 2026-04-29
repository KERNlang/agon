import { describe, it, expect } from 'vitest';
import { buildAgentAutoResumePrompt, buildBrainstormContinuationMessage, buildDelegatedContinuationPrompt, buildReviewAbsorptionPrompt, collectRecentEngineContext, extractExecutionSpec, formatCesarRecoveryStatus, isCesarPlanApprovalInput, shouldAutoContinueDelegatedResult, shouldAutoResumeAgentResult } from '../../packages/cli/src/generated/signals/dispatch.js';

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

  it('recognizes natural Cesar plan approval replies', () => {
    expect(isCesarPlanApprovalInput('go')).toBe(true);
    expect(isCesarPlanApprovalInput('run it')).toBe(true);
    expect(isCesarPlanApprovalInput('proceed!')).toBe(true);
    expect(isCesarPlanApprovalInput('change step 2')).toBe(false);
  });

  it('formats compact Cesar recovery statuses with log context', () => {
    expect(formatCesarRecoveryStatus('rebuild', 'claude')).toBe('Cesar recovery: rebuilding claude session');
    expect(formatCesarRecoveryStatus('retry', 'kimi', 'log: /tmp/run')).toBe('Cesar recovery: retrying kimi with fresh dispatch - log: /tmp/run');
    expect(formatCesarRecoveryStatus('failed', 'all engines unavailable', 'run agon doctor engines')).toBe('Cesar recovery failed: all engines unavailable - run agon doctor engines');
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

  it('builds a delegated continuation prompt that tells Cesar to synthesize instead of rerunning the same mode', () => {
    const prompt = buildDelegatedContinuationPrompt('Campfire discussion on harness UX\n\n[claude]: make disagreement visible');

    expect(prompt).toContain('[DELEGATED RESULT]');
    expect(prompt).toContain('[CONTINUE]');
    expect(prompt).toContain('Do not re-run the same Brainstorm, Tribunal, Campfire, Review, Forge, or Agent');
    expect(prompt).toContain('synthesize the concrete outcome');
  });

  it('formats brainstorm winners as Cesar continuation work instead of terminal output', () => {
    const prompt = buildBrainstormContinuationMessage('Brainstorm complete', 'build engine telemetry', {
      winner: 'kimi',
      response: 'Use a telemetry service and dashboard.',
      bids: [
        { engineId: 'kimi', score: 114.25, reasoning: 'Best fit', approach: 'Implement in KERN' },
      ],
    });

    expect(prompt).toContain('Brainstorm complete. Winner: kimi.');
    expect(prompt).toContain('## Original User Request\nbuild engine telemetry');
    expect(prompt).toContain('**kimi** (score: 114.25): Best fit');
    expect(prompt).toContain('Cesar owns the final answer');
    expect(prompt).toContain('Do not stop at the brainstorm card');
  });

  it('collects recent engine context for post-delegation synthesis', () => {
    const ctx = {
      chatSession: {
        messages: [
          { role: 'user', content: 'question' },
          { role: 'engine', engineId: 'claude', content: 'first answer' },
          { role: 'engine', engineId: 'gemini', content: 'x'.repeat(20) },
        ],
      },
    } as any;

    const context = collectRecentEngineContext(ctx, 3, 5);

    expect(context).toContain('[claude]: first');
    expect(context).toContain('[gemini]: xxxxx');
    expect(context).not.toContain('question');
  });

  it('builds a review absorption prompt that gives Cesar the findings and fix-plan task', () => {
    const prompt = buildReviewAbsorptionPrompt('argon review with codex', {
      engineId: 'codex',
      target: 'main...dev',
      label: 'main...dev',
      diff: 'diff --git a/file.ts b/file.ts',
      reviewOutput: 'Finding: handleReview stores findings but Cesar never sees them.',
      timestamp: Date.now(),
    });

    expect(prompt).toContain('[REVIEW RESULT]');
    expect(prompt).toContain('Original user request: argon review with codex');
    expect(prompt).toContain('Review target: main...dev');
    expect(prompt).toContain('Review engine: codex');
    expect(prompt).toContain('Finding: handleReview stores findings but Cesar never sees them.');
    expect(prompt).toContain('concrete fix plan');
    expect(prompt).toContain('Do not say you lack the review output');
  });

  it('caps review absorption prompts so large reviews do not swamp Cesar context', () => {
    const prompt = buildReviewAbsorptionPrompt('review', {
      engineId: 'codex',
      target: '',
      label: '',
      diff: '',
      reviewOutput: 'x'.repeat(12_050),
      timestamp: Date.now(),
    });

    expect(prompt).toContain('... [review output truncated]');
    expect(prompt.length).toBeLessThan(12_700);
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

  it('continues delegated results only while the same user turn is active', () => {
    const ctx = {
      inputEpoch: 7,
      chatSession: {
        messages: [
          { role: 'user', content: 'ask campfire' },
          { role: 'engine', content: 'delegating' },
        ],
      },
    } as any;

    expect(shouldAutoContinueDelegatedResult(7, 1, ctx)).toBe(true);
    expect(shouldAutoContinueDelegatedResult(8, 1, ctx)).toBe(false);
    expect(shouldAutoContinueDelegatedResult(7, 2, ctx)).toBe(false);
    expect(shouldAutoContinueDelegatedResult(undefined, undefined, ctx)).toBe(true);
  });
});
