import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { clearConversation, loadConversation, loadSessionState, saveConversation, saveSessionState } from '@agon/core';
import { askChoiceQuestion, buildAgentAutoResumePrompt, buildBrainstormContinuationMessage, buildDelegatedContinuationPrompt, buildPlanCallbacks, buildReviewAbsorptionPrompt, clearPersistedSessionContext, collectRecentEngineContext, extractExecutionSpec, failedPlanStepIsFallbackRetryable, formatCesarPlanRuntimeStatus, formatCesarRecoveryStatus, handleProposedCesarPlan, isCesarPlanApprovalInput, isCesarPlanResumeInput, isCesarPlanStatusInput, isStrongCesarPlanApprovalInput, normalizeCesarActingFallbackMode, preparePlanFallbackRetry, runDelegatedJobThenContinue, shouldApprovePendingCesarPlanInput, shouldAutoContinueDelegatedResult, shouldAutoResumeAgentResult } from '../../packages/cli/src/generated/signals/dispatch.js';

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
    expect(isCesarPlanApprovalInput('ok go')).toBe(true);
    expect(isCesarPlanApprovalInput('go ahead')).toBe(true);
    expect(isCesarPlanApprovalInput('do so')).toBe(true);
    expect(isCesarPlanApprovalInput('run it')).toBe(true);
    expect(isCesarPlanApprovalInput('proceed!')).toBe(true);
    expect(isCesarPlanApprovalInput('change step 2')).toBe(false);
  });

  it('distinguishes strong approval phrases for hidden pending plan recovery', () => {
    expect(isStrongCesarPlanApprovalInput('ok go')).toBe(true);
    expect(isStrongCesarPlanApprovalInput('run it')).toBe(true);
    expect(isStrongCesarPlanApprovalInput('ok')).toBe(false);
    expect(isStrongCesarPlanApprovalInput('sure')).toBe(false);
  });

  it('recognizes resume and status phrases for active Cesar plans', () => {
    expect(isCesarPlanResumeInput('go wtf i said 3 times go')).toBe(true);
    expect(isCesarPlanResumeInput('continue')).toBe(true);
    expect(isCesarPlanResumeInput('ok do last part')).toBe(true);
    expect(isCesarPlanResumeInput('done?')).toBe(false);
    expect(isCesarPlanStatusInput('done?')).toBe(true);
    expect(isCesarPlanStatusInput('why stop?')).toBe(true);
    expect(isCesarPlanStatusInput('what yu do')).toBe(true);
    expect(isCesarPlanStatusInput('tell me a joke')).toBe(false);
  });

  it('formats persisted plan runtime status without asking Cesar to guess', () => {
    const status = formatCesarPlanRuntimeStatus({
      id: 'cplan-123456789',
      state: 'paused',
      intent: 'build telemetry',
      steps: [
        { id: 's1', state: 'done', description: 'write spec' },
        { id: 's2', state: 'pending', description: 'build dashboard' },
      ],
    } as any);

    expect(status).toContain('cplan-123456 is paused: 1/2 steps done');
    expect(status).toContain('Next: build dashboard');
    expect(status).toContain('Use /plan resume or say "go"');
  });

  it('surfaces plan self-steps as live tool events and a running gauge state', () => {
    const events: any[] = [];
    let activePlan: any = null;
    const callbacks = buildPlanCallbacks({
      id: 'cplan-live-tools',
      state: 'running',
      intent: 'build telemetry',
      steps: [
        {
          id: 's1',
          type: 'self',
          description: 'write telemetry poller',
          estimatedTokens: 1000,
          estimatedCostUsd: 0.01,
          state: 'pending',
        },
        {
          id: 's2',
          type: 'self',
          description: 'wire dashboard',
          estimatedTokens: 1000,
          estimatedCostUsd: 0.01,
          state: 'pending',
        },
      ],
      totalEstimatedTokens: 2000,
      totalEstimatedCostUsd: 0.02,
      totalActualTokens: 0,
      totalActualCostUsd: 0,
      stepContext: {},
      createdAt: new Date().toISOString(),
    } as any, {
      dispatch: (event: any) => events.push(event),
      setActivePlan: (plan: any) => { activePlan = plan; },
    } as any);

    callbacks.onStepStart('s1');

    expect(activePlan.steps[0].state).toBe('running');
    expect(events.some((event) => event.type === 'spinner-start' && event.message.includes('Step 1/2'))).toBe(true);
    const runningTool = events.find((event) => event.type === 'tool-call' && event.tool === 'PlanStep' && event.status === 'running');
    if (!runningTool) throw new Error('expected running PlanStep tool event');
    expect(JSON.parse(runningTool.input)).toMatchObject({
      planId: 'cplan-live-tools',
      stepId: 's1',
      step: 1,
      totalSteps: 2,
      description: 'write telemetry poller',
    });

    callbacks.onStepDone('s1', { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 1200, output: 'created poller' });

    expect(events.some((event) => event.type === 'spinner-stop')).toBe(true);
    const doneTool = events.find((event) => event.type === 'tool-call' && event.tool === 'PlanStep' && event.status === 'done');
    if (!doneTool) throw new Error('expected done PlanStep tool event');
    expect(doneTool.output).toBe('created poller');
  });

  it('approves natural text when a live plan is already pending', () => {
    const ctx = {
      activePlan: { state: 'awaiting_approval' },
    } as any;

    expect(shouldApprovePendingCesarPlanInput('ok', ctx)).toBe(true);
    expect(shouldApprovePendingCesarPlanInput('ok go', ctx)).toBe(true);
    expect(shouldApprovePendingCesarPlanInput('/approve', ctx)).toBe(false);
  });

  it('does not approve stale saved plans from natural text without a live pending plan', () => {
    const ctx = {
      activePlan: null,
      cesar: {},
    } as any;

    expect(shouldApprovePendingCesarPlanInput('ok go', ctx)).toBe(false);
  });

  it('dispatches choice questions with explicit numeric choices and a default', async () => {
    let event: any = null;
    const promise = askChoiceQuestion({
      dispatch: (next: any) => { event = next; },
    } as any, 'Approve plan?', [
      { key: '1', label: 'Yes - approve' },
      { key: '2', label: 'No - reject' },
      { key: '3', label: 'Other - add feedback' },
    ], '1');

    expect(event.type).toBe('question');
    expect(event.prompt).toBe('Approve plan?');
    expect(event.choices).toHaveLength(3);
    expect(event.choices.map((choice: any) => choice.key)).toEqual(['1', '2', '3']);
    expect(event.defaultChoiceKey).toBe('1');

    event.resolve('1');
    await expect(promise).resolves.toBe('1');
  });

  it('leaves manual Cesar plan approval to the normal composer instead of blocking on a question', async () => {
    const events: any[] = [];
    let activePlan: any = null;
    const proposed = {
      id: 'cplan-manual',
      state: 'awaiting_approval',
      intent: 'manual plan',
      steps: [
        { id: 's1', type: 'self', description: 'Do the work', state: 'pending', estimatedTokens: 1000, estimatedCostUsd: 0.01 },
      ],
      totalEstimatedTokens: 1000,
      totalEstimatedCostUsd: 0.01,
      totalActualTokens: 0,
      totalActualCostUsd: 0,
      stepContext: {},
      createdAt: new Date().toISOString(),
    } as any;

    await handleProposedCesarPlan(proposed, {
      ctx: { config: {}, cesar: { proposedPlan: proposed } },
      dispatch: (event: any) => events.push(event),
      setActivePlan: (plan: any) => { activePlan = plan; },
    } as any);

    expect(activePlan).toBe(proposed);
    expect(events.some((event) => event.type === 'question')).toBe(false);
    expect(events.some((event) => event.type === 'info' && String(event.message).includes('Plan awaiting approval'))).toBe(true);
  });

  it('prepares one retryable failed plan step on the fallback engine', () => {
    const plan = {
      id: 'cplan-fallback',
      state: 'paused',
      intent: 'fix',
      steps: [
        { id: 's1', type: 'forge', description: 'forge fix', state: 'failed', engines: ['claude'], result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 10, output: '', error: 'cancelled' } },
        { id: 's2', type: 'self', description: 'verify', state: 'pending' },
      ],
      totalEstimatedTokens: 0,
      totalEstimatedCostUsd: 0,
      totalActualTokens: 0,
      totalActualCostUsd: 0,
      stepContext: {},
      createdAt: new Date().toISOString(),
    } as any;

    expect(failedPlanStepIsFallbackRetryable(plan.steps[0])).toBe(true);
    const retry = preparePlanFallbackRetry(plan, 'codex') as any;

    expect(retry.state).toBe('running');
    expect(retry.steps[0]).toMatchObject({ state: 'pending', engine: 'codex', engines: ['codex'] });
    expect(retry.steps[0].result).toBeUndefined();
    expect(retry.fallbackRetriesUsed.s1).toBe(1);
    expect(preparePlanFallbackRetry(retry, 'gemini')).toBeNull();
  });

  it('formats compact Cesar recovery statuses with log context', () => {
    expect(formatCesarRecoveryStatus('rebuild', 'claude')).toBe('Cesar recovery: rebuilding claude session');
    expect(formatCesarRecoveryStatus('retry', 'kimi', 'log: /tmp/run')).toBe('Cesar recovery: retrying kimi with fresh dispatch - log: /tmp/run');
    expect(formatCesarRecoveryStatus('failed', 'all engines unavailable', 'run agon doctor engines')).toBe('Cesar recovery failed: all engines unavailable - run agon doctor engines');
  });

  it('normalizes acting-Cesar fallback policy with silent auto as default', () => {
    // Default flipped to 'auto' (silent under-the-hood swap) so the user
    // perceives a single Cesar persona instead of seeing rebuild/retry/
    // acting-Cesar chrome every time the configured engine misbehaves.
    expect(normalizeCesarActingFallbackMode(undefined)).toBe('auto');
    expect(normalizeCesarActingFallbackMode('auto')).toBe('auto');
    expect(normalizeCesarActingFallbackMode('always')).toBe('auto');
    expect(normalizeCesarActingFallbackMode('on')).toBe('auto');
    expect(normalizeCesarActingFallbackMode('ask')).toBe('ask');
    expect(normalizeCesarActingFallbackMode('prompt')).toBe('ask');
    expect(normalizeCesarActingFallbackMode('off')).toBe('off');
    expect(normalizeCesarActingFallbackMode('same-only')).toBe('off');
    expect(normalizeCesarActingFallbackMode('weird')).toBe('auto');
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

  it('clears persisted conversation and per-engine session context', () => {
    const previousHome = process.env.AGON_HOME;
    const testHome = mkdtempSync(join(tmpdir(), 'agon-clear-context-'));
    process.env.AGON_HOME = testHome;
    try {
      saveConversation([{ role: 'user', content: 'old workspace conversation' }], 'claude');
      saveSessionState('claude', { messageHistory: [{ role: 'user', content: 'old claude context' }], confidence: null });
      saveSessionState('gemini', { messageHistory: [{ role: 'user', content: 'old gemini context' }], confidence: null });
      saveSessionState('kimi', { messageHistory: [{ role: 'user', content: 'old kimi context' }], confidence: null });
      saveSessionState('qwen', { messageHistory: [{ role: 'user', content: 'old qwen context' }], confidence: null });

      const cleared = clearPersistedSessionContext({
        config: { cesarEngine: 'claude', forgeFixedStarter: 'kimi', forgeEnabledEngines: ['gemini'] },
        cesarSession: { engineId: 'opencode' },
        activeEngines: () => ['qwen'],
        registry: { availableIds: () => ['claude', 'gemini', 'opencode'] },
      } as any);

      expect(cleared).toEqual(['claude', 'gemini', 'kimi', 'opencode', 'qwen']);
      expect(loadConversation()).toBeNull();
      expect(loadSessionState('claude')).toBeNull();
      expect(loadSessionState('gemini')).toBeNull();
      expect(loadSessionState('kimi')).toBeNull();
      expect(loadSessionState('qwen')).toBeNull();
    } finally {
      try { clearConversation(); } catch {}
      if (previousHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousHome;
      rmSync(testHome, { recursive: true, force: true });
    }
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

  // runDelegatedJobThenContinue: the seam that makes every delegated mode
  // continue Cesar on BOTH the success and the throw path, with job-scoped
  // (not global) engine context. A mismatched epoch short-circuits the
  // continuation guard so these tests never reach the heavy routeWithCesar.
  it('continues with job-scoped context on success and excludes pre-existing engine messages', async () => {
    const events: any[] = [];
    const ctx = {
      inputEpoch: 1,
      chatSession: {
        messages: [
          { id: 'old-1', role: 'engine', engineId: 'claude', content: 'STALE answer from a prior job' },
        ],
      },
    } as any;
    const cb = { dispatch: (e: any) => events.push(e), ctx } as any;

    let seen: any;
    const out = await runDelegatedJobThenContinue(
      cb,
      async () => {
        ctx.chatSession.messages.push({ id: 'new-1', role: 'engine', engineId: 'gemini', content: 'FRESH job output' });
        return { winner: 'gemini' };
      },
      (info: any) => { seen = info; return `prompt: ${info.chatContext}`; },
      999, // mismatched epoch → continuation guard short-circuits
      1,
    );

    expect(out).toEqual({ winner: 'gemini' });
    expect(seen.success).toBe(true);
    expect(seen.result).toEqual({ winner: 'gemini' });
    expect(seen.chatContext).toContain('FRESH job output');
    expect(seen.chatContext).not.toContain('STALE answer'); // job-scoped, not global tail
    // continuation was attempted but guarded off (no routeWithCesar)
    expect(events.some((e) => typeof e.message === 'string' && e.message.includes('Skipped Cesar follow-up'))).toBe(true);
  });

  it('still continues (with success=false + errorMsg) when the delegated handler throws, then re-throws', async () => {
    const events: any[] = [];
    const ctx = { inputEpoch: 1, chatSession: { messages: [] } } as any;
    const cb = { dispatch: (e: any) => events.push(e), ctx } as any;

    let seen: any;
    await expect(
      runDelegatedJobThenContinue(
        cb,
        async () => { throw new Error('handler exploded'); },
        (info: any) => { seen = info; return `recover: ${info.errorMsg}`; },
        999,
        1,
      ),
    ).rejects.toThrow('handler exploded');

    expect(seen.success).toBe(false);
    expect(seen.errorMsg).toContain('handler exploded');
    // continuation fired even though the job failed → no dead-end
    expect(events.some((e) => typeof e.message === 'string' && e.message.includes('Skipped Cesar follow-up'))).toBe(true);
  });

  it('returning null from buildPrompt skips continuation entirely (no dead-end, no noise)', async () => {
    const events: any[] = [];
    const ctx = { inputEpoch: 1, chatSession: { messages: [] } } as any;
    const cb = { dispatch: (e: any) => events.push(e), ctx } as any;

    await runDelegatedJobThenContinue(cb, async () => undefined, () => null, 999, 1);

    expect(events.some((e) => typeof e.message === 'string' && e.message.includes('Skipped Cesar follow-up'))).toBe(false);
  });
});
