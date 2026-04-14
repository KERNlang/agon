// @kern-source: agent-session:16
import { runApiAgentLoop } from '../api/agent-loop.js';

// @kern-source: agent-session:17
import type { ApiAgentOptions, ApiAgentResult } from '../api/agent-loop.js';

// @kern-source: agent-session:18
import type { ApiConfig } from '../api/dispatch.js';

// @kern-source: agent-session:19
import { estimateTokens, estimateCost } from '../signals/token-tracker.js';

// @kern-source: agent-session:20
import type { AgentEvent } from '../models/agent-event.js';

// @kern-source: agent-session:21
import { makeAssistantChunk, makeToolCall } from '../models/agent-event.js';

// @kern-source: agent-session:25
export interface AgentBudget {
  maxTurns: number;
  maxTokens?: number;
  maxDurationMs: number;
}

// @kern-source: agent-session:32
export interface AgentStepResult {
  response: string;
  toolCalls: number;
  innerSteps: number;
  tokensUsed: number;
  costUsd: number;
  stopReason: 'completed'|'budget_exceeded'|'cancelled'|'error';
  error?: string;
}

// @kern-source: agent-session:43
export interface AgentSessionStats {
  turnsUsed: number;
  turnsRemaining: number;
  tokensUsed: number;
  tokensRemaining: number|null;
  totalToolCalls: number;
  totalCostUsd: number;
  elapsedMs: number;
  durationRemainingMs: number;
  state: 'idle'|'running'|'completed'|'cancelled'|'failed';
}

// @kern-source: agent-session:56
export interface AgentSessionConfig {
  engineId: string;
  api: ApiConfig;
  cwd: string;
  systemPrompt?: string;
  budget: AgentBudget;
  perStepTimeoutSec?: number;
  maxInnerSteps?: number;
}

// @kern-source: agent-session:67
/**
 * Create a typed budget-exceeded error. Kind is attached to error.name for structural matching.
 */
export function makeBudgetError(kind: 'turns'|'tokens'|'duration', detail: string): Error {
  const err = new Error(`Agent budget exceeded: ${kind} — ${detail}`);
  err.name = `AgentBudget${kind.charAt(0).toUpperCase() + kind.slice(1)}Exceeded`;
  return err;
}

// @kern-source: agent-session:77
/**
 * Stateful agent invocation wrapper with budget enforcement and abort. Phase 1: API engines only.
 */
export class AgentSession {
  private config: AgentSessionConfig;
  private turnsUsed: number = 0;
  private tokensUsed: number = 0;
  private totalToolCalls: number = 0;
  private totalCostUsd: number = 0;
  private startedAt: number = 0;
  private state: 'idle'|'running'|'completed'|'cancelled'|'failed' = 'idle';
  private abortController: AbortController;

  constructor(config: AgentSessionConfig) {
    this.config = config;
    this.turnsUsed = 0;
    this.tokensUsed = 0;
    this.totalToolCalls = 0;
    this.totalCostUsd = 0;
    this.startedAt = Date.now();
    this.state = 'idle';
    this.abortController = new AbortController();
  }

  async step(prompt: string, opts?: {onEvent?:(event:AgentEvent)=>void}): Promise<AgentStepResult> {
    // ── Pre-step budget check ─────────────────────────────────
    if (this.state === 'cancelled') {
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'cancelled',
        error: 'Session was cancelled',
      };
    }
    if (this.state === 'completed' || this.state === 'failed') {
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'error',
        error: `Session is in terminal state: ${this.state}`,
      };
    }
    
    const budget = this.config.budget;
    
    if (this.turnsUsed >= budget.maxTurns) {
      this.state = 'failed';
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'budget_exceeded',
        error: `Turn budget exceeded: ${this.turnsUsed}/${budget.maxTurns}`,
      };
    }
    
    if (budget.maxTokens != null && this.tokensUsed >= budget.maxTokens) {
      this.state = 'failed';
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'budget_exceeded',
        error: `Token budget exceeded: ${this.tokensUsed}/${budget.maxTokens}`,
      };
    }
    
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= budget.maxDurationMs) {
      this.state = 'failed';
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'budget_exceeded',
        error: `Duration budget exceeded: ${elapsed}ms/${budget.maxDurationMs}ms`,
      };
    }
    
    // ── Refuse to start a step we can't finish in budget ─────
    // runApiAgentLoop has a hardcoded 30s floor (agent-loop.kern:143).
    // If we started a step with <30s remaining, we'd let that floor
    // silently override our duration budget. Instead, fail fast.
    const remainingMs = budget.maxDurationMs - elapsed;
    const MIN_STEP_MS = 30_000;
    if (remainingMs < MIN_STEP_MS) {
      this.state = 'failed';
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: 0,
        costUsd: 0,
        stopReason: 'budget_exceeded',
        error: `Duration budget too small to start step: ${remainingMs}ms remaining, ${MIN_STEP_MS}ms minimum`,
      };
    }
    
    // ── Run the inner loop ────────────────────────────────────
    this.state = 'running';
    const perStepSec = this.config.perStepTimeoutSec ?? Math.floor(remainingMs / 1000);
    const timeoutSec = Math.min(perStepSec, Math.floor(remainingMs / 1000));
    
    // Phase 1: Token usage is ESTIMATED (source='estimated' in TokenTracker terms).
    // Phase 3 will wire real SDK usage once dispatch.kern:390-402 capturedParts
    // are normalized through the canonical AgentEvent surface.
    const promptTokens = estimateTokens(prompt);
    
    const onEvent = opts?.onEvent;
    const innerOpts: ApiAgentOptions = {
      api: this.config.api,
      prompt,
      systemPrompt: this.config.systemPrompt,
      cwd: this.config.cwd,
      timeout: timeoutSec,
      signal: this.abortController.signal,
      maxSteps: this.config.maxInnerSteps,
      onChunk: onEvent ? (text: string) => onEvent(makeAssistantChunk(this.config.engineId, text)) : undefined,
      onToolCall: onEvent ? (name: string, args: Record<string,unknown>) => onEvent(makeToolCall(this.config.engineId, name, 'running', { input: args })) : undefined,
    };
    
    let result: ApiAgentResult;
    try {
      result = await runApiAgentLoop(innerOpts);
    } catch (err: any) {
      // Distinguish abort from other errors
      if (this.abortController.signal.aborted || err?.name === 'AbortError') {
        this.state = 'cancelled';
        return {
          response: '',
          toolCalls: 0,
          innerSteps: 0,
          tokensUsed: promptTokens,
          costUsd: 0,
          stopReason: 'cancelled',
          error: 'Aborted by caller',
        };
      }
      this.state = 'failed';
      return {
        response: '',
        toolCalls: 0,
        innerSteps: 0,
        tokensUsed: promptTokens,
        costUsd: 0,
        stopReason: 'error',
        error: err?.message ?? String(err),
      };
    }
    
    // If abort fired mid-stream, runApiAgentLoop may have returned a partial
    // response without throwing. Detect that here.
    if (this.abortController.signal.aborted) {
      this.state = 'cancelled';
      const partialResponseTokens = estimateTokens(result.response ?? '');
      const partialTotal = promptTokens + partialResponseTokens;
      this.turnsUsed += 1;
      this.tokensUsed += partialTotal;
      this.totalToolCalls += result.toolCalls;
      this.totalCostUsd += estimateCost(this.config.engineId, partialTotal, this.config.api.model);
      return {
        response: result.response,
        toolCalls: result.toolCalls,
        innerSteps: result.steps,
        tokensUsed: partialTotal,
        costUsd: estimateCost(this.config.engineId, partialTotal, this.config.api.model),
        stopReason: 'cancelled',
      };
    }
    
    // ── Accumulate stats ──────────────────────────────────────
    const responseTokens = estimateTokens(result.response);
    const stepTokens = promptTokens + responseTokens;
    const stepCost = estimateCost(this.config.engineId, stepTokens, this.config.api.model);
    
    this.turnsUsed += 1;
    this.tokensUsed += stepTokens;
    this.totalToolCalls += result.toolCalls;
    this.totalCostUsd += stepCost;
    
    // ── Post-step budget enforcement (tokens + duration only) ─
    // Turns are a discrete cap that the pre-check already enforces (N steps
    // are allowed when maxTurns=N; the (N+1)-th is refused). But TOKENS and
    // DURATION can overrun mid-step — the inner loop already ran and used
    // real resources we can't undo. When runAgentMode calls step() only once
    // per /agent invocation, the pre-check on the next call will never fire,
    // so maxTokens / maxDurationMs become advisory unless we also check
    // AFTER accumulation. The step's work is preserved in `response`; we
    // transition state to 'failed' so any future step() calls are blocked,
    // and return stopReason='budget_exceeded' so the caller knows what
    // happened. (Fix for Codex review P1 on agent-session.kern:248-250.)
    const postElapsed = Date.now() - this.startedAt;
    let overrunReason: string | null = null;
    if (budget.maxTokens != null && this.tokensUsed > budget.maxTokens) {
      overrunReason = `Token budget overrun: ${this.tokensUsed}/${budget.maxTokens} (step added ${stepTokens})`;
    } else if (postElapsed > budget.maxDurationMs) {
      overrunReason = `Duration budget overrun: ${postElapsed}ms/${budget.maxDurationMs}ms`;
    }
    
    if (overrunReason) {
      this.state = 'failed';
      return {
        response: result.response,
        toolCalls: result.toolCalls,
        innerSteps: result.steps,
        tokensUsed: stepTokens,
        costUsd: stepCost,
        stopReason: 'budget_exceeded',
        error: overrunReason,
      };
    }
    
    this.state = 'idle';
    return {
      response: result.response,
      toolCalls: result.toolCalls,
      innerSteps: result.steps,
      tokensUsed: stepTokens,
      costUsd: stepCost,
      stopReason: 'completed',
    };
  }

  cancel(): void {
    if (this.state === 'completed' || this.state === 'failed') return;
    this.state = 'cancelled';
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  complete(): void {
    if (this.state === 'cancelled' || this.state === 'failed') return;
    this.state = 'completed';
  }

  getStats(): AgentSessionStats {
    const budget = this.config.budget;
    const elapsed = Date.now() - this.startedAt;
    return {
      turnsUsed: this.turnsUsed,
      turnsRemaining: Math.max(0, budget.maxTurns - this.turnsUsed),
      tokensUsed: this.tokensUsed,
      tokensRemaining: budget.maxTokens != null ? Math.max(0, budget.maxTokens - this.tokensUsed) : null,
      totalToolCalls: this.totalToolCalls,
      totalCostUsd: this.totalCostUsd,
      elapsedMs: elapsed,
      durationRemainingMs: Math.max(0, budget.maxDurationMs - elapsed),
      state: this.state,
    };
  }

  getSignal(): AbortSignal {
    return this.abortController.signal;
  }
}

