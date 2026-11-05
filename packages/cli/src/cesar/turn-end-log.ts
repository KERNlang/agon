import { classifyApiFailure } from '@kernlang/agon-core';

import { hostNowMs } from '../lib/kern-host.js';

import type { CesarTurnOutcome } from '../handlers/types.js';

import { recordCesarToolTimeline, summarizeErrorForLog } from './tool-observability.js';

export type CesarTurnEndReason =
  | 'completed'
  | 'awaiting_user'
  | 'plan_proposed'
  | 'delegated'
  | 'delegation_cancelled'
  | 'steering_yield'
  | 'queued'
  | 'step_budget'
  | 'continuation_cap'
  | 'no_progress_checkpoint'
  | 'watchdog_timeout'
  | 'abort'
  | 'api_error'
  | 'read_spin_stop'
  | 'write_spin_stop'
  | 'stall_stop'
  | 'tool_circuit_breaker'
  | 'tool_loop_no_answer'
  | 'empty_turn'
  | 'follow_up_incomplete'
  | 'session_cleanup_failed'
  | 'setup_failed'
  | 'brain_threw';

export interface CesarTurnEndInput {
  outcome?: CesarTurnOutcome;
  threw?: boolean;
  aborted: boolean;
  sendCount: number;
  lastSendEnd?: string;
  continuationCapHit: boolean;
}

const DECISION_REASONS: Record<string, CesarTurnEndReason> = {
  'pre-stream-error': 'api_error',
  'stream-error': 'api_error',
  'plan-proposed': 'plan_proposed',
  'delegation-cancelled': 'delegation_cancelled',
  'suggestion-cancelled': 'delegation_cancelled',
  'session-cleanup-failed': 'session_cleanup_failed',
  'tool-loop-no-answer': 'tool_loop_no_answer',
  'tool-loop-self-challenge-no-answer': 'tool_loop_no_answer',
  'empty-turn': 'empty_turn',
  'interactive-follow-up-incomplete': 'follow_up_incomplete',
};

const SEND_ENDS: Record<string, CesarTurnEndReason> = {
  api_error: 'api_error',
  step_budget: 'step_budget',
  steering_yield: 'steering_yield',
  read_spin_stop: 'read_spin_stop',
  write_spin_stop: 'write_spin_stop',
  stall_stop: 'stall_stop',
  tool_circuit_breaker: 'tool_circuit_breaker',
};

export function classifyCesarTurnEnd(input: CesarTurnEndInput): CesarTurnEndReason {
  const outcome = input.outcome as (CesarTurnOutcome & { agenticTerminalReason?: string }) | undefined;
  if (outcome?.terminalState === 'timed_out') return 'watchdog_timeout';
  if (input.aborted || outcome?.terminalState === 'cancelled') return 'abort';
  if (input.threw || !outcome) return 'brain_threw';
  if (outcome.delegated) return 'delegated';
  const decided = DECISION_REASONS[outcome.decisionReason ?? ''];
  if (decided) return decided;
  if (outcome.agenticTerminalReason === 'no_progress') return 'no_progress_checkpoint';
  if (input.continuationCapHit || outcome.agenticTerminalReason === 'continuation_checkpoint') return 'continuation_cap';
  const sendEnd = SEND_ENDS[input.lastSendEnd ?? ''];
  if (sendEnd) return sendEnd;
  if (input.sendCount === 0) {
    if (outcome.terminalState === 'failed') return 'setup_failed';
    if (outcome.terminalState === undefined && outcome.decisionReason === undefined) return 'queued';
  }
  return outcome.awaitingUserInput ? 'awaiting_user' : 'completed';
}

export interface CesarTurnEndTracker {
  bindTelemetry(read: () => Record<string, unknown>): void;
  beginSend(): void;
  observe(chunk: { type?: string; content?: unknown; metadata?: Record<string, unknown> }): void;
  noteContinuationCap(): void;
  settle(outcome: CesarTurnOutcome, aborted: boolean): void;
  settleThrown(error: unknown, aborted: boolean): void;
}

/**
 * One `turn_end` line per Cesar turn in cesar-tool-timeline.jsonl. Observation only: it never changes a chunk or an outcome, and a logging failure never reaches the turn.
 */
export function createCesarTurnEndTracker(runsDir?: string): CesarTurnEndTracker {
  const startedAt = hostNowMs();
  let readTelemetry: () => Record<string, unknown> = () => ({});
  let sendCount = 0;
  let completedSteps = 0;
  let sendStep = 0;
  let budget: number | undefined;
  let lastSendEnd: string | undefined;
  let stepBudgetHits = 0;
  let errorCount = 0;
  let lastError: unknown;
  let continuationCapHit = false;
  let modelRetries = 0;
  let settled = false;

  const write = (input: Pick<CesarTurnEndInput, 'outcome' | 'threw' | 'aborted'>, thrown?: unknown): void => {
    if (settled) return;
    settled = true;
    try {
      const telemetry = { ...readTelemetry(), ...(input.outcome as Record<string, unknown> | undefined) };
      const endReason = classifyCesarTurnEnd({ ...input, sendCount, lastSendEnd, continuationCapHit });
      const errorSource = thrown ?? lastError;
      recordCesarToolTimeline({
        turnId: String(telemetry.turnId ?? 'unknown'),
        event: 'turn_end',
        engineId: typeof telemetry.cesarEngineId === 'string' ? telemetry.cesarEngineId : undefined,
        status: endReason,
        reason: typeof telemetry.decisionReason === 'string' ? telemetry.decisionReason : undefined,
        summary: {
          endReason,
          terminalState: telemetry.terminalState,
          agenticTerminalReason: telemetry.agenticTerminalReason,
          durationMs: hostNowMs() - startedAt,
          toolCount: telemetry.toolCount ?? 0,
          toolEventCount: telemetry.toolEventCount ?? 0,
          failedTools: telemetry.failedTools ?? 0,
          successfulMutations: telemetry.successfulMutations ?? 0,
          steps: completedSteps + sendStep,
          budget,
          sends: sendCount,
          stepBudgetHits,
          errorCount,
          modelRetries,
          errorKind: errorSource === undefined ? undefined : classifyApiFailure(errorSource).kind,
          error: errorSource === undefined ? undefined : summarizeErrorForLog(errorSource),
        },
      }, runsDir);
    } catch { /* observability must never block a turn */ }
  };

  return {
    bindTelemetry(read) { readTelemetry = read; },
    beginSend() {
      completedSteps += sendStep;
      sendStep = 0;
      sendCount++;
      lastSendEnd = undefined;
    },
    observe(chunk) {
      const metadata = chunk.metadata ?? {};
      if (chunk.type === 'status' && metadata.kind === 'loop-step') {
        sendStep = Math.max(sendStep, Number(metadata.step) || 0);
        budget = Number(metadata.budget) || budget;
      } else if (chunk.type === 'status' && metadata.kind === 'model-retry') {
        modelRetries = Math.max(modelRetries, Number(metadata.attempt) || 0);
      } else if (chunk.type === 'error') {
        errorCount++;
        lastError = chunk.content;
        lastSendEnd = typeof metadata.loopEnd === 'string' ? metadata.loopEnd : 'api_error';
      } else if (chunk.type === 'done' && typeof metadata.loopEnd === 'string') {
        lastSendEnd ??= metadata.loopEnd;
        if (metadata.loopEnd === 'step_budget') stepBudgetHits++;
      }
    },
    noteContinuationCap() { continuationCapHit = true; },
    settle(outcome, aborted) { write({ outcome, aborted }); },
    settleThrown(error, aborted) { write({ threw: true, aborted }, error); },
  };
}
