

import { classifyTask, rankByTaskClass } from '@kernlang/agon-core';

import { ENGINE_COLORS } from '../blocks/output-format.js';

import { icons } from '../signals/icons.js';

import type { Dispatch, HandlerContext } from '../../handlers/types.js';

import { parseConfidence } from './confidence.js';

import { approveTaskAction, buildTaskActionTarget, claimTaskActionPrompt, evaluateTaskAction, taskExplicitlyRequestsAction } from './task-execution-lease.js';

export type QuickNeroDecision = 'self' | 'tribunal' | 'brainstorm' | 'campfire' | 'forge';

export type QuickNeroScope = 'slice' | 'full' | 'none';

/**
 * Parse structured guidance from Quick Nero self-check output.
 */
export function parseQuickNeroDecision(text: string): {decision:QuickNeroDecision, team:boolean, scope:QuickNeroScope, rationale:string} {
  const cleaned = text.replace(/<think>[ \t\n\r\f\v\S]*?<\/think>[ \t\n\r\f\v]*/gi, '').trim();
  const decisionMatch = ((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })(cleaned.match(/(?:^|\n)[ \t\n\r\f\v]*DECISION:[ \t\n\r\f\v]*(self|tribunal|brainstorm|campfire|forge)\b/i));
  const breadthMatch = ((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })(cleaned.match(/(?:^|\n)[ \t\n\r\f\v]*BREADTH:[ \t\n\r\f\v]*(solo|team)\b/i));
  const scopeMatch = ((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })(cleaned.match(/(?:^|\n)[ \t\n\r\f\v]*(?:FORGE_SCOPE|SCOPE):[ \t\n\r\f\v]*(none|slice|full)\b/i));
  const whyMatch = ((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })(cleaned.match(/(?:^|\n)[ \t\n\r\f\v]*WHY:[ \t\n\r\f\v]*([ \t\n\r\f\v\S]*?)(?:\n[A-Z_]+:|$)/i));
  const decision = (decisionMatch?.groups[0]?.toLowerCase() ?? 'self') as QuickNeroDecision;
  const breadth = (breadthMatch?.groups[0]?.toLowerCase() ?? 'solo') === 'team';
  const scope = (scopeMatch?.groups[0]?.toLowerCase() ?? 'none') as QuickNeroScope;
  const rationale = (whyMatch?.groups[0] ?? cleaned).trim();
  return { decision: decision, team: breadth, scope: scope, rationale: rationale };
}

/**
 * Pick the highest-ELO engine for this task class (excluding Cesar) as advisor.
 */
export function pickBestAdvisor(input: string, ctx: HandlerContext): {engineId:string, color:number}|null {
  const cesarEngineId = (ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude';
  const otherEngines = ctx.activeEngines().filter((id: string) => id !== cesarEngineId);
  if (otherEngines.length === 0) {
    return null;
  }
  // Rank by task class ELO — best engine for THIS type of task
  const taskClass = classifyTask(input);
  const ranked = rankByTaskClass(otherEngines, taskClass);
  const advisorId = (ranked.length > 0) ? ranked[0].engineId : otherEngines[0];
  return { engineId: advisorId, color: ENGINE_COLORS[advisorId] ?? 124 };
}


/**
 * Same-session self-challenge: inject a challenge message into the existing Cesar session. Fast — no engine spawn.
 */
export async function fireQuickNero(session: any, response: string, input: string, confidence: number, dispatch: Dispatch, signal: AbortSignal, ctx: HandlerContext): Promise<{ challenged: boolean; newConfidence: number|null; challengeText: string; decision: QuickNeroDecision; team: boolean; scope: 'slice'|'full'|'none'; rationale: string }> {
  const challengePrompt = `[SELF-CHECK] You responded at ${confidence}% confidence.
  
  Take a breath and challenge your own plan. If you still think self-execution is right, say so. If not, choose the cheapest escalation that matches the uncertainty.
  
  Reply in this exact shape:
  CONFIDENCE: ~X%
  DECISION: self | tribunal | brainstorm | campfire | forge
  BREADTH: solo | team
  FORGE_SCOPE: none | slice | full
  WHY: one concise sentence explaining the decision
  CHECK: the main flaw, risk, or confirmation`;
  
      try {
        let challengeText = '';
        const gen = session.send({ message: challengePrompt, signal });
        for await (const chunk of gen) {
          if (signal.aborted) break;
          if (chunk.type === 'text') challengeText += chunk.content;
          if (chunk.type === 'done') break;
        }
        if (!challengeText.trim()) return { challenged: false, newConfidence: null, challengeText: '', decision: 'self', team: false, scope: 'none', rationale: '' };
  
        // Check tool-reported confidence first (API/native-tool backends use ReportConfidence)
        if (ctx.cesar!.reportedConfidence !== undefined) {
          const toolConf = ctx.cesar!.reportedConfidence as number;
          ctx.cesar!.reportedConfidence = undefined;
          ctx.cesar!.reportedConfidenceReasoning = undefined;
          const parsed = parseQuickNeroDecision(challengeText);
          return { challenged: true, newConfidence: toolConf, challengeText, decision: parsed.decision, team: parsed.team, scope: parsed.scope, rationale: parsed.rationale };
        }
        // Fall back to parsing ~X% from text
        const conf = parseConfidence(challengeText);
        const parsed = parseQuickNeroDecision(challengeText);
        return { challenged: true, newConfidence: conf.value, challengeText: conf.rest || challengeText, decision: parsed.decision, team: parsed.team, scope: parsed.scope, rationale: parsed.rationale };
      } catch {
        return { challenged: false, newConfidence: null, challengeText: '', decision: 'self', team: false, scope: 'none', rationale: '' };
      }
}




/**
 * Auto-deactivate Nero when confidence recovers.
 */
export function deactivateNero(ctx: HandlerContext, dispatch: Dispatch): void {
  ctx.setNeroMode(false);
  ctx.neroMode = false;
  ctx.cesar!.autoNero = false;
  dispatch({ type: 'info', message: `${icons().nero} Nero deactivated — confidence recovered` });
  ctx.eventBus?.emit('cesar:nero', { active: false }).catch(() => { });
}

/**
 * Apply Cesar's task authority lease to a chosen delegation. Read-only thinking is always free; routine AUTO execution is free; important and dangerous boundaries ask only when required.
 */
export async function promptDelegation(action: string, dispatch: Dispatch, hardened?: boolean, tribunalMode?: string, team?: boolean, ctx?: HandlerContext, target?: string, details?: Record<string,unknown>): Promise<{approved:boolean, action?:string, hardened?:boolean, tribunalMode?:string, team?:boolean, userContext?:string}> {
  const normalizedAction = String(action ?? '').replace(/^team-/, '').toLowerCase();
  const thinkingActions = new Set(['brainstorm', 'tribunal', 'campfire', 'council', 'review']);
  if (thinkingActions.has(normalizedAction)) return { approved: true, action, hardened, tribunalMode, team };
  
  const lease = ctx?.cesar?.taskExecutionLease;
  if (lease) {
    if ((normalizedAction === 'goal' || normalizedAction === 'conquer')
        && !taskExplicitlyRequestsAction(lease, normalizedAction)) {
      dispatch({ type: 'info', message: `${normalizedAction === 'goal' ? 'Goal' : 'Conquer'} requires an explicit user request — skipped.` });
      return { approved: false };
    }
    const authorityTarget = buildTaskActionTarget(lease, String(target ?? ''), details);
    const evaluation = evaluateTaskAction(lease, normalizedAction, authorityTarget);
    if (evaluation.decision === 'deny') {
      dispatch({ type: 'info', message: `${action} is outside this task's authority lease — skipped.` });
      return { approved: false };
    }
    if (evaluation.decision === 'allow') return { approved: true, action, hardened, tribunalMode, team };
    if (!claimTaskActionPrompt(lease, evaluation.signature)) return { approved: false };
  }
  
  const confirmLabel = hardened ? `${action} (hardened)` : action;
  const answer = await new Promise<string>((resolve) => {
    dispatch({ type: 'question', prompt: lease ? `Approve ${confirmLabel} for this task${tribunalMode ? ` [${tribunalMode}]` : ''}` : `Cesar suggests: ${confirmLabel}${tribunalMode ? ` [${tribunalMode}]` : ''}`, choices: [
      { key: 'y', label: 'Yes', color: '#4ade80' },
      { key: 'n', label: 'No', color: '#ef4444' },
    ], resolve } as any);
  });
  
  if (answer === 'y' && lease) approveTaskAction(lease, normalizedAction, buildTaskActionTarget(lease, String(target ?? ''), details));
  return { approved: answer === 'y', action, hardened, tribunalMode, team };
}

