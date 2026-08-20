import { describe, expect, it } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/models/handler-types.js';
import {
  buildAgenticAutoTurnDirective,
  buildAgenticProgressSignature,
  evaluateAgenticTaskState,
  extractAgenticBashCommand,
  isAgenticMutationOutcome,
  isSubstantiveAnswerText,
  resolveCesarHarnessProfile,
  resolveCesarToolReadOnlyMode,
} from '../../packages/cli/src/cesar/task-controller.js';

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
      novelStepCount: 3,
      successfulMutations: 1,
      failedTools: 0,
      todoRevision: 2,
      verificationPassed: false,
      pendingDelegation: false,
    });
    expect(signature).toBe('3:1:0:2:0:0:0');
    const directive = buildAgenticAutoTurnDirective('fix the renderer');
    expect(directive).toContain('Latest objective:');
    expect(directive).toContain('fix the renderer');
  });

  it('counts NOVELTY, not raw tool events — a round of pure re-reads is not progress', () => {
    const round = (novelStepCount: number, substantiveAnswerSeen = false) => buildAgenticProgressSignature({
      novelStepCount,
      successfulMutations: 0,
      failedTools: 0,
      todoRevision: 0,
      verificationPassed: false,
      pendingDelegation: false,
      substantiveAnswerSeen,
    });

    // Two continuation rounds that only re-read files already seen: the novel
    // step count is unchanged, so the signature repeats and a strike accrues.
    expect(round(12)).toBe(round(12));
    // One genuinely new file read → different signature → progress.
    expect(round(13)).not.toBe(round(12));
    // An investigate round that finally delivers a substantive answer counts as
    // progress even with zero new tool work.
    expect(round(12, true)).not.toBe(round(12, false));
    expect(round(12, true)).toBe('12:0:0:0:0:0:1');
  });

  // ── The substantive-answer bit is a LATCH, not a per-round measurement ──
  // A per-round "was this text long enough" flag flips back and forth as
  // narration length varies, so alternating rounds would read as progress
  // forever and the 3-strike checkpoint could never fire on a stalled turn
  // (codex #5 / minimax #6). The caller latches it; these two tests pin both
  // halves of that contract.
  it('flips the substantive-answer bit at most ONCE per turn (monotonic latch)', () => {
    const sig = (seen: boolean) => buildAgenticProgressSignature({
      novelStepCount: 7,
      successfulMutations: 0,
      failedTools: 0,
      todoRevision: 0,
      verificationPassed: false,
      pendingDelegation: false,
      substantiveAnswerSeen: seen,
    });

    // Simulate the brain's latch over rounds of alternating narration lengths
    // and zero new tool work — the shape that used to fake endless progress.
    let seen = false;
    const rounds = ['x'.repeat(200), 'short', 'y'.repeat(300), 'tiny'];
    const signatures = rounds.map((text) => {
      if (isSubstantiveAnswerText(text)) seen = true;
      return sig(seen);
    });
    // First round flips it (a real answer was delivered → progress once); every
    // later round is identical, so strikes accrue exactly as they should.
    expect(signatures[0]).not.toBe(sig(false));
    expect(new Set(signatures).size).toBe(1);
  });

  it('isSubstantiveAnswerText gates the latch on cleaned text length', () => {
    expect(isSubstantiveAnswerText(undefined)).toBe(false);
    expect(isSubstantiveAnswerText('')).toBe(false);
    expect(isSubstantiveAnswerText('   ')).toBe(false);
    expect(isSubstantiveAnswerText('Working on it…')).toBe(false);
    expect(isSubstantiveAnswerText('a'.repeat(80))).toBe(false);
    expect(isSubstantiveAnswerText('a'.repeat(81))).toBe(true);
    // Whitespace padding cannot buy substance.
    expect(isSubstantiveAnswerText(`${' '.repeat(200)}nope${' '.repeat(200)}`)).toBe(false);
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
