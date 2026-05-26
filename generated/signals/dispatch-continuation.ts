// @kern-source: dispatch-continuation:5
import { clearConversation, clearSessionState } from '@agon/core';

// @kern-source: dispatch-continuation:6
import type { HandlerContext } from '../../handlers/types.js';

// @kern-source: dispatch-continuation:7
/**
 * Build the prompt that feeds delegated orchestration results back to Cesar for synthesis or follow-up work.
 */
export function buildDelegatedContinuationPrompt(message: string): string {
  return ['[DELEGATED RESULT]', message, '', '[CONTINUE]', 'Continue from this delegated result. Do not re-run the same Brainstorm, Tribunal, Campfire, Review, Forge, or Agent unless there is a genuinely new subproblem.', 'If more work is needed, use direct tools or a different focused delegation now. If the task is complete, synthesize the concrete outcome, recommendation, and remaining risk.'].join('\n');
}

// @kern-source: dispatch-continuation:12
/**
 * Format a Brainstorm winner as a Cesar continuation payload. Brainstorm is an input to Cesar, not a terminal answer.
 */
export function buildBrainstormContinuationMessage(source: string, question: string|undefined, result: any): string {
  const bids = Array.isArray(result?.bids) ? result.bids : [];
  const bidSummary = bids.map((b: any) => {
    const engineId = b?.engineId ?? 'unknown';
    const score = b?.score ?? 'n/a';
    const reasoning = String(b?.reasoning ?? '').slice(0, 800);
    const approach = b?.approach ? `\nApproach: ${String(b.approach).slice(0, 600)}` : '';
    return `**${engineId}** (score: ${score}): ${reasoning}${approach}`;
  }).join('\n\n') || 'No bids captured.';
  const original = question ? `\n\n## Original User Request\n${String(question).slice(0, 2000)}` : '';
  const winnerResponse = String(result?.response ?? '').slice(0, 6000);
  return `${source}. Winner: ${result?.winner ?? 'none'}.${original}\n\n## Engine Bids\n${bidSummary}\n\n## Winner's Full Response\n${winnerResponse}\n\nCesar owns the final answer. Synthesize this result, explain the next best action, and if implementation is needed ask whether to forge/build or continue directly. Do not stop at the brainstorm card.`;
}

// @kern-source: dispatch-continuation:28
/**
 * Collect recent engine messages for post-delegation Cesar synthesis.
 */
export function collectRecentEngineContext(ctx: HandlerContext, maxMessages?: number, maxChars?: number): string {
  const recentChat = ctx.chatSession?.messages?.slice(-(maxMessages ?? 12)) ?? [];
  const cap = maxChars ?? 1500;
  return recentChat.filter((m: any) => m.role === 'engine' && m.content).map((m: any) => `[${m.engineId}]: ${String(m.content).slice(0, cap)}`).join('\n\n');
}

// @kern-source: dispatch-continuation:35
/**
 * Delete persisted workspace conversation plus per-engine session state/tool caches so /clear and /clean start with a genuinely empty context.
 */
export function clearPersistedSessionContext(ctx: HandlerContext): string[] {
  const engineIds = new Set<string>();
  const add = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id) engineIds.add(id);
  };
  
  add((ctx.config as any)?.cesarEngine);
  add((ctx.config as any)?.forgeFixedStarter);
  add((ctx.cesarSession as any)?.engineId);
  const enabled = (ctx.config as any)?.forgeEnabledEngines;
  if (Array.isArray(enabled)) for (const id of enabled) add(id);
  try {
    const ids = typeof (ctx as any).activeEngines === 'function'
      ? (ctx as any).activeEngines()
      : [];
    if (Array.isArray(ids)) for (const id of ids) add(id);
  } catch { /* active engines unavailable */ }
  try {
    const ids = ctx.registry?.availableIds?.() ?? [];
    if (Array.isArray(ids)) for (const id of ids) add(id);
  } catch { /* registry unavailable */ }
  
  clearConversation();
  for (const engineId of engineIds) {
    try { clearSessionState(engineId); } catch { /* best-effort */ }
  }
  return [...engineIds].sort();
}

// @kern-source: dispatch-continuation:67
/**
 * Guard post-delegation Cesar continuation so long-running jobs do not answer an old turn after the user has moved on.
 */
export function shouldAutoContinueDelegatedResult(launchInputEpoch?: number, launchUserTurns?: number, ctx?: HandlerContext): boolean {
  if (!ctx) {
    return true;
  }
  if (typeof launchInputEpoch !== 'number' || typeof launchUserTurns !== 'number') {
    return true;
  }
  if ((ctx.inputEpoch ?? 0) !== launchInputEpoch) {
    return false;
  }
  if (countTrackedUserTurns(ctx) !== launchUserTurns) {
    return false;
  }
  return true;
}

// @kern-source: dispatch-continuation:80
/**
 * Compact user-facing Cesar recovery messages. Keep these short because they render in the live status/transcript path during failure handling.
 */
export function formatCesarRecoveryStatus(stage: 'delegation'|'rebuild'|'retry'|'acting'|'failed', subject: string, detail?: string): string {
  const suffix = detail ? ` - ${detail}` : '';
  switch (stage) {
    case 'delegation':
      return `Cesar recovery: running ${subject}${suffix}`;
    case 'rebuild':
      return `Cesar recovery: rebuilding ${subject} session${suffix}`;
    case 'retry':
      return `Cesar recovery: retrying ${subject} with fresh dispatch${suffix}`;
    case 'acting':
      return `Cesar recovery: ${subject} acting as Cesar${suffix}`;
    case 'failed':
      return `Cesar recovery failed: ${subject}${suffix}`;
    default:
      return `Cesar recovery: ${subject}${suffix}`;
  }
}

// @kern-source: dispatch-continuation:100
/**
 * Normalize the cross-engine Cesar fallback policy. Defaults to auto: when the configured Cesar engine returns no response, Agon silently swaps to another available engine and attributes its output as Cesar so the user perceives one persona. 'ask' restores the legacy prompt-and-show-chrome behavior; 'off' never swaps.
 */
export function normalizeCesarActingFallbackMode(value: any): 'ask'|'auto'|'off' {
  const mode = String(value ?? 'auto').trim().toLowerCase();
  if (mode === 'ask' || mode === 'prompt' || mode === 'confirm') {
    return 'ask';
  }
  if (mode === 'off' || mode === 'never' || mode === 'same-only' || mode === 'same') {
    return 'off';
  }
  return 'auto';
}

// @kern-source: dispatch-continuation:110
export function shouldAutoResumeAgentResult(result: any, launchInputEpoch: number, launchUserTurns: number, ctx: HandlerContext): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  const status = String((result as any).status ?? '').trim();
  if (!status || status === 'cancelled') {
    return false;
  }
  if ((ctx.inputEpoch ?? 0) !== launchInputEpoch) {
    return false;
  }
  if (countTrackedUserTurns(ctx) !== launchUserTurns) {
    return false;
  }
  return true;
}

// @kern-source: dispatch-continuation:123
export function buildAgentAutoResumePrompt(originalTask: string, result: any): string {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const kind = String((result as any).kind ?? 'agent');
  const status = String((result as any).status ?? 'completed');
  if (!status || status === 'cancelled') {
    return '';
  }
  const summary = String((result as any).summary ?? '').trim();
  const taskKind = String((result as any).taskKind ?? 'unknown').trim();
  const patchPath = String((result as any).patchPath ?? '').trim();
  const modeLabel = (kind === 'team-agent') ? 'team-agent' : 'solo agent';
  const lines = [`AUTOMATIC FOLLOW-UP: your delegated ${modeLabel} run has finished.`, `Do not ask the user what happened, whether the agent finished, or what needs fixing. Continue from this result.`, '', `Original delegated task:\n${originalTask.trim().slice(0, 4000)}`, '', `Completion status: ${status}`, `Delegation mode: ${modeLabel}`];
  if (taskKind && taskKind !== 'unknown') {
    lines.push(`Task kind: ${taskKind}`);
  }
  if (summary) {
    lines.push(`Result summary:\n${summary.slice(0, 8000)}`);
  }
  if (kind === 'team-agent') {
    lines.push(patchPath ? `Winner patch path (not applied to the main workspace yet): ${patchPath}` : `Important: team-agent edit runs do not automatically modify the main workspace.`);
    lines.push(`If you need to continue from the team result, inspect/apply the winner patch or use the latest [team-agent] / [agent-team-diff] context instead of asking the user to repeat themselves.`);
  } else {
    lines.push(`Important: solo agent runs work directly in the main workspace. Inspect the current files/diff before follow-up edits.`);
  }
  lines.push('', `Continue autonomously now. If the task is already complete, summarize the concrete outcome and remaining risk. If more work is needed, do it now.`);
  return lines.join('\n');
}

