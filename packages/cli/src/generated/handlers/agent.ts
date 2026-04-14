// @kern-source: agent:17
import { AgentSession, createAgentState, beginTurn, completeTurn, cancelAgent, completeAgent, failAgent, checkBudget, isTerminal, resolveWorkingDir } from '@agon/core';

// @kern-source: agent:18
import type { AgentBudget, AgentState, AgentStepResult, AgentEvent } from '@agon/core';

// @kern-source: agent:19
import type { Dispatch, HandlerContext } from '../../handlers/types.js';

// @kern-source: agent:21
export interface RunAgentOptions {
  engineId?: string;
  maxTurns?: number;
  maxDurationMs?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// @kern-source: agent:28
/**
 * Run one autonomous agent invocation. Creates a session, calls session.step() once (which internally loops up to maxInnerSteps tool calls), emits OutputEvents throughout, handles Ctrl+C via the KERN-generated abort signal bridged to session.cancel().
 */
export async function runAgentMode(input: string, dispatch: Dispatch, ctx: HandlerContext, opts?: RunAgentOptions): Promise<void> {
  const abort = new AbortController();
  // ── Resolve engine ─────────────────────────────────────────
  // Phase 1 scope: agent mode requires an API engine. If the caller
  // specified an engine, use that. Otherwise pick the FIRST active
  // engine that has an api config — don't just default to index 0,
  // since mixed setups commonly have CLI-only engines ahead of API
  // engines in the active list, and forcing users to reorder them
  // to unblock /agent is bad UX (Codex review, P2 #4).
  const available = ctx.activeEngines();
  if (available.length === 0) {
    dispatch({ type: 'error', message: 'No engines available for agent mode.' });
    return;
  }
  
  let engineId: string | null = null;
  let engine: any = null;
  
  if (opts?.engineId) {
    // Caller explicitly picked an engine — use it, no search.
    if (!available.includes(opts.engineId)) {
      dispatch({ type: 'error', message: `${opts.engineId} is not available. Active: ${available.join(', ')}` });
      return;
    }
    try {
      engine = ctx.registry.get(opts.engineId);
      engineId = opts.engineId;
    } catch (err) {
      dispatch({ type: 'error', message: `${opts.engineId}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (!engine.api) {
      dispatch({
        type: 'error',
        message: `Agent mode requires an API engine; ${engineId} has no API config. (CLI-binary agent mode lands in a follow-up.)`,
      });
      return;
    }
  } else {
    // No engine specified — find the first active API engine.
    for (const id of available) {
      try {
        const candidate = ctx.registry.get(id);
        if (candidate.api) {
          engine = candidate;
          engineId = id;
          break;
        }
      } catch { /* skip unresolvable engines */ }
    }
    if (!engine || !engineId) {
      dispatch({
        type: 'error',
        message: `Agent mode requires an API engine, and none of the active engines have an API config. Active: ${available.join(', ')}. (CLI-binary agent mode lands in a follow-up.)`,
      });
      return;
    }
  }
  
  // ── Build session config ───────────────────────────────────
  const budget: AgentBudget = {
    maxTurns: opts?.maxTurns ?? 10,
    maxDurationMs: opts?.maxDurationMs ?? 600_000,
    maxTokens: opts?.maxTokens,
  };
  const cwd = resolveWorkingDir();
  
  const session = new AgentSession({
    engineId,
    api: engine.api,
    cwd,
    systemPrompt: opts?.systemPrompt,
    budget,
  });
  
  // Bridge the handler's KERN-generated abort to the session.
  // If abort fired before we got here, cancel immediately.
  if (abort.signal.aborted) {
    session.cancel();
  }
  const onAbort = () => session.cancel();
  abort.signal.addEventListener('abort', onAbort);
  
  // Register the abort controller with the CLI so Ctrl+C reaches it.
  ctx.setActiveAbort(abort);
  
  // ── Initialize event-sourced state ─────────────────────────
  let state: AgentState = createAgentState(engineId, budget, opts?.systemPrompt);
  
  try {
    // Pre-step budget check — surface budget exhaustion before we
    // even spin up the inner loop, with a typed warning.
    const blocked = checkBudget(state);
    if (blocked) {
      state = blocked;
      if (state.phase.kind === 'failed') {
        dispatch({
          type: 'agent-budget-warning',
          engineId,
          kind: state.phase.reason === 'budget_turns' ? 'turns'
              : state.phase.reason === 'budget_tokens' ? 'tokens'
              : 'duration',
          used: 0,
          limit: budget.maxTurns,
          remaining: 0,
        });
        dispatch({ type: 'error', message: state.phase.errorMessage ?? 'budget exceeded before start' });
      }
      return;
    }
  
    // Transition idle → running and emit step-start with budget context
    // so the UI can render budget bars before the first turn-summary.
    state = beginTurn(state, input);
    dispatch({
      type: 'agent-step-start',
      engineId,
      turnIndex: 0,
      userPrompt: input,
      maxTurns: budget.maxTurns,
      maxDurationMs: budget.maxDurationMs,
      maxTokens: budget.maxTokens ?? null,
    });
  
    // Convert each AgentEvent from session.step() to an OutputEvent.
    const onEvent = (event: AgentEvent) => {
      if (event.kind === 'assistant_chunk') {
        dispatch({ type: 'streaming-chunk', engineId: event.engineId, chunk: event.text });
      } else if (event.kind === 'tool_call') {
        dispatch({
          type: 'tool-call',
          engineId: event.engineId,
          tool: event.toolName,
          input: event.input ? JSON.stringify(event.input) : '',
          status: event.status === 'ok' ? 'done' : event.status === 'error' || event.status === 'rejected' ? 'error' : 'running',
          output: event.output,
        });
      }
      // turn_complete and error events from the inner loop are
      // folded into the step result; we handle them post-step below.
    };
  
    // ── The actual work ────────────────────────────────────────
    const stepResult = await session.step(input, { onEvent });
    state = completeTurn(state, input, stepResult, Date.now());
    session.complete();
  
    // ── Emit step-end ─────────────────────────────────────────
    const outcome: 'completed'|'cancelled'|'failed' =
      stepResult.stopReason === 'completed' ? 'completed'
      : stepResult.stopReason === 'cancelled' ? 'cancelled'
      : 'failed';
  
    dispatch({
      type: 'agent-step-end',
      engineId,
      turnIndex: 0,
      outcome,
      toolCalls: stepResult.toolCalls,
      tokensUsed: stepResult.tokensUsed,
      stopReason: stepResult.stopReason,
    });
  
    dispatch({ type: 'streaming-end', engineId });
  
    // ── Emit turn summary ─────────────────────────────────────
    const stats = session.getStats();
    dispatch({
      type: 'agent-turn-summary',
      engineId,
      turnsUsed: stats.turnsUsed,
      turnsRemaining: stats.turnsRemaining,
      cumulativeTokens: stats.tokensUsed,
      cumulativeToolCalls: stats.totalToolCalls,
      elapsedMs: stats.elapsedMs,
    });
  
    // ── Budget warning when close to any limit ────────────────
    if (stats.turnsRemaining <= 1 && stats.turnsUsed > 0) {
      dispatch({
        type: 'agent-budget-warning',
        engineId,
        kind: 'turns',
        used: stats.turnsUsed,
        limit: budget.maxTurns,
        remaining: stats.turnsRemaining,
      });
    }
    if (stats.tokensRemaining !== null && stats.tokensRemaining > 0 && stats.tokensRemaining < (budget.maxTokens ?? Infinity) * 0.1) {
      dispatch({
        type: 'agent-budget-warning',
        engineId,
        kind: 'tokens',
        used: stats.tokensUsed,
        limit: budget.maxTokens ?? 0,
        remaining: stats.tokensRemaining,
      });
    }
    if (stats.durationRemainingMs < budget.maxDurationMs * 0.1) {
      dispatch({
        type: 'agent-budget-warning',
        engineId,
        kind: 'duration',
        used: stats.elapsedMs,
        limit: budget.maxDurationMs,
        remaining: stats.durationRemainingMs,
      });
    }
  
    // ── Final disposition ─────────────────────────────────────
    if (stepResult.stopReason === 'completed') {
      if (stepResult.response) {
        dispatch({ type: 'engine-block', engineId, color: 0, content: stepResult.response });
      }
      dispatch({
        type: 'success',
        message: `Agent session complete — ${stats.turnsUsed} turn(s), ${stats.totalToolCalls} tool call(s), ${stats.tokensUsed} tokens (estimated)`,
      });
    } else if (stepResult.stopReason === 'cancelled') {
      dispatch({ type: 'warning', message: 'Agent session cancelled by user' });
    } else if (stepResult.stopReason === 'budget_exceeded') {
      dispatch({ type: 'warning', message: `Agent stopped — ${stepResult.error ?? 'budget exceeded'}` });
    } else {
      dispatch({ type: 'error', message: stepResult.error ?? 'Agent session failed' });
    }
  } catch (err: any) {
    // Shouldn't normally reach here — session.step() catches its own errors and
    // returns stopReason='error'. This is a belt-and-suspenders path for
    // exceptions in reducer code or in the dispatch callback.
    state = failAgent(state, 'error', err?.message ?? String(err));
    dispatch({ type: 'error', message: err?.message ?? String(err) });
  } finally {
    abort.signal.removeEventListener('abort', onAbort);
    ctx.setActiveAbort(null);
  }
}

