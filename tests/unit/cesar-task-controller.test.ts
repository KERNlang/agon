import { describe, expect, it } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/generated/models/handler-types.js';
import {
  buildAgenticAutoTurnDirective,
  buildAgenticProgressSignature,
  evaluateAgenticTaskState,
  extractAgenticBashCommand,
  isAgenticMutationOutcome,
  resolveCesarHarnessProfile,
  resolveCesarToolReadOnlyMode,
} from '../../packages/cli/src/generated/cesar/task-controller.js';

function context(overrides: {
  auto?: boolean;
  profile?: 'legacy' | 'agentic';
} = {}): HandlerContext {
  return {
    autoModeQueued: overrides.auto ?? false,
    config: { cesarAutoHarnessProfile: overrides.profile ?? 'agentic' },
    cesar: {},
  } as unknown as HandlerContext;
}

const baseSnapshot = {
  toolActivity: false,
  successfulMutations: 0,
  failedTools: 0,
  verificationRequired: false,
  verificationPassed: false,
  answerDelivered: false,
  awaitingUser: false,
};

describe('agentic Cesar task controller', () => {
  it('selects agentic only for AUTO and retains a legacy kill switch', () => {
    expect(resolveCesarHarnessProfile(context({ auto: true }))).toBe('agentic');
    expect(resolveCesarHarnessProfile(context({ auto: true, profile: 'legacy' }))).toBe('legacy');
    expect(resolveCesarHarnessProfile(context({ auto: false, profile: 'agentic' }))).toBe('legacy');
  });

  it('does not re-arm the investigation write gate in normal agentic AUTO', () => {
    expect(resolveCesarToolReadOnlyMode(true, false, false)).toBe(false);
    expect(resolveCesarToolReadOnlyMode(true, true, false)).toBe(true);
    expect(resolveCesarToolReadOnlyMode(true, false, true)).toBe(true);
    expect(resolveCesarToolReadOnlyMode(false, false, false)).toBe(true);
  });

  it('cannot complete a mutating task from prose without mutation evidence', () => {
    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      answerDelivered: true,
    })).toMatchObject({ state: 'running', continueWork: true, terminal: false });
  });

  it('requires discovered verification after a successful mutation', () => {
    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      toolActivity: true,
      successfulMutations: 1,
      verificationRequired: true,
      answerDelivered: true,
    })).toMatchObject({ state: 'verifying', continueWork: true, terminal: false });

    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      toolActivity: true,
      successfulMutations: 1,
      verificationRequired: true,
      verificationPassed: true,
      answerDelivered: true,
    })).toMatchObject({ state: 'verified', continueWork: false, terminal: true });
  });

  it('continues verified work when the model or checklist says more remains', () => {
    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      successfulMutations: 1,
      verificationRequired: true,
      verificationPassed: true,
      answerDelivered: true,
      continuationIntent: true,
    })).toMatchObject({ state: 'running', reason: 'model_reports_more_work' });

    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      successfulMutations: 1,
      verificationRequired: true,
      verificationPassed: true,
      answerDelivered: true,
      todosRemaining: true,
    })).toMatchObject({ state: 'running', reason: 'todos_remaining' });
  });

  it('treats delegation as a yield and terminates only after three structural no-progress cycles', () => {
    expect(evaluateAgenticTaskState({
      ...baseSnapshot,
      pendingDelegation: true,
      noProgressCycles: 99,
    })).toMatchObject({ state: 'waiting_on_delegation', terminal: false });

    expect(evaluateAgenticTaskState({ ...baseSnapshot, noProgressCycles: 2 })).toMatchObject({ state: 'running' });
    expect(evaluateAgenticTaskState({ ...baseSnapshot, noProgressCycles: 3 })).toMatchObject({
      state: 'blocked', terminal: true, reason: 'no_progress',
    });
  });

  it('tracks structural progress independently of narration', () => {
    const signature = buildAgenticProgressSignature({
      toolEventCount: 3,
      successfulMutations: 1,
      failedTools: 0,
      todoRevision: 2,
      verificationPassed: false,
      pendingDelegation: false,
    });
    expect(signature).toBe('3:1:0:2:0:0');
    const directive = buildAgenticAutoTurnDirective('fix the renderer');
    expect(directive).toContain('Latest objective:');
    expect(directive).toContain('fix the renderer');
  });

  it('counts typed file and shell mutations across tool transports', () => {
    expect(isAgenticMutationOutcome('Write', '{"file_path":"src/a.ts"}', 'done')).toBe(true);
    expect(isAgenticMutationOutcome('AgonEdit', '{"file_path":"src/a.ts"}', 'completed')).toBe(true);
    expect(isAgenticMutationOutcome('Bash', '{"command":"printf hi > src/a.txt"}', 'ok')).toBe(true);
    expect(isAgenticMutationOutcome('AgonBash', 'npm install zod', 'done')).toBe(true);
    expect(isAgenticMutationOutcome('Bash', '{"command":"npm test"}', 'done')).toBe(false);
    expect(isAgenticMutationOutcome('Write', '{"file_path":"src/a.ts"}', 'failed')).toBe(false);
    expect(extractAgenticBashCommand('{"command":"git status"}')).toBe('git status');
  });

  it('terminates a prose-only answer after one quiet continuation instead of blocking', () => {
    const proseAnswer = { ...baseSnapshot, answerDelivered: true };
    expect(evaluateAgenticTaskState({ ...proseAnswer, noProgressCycles: 0 }))
      .toMatchObject({ state: 'running', continueWork: true, terminal: false });
    expect(evaluateAgenticTaskState({ ...proseAnswer, noProgressCycles: 1 }))
      .toMatchObject({ state: 'verified', continueWork: false, terminal: true, reason: 'answer_delivered_without_tools' });
    expect(evaluateAgenticTaskState({ ...baseSnapshot, noProgressCycles: 3 }))
      .toMatchObject({ state: 'blocked', terminal: true, reason: 'no_progress' });
  });
});
