// @kern-source: agent-state:34
import type { AgentBudget, AgentStepResult } from './agent-session.js';

// @kern-source: agent-state:38
export interface AgentMessage {
  role: 'system'|'user'|'assistant'|'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}

// @kern-source: agent-state:47
export interface AgentTurn {
  index: number;
  userPrompt: string;
  assistantResponse: string;
  toolCalls: number;
  innerSteps: number;
  tokensUsed: number;
  costUsd: number;
  startedAt: number;
  completedAt: number;
  outcome: 'completed'|'cancelled'|'failed';
  error?: string;
}

// @kern-source: agent-state:62
export interface AgentContext {
  engineId: string;
  systemPrompt?: string;
  budget: AgentBudget;
  startedAt: number;
  history: AgentMessage[];
  turns: AgentTurn[];
  cumulativeTokens: number;
  cumulativeToolCalls: number;
  cumulativeCostUsd: number;
}

// @kern-source: agent-state:75
export type AgentPhase =
  | { kind: 'idle' }
  | { kind: 'running'; turnIndex: number; turnStartedAt: number }
  | { kind: 'awaiting_approval'; turnIndex: number; pendingToolName: string; pendingToolInput: Record<string,unknown>; pendingToolCallId: string }
  | { kind: 'completed'; finalResponse: string }
  | { kind: 'failed'; reason: 'budget_turns'|'budget_tokens'|'budget_duration'|'error'|'rejected'; errorMessage?: string }
  | { kind: 'cancelled'; reason: string };

// @kern-source: agent-state:95
export interface AgentState {
  context: AgentContext;
  phase: AgentPhase;
}

// @kern-source: agent-state:101
/**
 * Create a fresh agent state in 'idle' phase with empty history.
 */
export function createAgentState(engineId: string, budget: AgentBudget, systemPrompt?: string, now?: number): AgentState {
  const startedAt = now ?? Date.now();
  const history: AgentMessage[] = [];
  if (systemPrompt) {
    history.push({ role: 'system', content: systemPrompt, timestamp: startedAt });
  }
  return {
    context: {
      engineId,
      systemPrompt,
      budget,
      startedAt,
      history,
      turns: [],
      cumulativeTokens: 0,
      cumulativeToolCalls: 0,
      cumulativeCostUsd: 0,
    },
    phase: { kind: 'idle' },
  };
}

// @kern-source: agent-state:125
/**
 * Transition idle → running. Appends the user message to history. No-op if already terminal.
 */
export function beginTurn(state: AgentState, userPrompt: string, now?: number): AgentState {
  if (state.phase.kind === 'completed' || state.phase.kind === 'failed' || state.phase.kind === 'cancelled') {
    return state;
  }
  if (state.phase.kind !== 'idle') {
    // Already running/awaiting — callers should not call beginTurn in these phases.
    return state;
  }
  const timestamp = now ?? Date.now();
  const turnIndex = state.context.turns.length;
  const nextHistory: AgentMessage[] = [
    ...state.context.history,
    { role: 'user', content: userPrompt, timestamp },
  ];
  return {
    context: { ...state.context, history: nextHistory },
    phase: { kind: 'running', turnIndex, turnStartedAt: timestamp },
  };
}

// @kern-source: agent-state:147
/**
 * Transition running → idle on a completed step. Appends assistant message, records the turn, updates cumulative stats.
 */
export function completeTurn(state: AgentState, userPrompt: string, result: AgentStepResult, now?: number): AgentState {
  if (state.phase.kind !== 'running') return state;
  const completedAt = now ?? Date.now();
  const turn: AgentTurn = {
    index: state.phase.turnIndex,
    userPrompt,
    assistantResponse: result.response,
    toolCalls: result.toolCalls,
    innerSteps: result.innerSteps,
    tokensUsed: result.tokensUsed,
    costUsd: result.costUsd,
    startedAt: state.phase.turnStartedAt,
    completedAt,
    outcome: result.stopReason === 'completed' ? 'completed' : (result.stopReason === 'cancelled' ? 'cancelled' : 'failed'),
    error: result.error,
  };
  const nextHistory: AgentMessage[] = result.response
    ? [...state.context.history, { role: 'assistant', content: result.response, timestamp: completedAt }]
    : state.context.history;
  const nextContext: AgentContext = {
    ...state.context,
    history: nextHistory,
    turns: [...state.context.turns, turn],
    cumulativeTokens: state.context.cumulativeTokens + result.tokensUsed,
    cumulativeToolCalls: state.context.cumulativeToolCalls + result.toolCalls,
    cumulativeCostUsd: state.context.cumulativeCostUsd + result.costUsd,
  };
  // If the inner step reported cancelled/error/budget_exceeded, surface that as a terminal phase.
  if (result.stopReason === 'cancelled') {
    return { context: nextContext, phase: { kind: 'cancelled', reason: result.error ?? 'cancelled mid-turn' } };
  }
  if (result.stopReason === 'error') {
    return { context: nextContext, phase: { kind: 'failed', reason: 'error', errorMessage: result.error } };
  }
  if (result.stopReason === 'budget_exceeded') {
    const kind = (result.error ?? '').includes('Turn') ? 'budget_turns'
               : (result.error ?? '').includes('Token') ? 'budget_tokens'
               : 'budget_duration';
    return { context: nextContext, phase: { kind: 'failed', reason: kind, errorMessage: result.error } };
  }
  return { context: nextContext, phase: { kind: 'idle' } };
}

// @kern-source: agent-state:192
/**
 * Transition running → awaiting_approval. Caller (Phase 4 handler) resumes via approveTool/rejectTool.
 */
export function requestApproval(state: AgentState, toolName: string, toolInput: Record<string,unknown>, toolCallId: string): AgentState {
  if (state.phase.kind !== 'running') return state;
  return {
    context: state.context,
    phase: {
      kind: 'awaiting_approval',
      turnIndex: state.phase.turnIndex,
      pendingToolName: toolName,
      pendingToolInput: toolInput,
      pendingToolCallId: toolCallId,
    },
  };
}

// @kern-source: agent-state:208
/**
 * Transition awaiting_approval → running. Tool call proceeds.
 */
export function approveTool(state: AgentState, now?: number): AgentState {
  if (state.phase.kind !== 'awaiting_approval') return state;
  const turnStartedAt = now ?? Date.now();
  return {
    context: state.context,
    phase: { kind: 'running', turnIndex: state.phase.turnIndex, turnStartedAt },
  };
}

// @kern-source: agent-state:219
/**
 * Transition awaiting_approval → running. Tool call rejected; caller should feed the refusal back to the model.
 */
export function rejectTool(state: AgentState, reason: string, now?: number): AgentState {
  if (state.phase.kind !== 'awaiting_approval') return state;
  const turnStartedAt = now ?? Date.now();
  const timestamp = turnStartedAt;
  const refusal: AgentMessage = {
    role: 'tool',
    content: `Tool rejected by user: ${reason}`,
    toolCallId: state.phase.pendingToolCallId,
    toolName: state.phase.pendingToolName,
    timestamp,
  };
  return {
    context: { ...state.context, history: [...state.context.history, refusal] },
    phase: { kind: 'running', turnIndex: state.phase.turnIndex, turnStartedAt },
  };
}

// @kern-source: agent-state:238
/**
 * Transition any non-terminal phase → cancelled. Idempotent over terminal phases.
 */
export function cancelAgent(state: AgentState, reason: string): AgentState {
  if (state.phase.kind === 'completed' || state.phase.kind === 'failed' || state.phase.kind === 'cancelled') {
    return state;
  }
  return { context: state.context, phase: { kind: 'cancelled', reason } };
}

// @kern-source: agent-state:247
/**
 * Transition any non-terminal phase → failed.
 */
export function failAgent(state: AgentState, reason: 'budget_turns'|'budget_tokens'|'budget_duration'|'error'|'rejected', errorMessage?: string): AgentState {
  if (state.phase.kind === 'completed' || state.phase.kind === 'failed' || state.phase.kind === 'cancelled') {
    return state;
  }
  return { context: state.context, phase: { kind: 'failed', reason, errorMessage } };
}

// @kern-source: agent-state:256
/**
 * Transition idle → completed. Terminal success state.
 */
export function completeAgent(state: AgentState, finalResponse: string): AgentState {
  if (state.phase.kind !== 'idle') return state;
  return { context: state.context, phase: { kind: 'completed', finalResponse } };
}

// @kern-source: agent-state:263
/**
 * Returns a new failed state if any budget is exhausted, or null if the state is still within budget. Pure — does not mutate.
 */
export function checkBudget(state: AgentState, now?: number): AgentState|null {
  if (state.phase.kind === 'completed' || state.phase.kind === 'failed' || state.phase.kind === 'cancelled') {
    return null;
  }
  const budget = state.context.budget;
  if (state.context.turns.length >= budget.maxTurns) {
    return { context: state.context, phase: { kind: 'failed', reason: 'budget_turns', errorMessage: `Turn budget exceeded: ${state.context.turns.length}/${budget.maxTurns}` } };
  }
  if (budget.maxTokens != null && state.context.cumulativeTokens >= budget.maxTokens) {
    return { context: state.context, phase: { kind: 'failed', reason: 'budget_tokens', errorMessage: `Token budget exceeded: ${state.context.cumulativeTokens}/${budget.maxTokens}` } };
  }
  const elapsed = (now ?? Date.now()) - state.context.startedAt;
  if (elapsed >= budget.maxDurationMs) {
    return { context: state.context, phase: { kind: 'failed', reason: 'budget_duration', errorMessage: `Duration budget exceeded: ${elapsed}ms/${budget.maxDurationMs}ms` } };
  }
  return null;
}

// @kern-source: agent-state:283
/**
 * True if the state is in a terminal phase (completed/failed/cancelled).
 */
export function isTerminal(state: AgentState): boolean {
  return state.phase.kind === 'completed' || state.phase.kind === 'failed' || state.phase.kind === 'cancelled';
}

