// @kern-source: cesar-escalation:1
import { join } from 'node:path';

// @kern-source: cesar-escalation:2
import { mkdirSync } from 'node:fs';

// @kern-source: cesar-escalation:3
import { RUNS_DIR, resolveWorkingDir, tracker, appendMessage, classifyTask, rankByTaskClass } from '@agon/core';

// @kern-source: cesar-escalation:4
import { ENGINE_COLORS } from '../output.js';

// @kern-source: cesar-escalation:5
import type { Dispatch, HandlerContext } from '../handlers/types.js';

// @kern-source: cesar-escalation:6
import { CONFIDENCE_TIERS, confidenceBadge } from './cesar-confidence.js';

// @kern-source: cesar-escalation:7
import { CESAR_SYSTEM_PROMPT } from './cesar-session.js';

// @kern-source: cesar-escalation:9
export function pickBestAdvisor(input: string, ctx: HandlerContext): {engineId:string, color:number}|null {
  const cesarEngineId = (ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude';
  const otherEngines = ctx.activeEngines().filter((id: string) => id !== cesarEngineId);
  if (otherEngines.length === 0) return null;
  
  // Rank by task class ELO — best engine for THIS type of task
  const taskClass = classifyTask(input);
  const ranked = rankByTaskClass(otherEngines, taskClass);
  const advisorId = ranked.length > 0 ? ranked[0].engineId : otherEngines[0];
  return { engineId: advisorId, color: ENGINE_COLORS[advisorId] ?? 245 };
}

// @kern-source: cesar-escalation:23
export async function fireSecondOpinion(input: string, ctx: HandlerContext, abort: AbortController): Promise<{stdout:string, engineId:string, color:number}|null> {
  const advisor = pickBestAdvisor(input, ctx);
  if (!advisor) return null;
  
  const secondEngine = ctx.registry.get(advisor.engineId);
  const outDir = join(RUNS_DIR, `advisor-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  
  try {
    const result = await ctx.adapter.dispatch({
      engine: secondEngine,
      prompt: input,
      cwd: resolveWorkingDir(),
      mode: 'exec' as any,
      timeout: ctx.config.timeout ?? 120,
      outputDir: outDir,
      signal: abort.signal,
      systemPrompt: CESAR_SYSTEM_PROMPT,
    });
    return { stdout: result.stdout, engineId: advisor.engineId, color: advisor.color };
  } catch {
    return null;
  }
}

// @kern-source: cesar-escalation:50
export async function fireAdvisor(input: string, cesarResponse: string, parsedConfidence: number|null, ctx: HandlerContext, abort: AbortController): Promise<{stdout:string, engineId:string, color:number}|null> {
  const advisor = pickBestAdvisor(input, ctx);
      if (!advisor) return null;
  
      const advisorEngine = ctx.registry.get(advisor.engineId);
      const outDir = join(RUNS_DIR, `advisor-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
  
      const advisorPrompt = `Cesar (the orchestrator) is stuck on this task at ${parsedConfidence ?? '?'}% confidence.
  
  TASK: ${input}
  
  CESAR'S TAKE: ${cesarResponse.slice(0, 500)}
  
  You are the advisor. Be direct:
  1. What's the right approach? (2-3 sentences)
  2. What's Cesar missing? (1-2 key insights)
  3. Should this be: forge (engines compete on code), tribunal (debate the approach), brainstorm (gather ideas), or campfire (explore)?
  4. Solo or team? Why?`;
  
      try {
        const result = await ctx.adapter.dispatch({
          engine: advisorEngine,
          prompt: advisorPrompt,
          cwd: resolveWorkingDir(),
          mode: 'exec' as any,
          timeout: ctx.config.timeout ?? 120,
          outputDir: outDir,
          signal: abort.signal,
        });
        return { stdout: result.stdout, engineId: advisor.engineId, color: advisor.color };
      } catch {
        return null;
      }
}

// @kern-source: cesar-escalation:88
export async function handleSecondOpinion(secondResult: {stdout:string, engineId:string, color:number}|null, input: string, response: string, parsedConfidence: number|null, cesarEngineId: string, dispatch: Dispatch, ctx: HandlerContext): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string}|null> {
  if (!secondResult || !secondResult.stdout.trim()) return null;
  
  // Strip <think> blocks from advisor response
  const advisorResponse = secondResult.stdout.trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  dispatch({ type: 'engine-block', engineId: secondResult.engineId, color: secondResult.color, content: advisorResponse });
  appendMessage(ctx.chatSession, { role: 'engine', engineId: secondResult.engineId, content: advisorResponse, timestamp: new Date().toISOString() });
  tracker.record(secondResult.engineId, input, advisorResponse);
  
  // Save Cesar's response
  appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
  appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
  tracker.record(cesarEngineId, input, response);
  
  // Escalation menu — same for all low confidence, no more dead STOP
  const escAnswer = await new Promise<string>((resolve) => {
    dispatch({ type: 'question', prompt: `Cesar ${parsedConfidence ?? '?'}% + ${secondResult.engineId} advisor — what next?`, choices: [
      { key: 'a', label: 'Accept Cesar', color: '#4ade80' },
      { key: 'b', label: 'Brainstorm', color: '#60a5fa' },
      { key: 't', label: 'Tribunal', color: '#f59e0b' },
      { key: 'f', label: 'Forge', color: '#a78bfa' },
    ], resolve } as any);
  });
  
  if (escAnswer === 'b') return { delegated: true, responded: true, action: 'brainstorm', reasoning: response };
  if (escAnswer === 't') return { delegated: true, responded: true, action: 'tribunal', reasoning: response };
  if (escAnswer === 'f') return { delegated: true, responded: true, action: 'forge', reasoning: response };
  return { delegated: false, responded: true };
}

// @kern-source: cesar-escalation:120
export function activateNero(ctx: HandlerContext, dispatch: Dispatch): void {
  if (!(ctx as any).neroMode && ctx.setNeroMode) {
    ctx.setNeroMode(true);
    (ctx as any).neroMode = true;
    (ctx as any)._autoNero = true;
    // Kill session — next turn will rebuild with NERO MODE in system prompt.
    // This is the same approach as manual /nero. The old injectNeroMode approach
    // sent a fake [SYSTEM] user message that models mostly ignored.
    if (ctx.cesarSession) {
      ctx.cesarSession.close();
      ctx.setCesarSession(null);
    }
    dispatch({ type: 'info', message: '⚔ Nero activated — Cesar will challenge on next turn' });
  }
}

// @kern-source: cesar-escalation:138
export function deactivateNero(ctx: HandlerContext, dispatch: Dispatch): void {
  ctx.setNeroMode(false);
  (ctx as any).neroMode = false;
  (ctx as any)._autoNero = false;
  if (ctx.cesarSession) {
    ctx.cesarSession.close();
    ctx.setCesarSession(null);
  }
  dispatch({ type: 'info', message: '⚔ Nero deactivated — confidence recovered' });
}

// @kern-source: cesar-escalation:152
export async function promptDelegation(action: string, dispatch: Dispatch, hardened?: boolean, tribunalMode?: string, team?: boolean): Promise<{approved:boolean, action?:string, hardened?:boolean, tribunalMode?:string, team?:boolean, userContext?:string}> {
  // Check session auto-approve cache
  const autoApproved = (promptDelegation as any)._autoApprove as Set<string> | undefined;
  if (autoApproved?.has(action)) {
    dispatch({ type: 'info', message: `Auto-approved: ${action} (always mode)` });
    return { approved: true };
  }
  
  const confirmLabel = hardened ? `${action} (hardened)` : action;
  const answer = await new Promise<string>((resolve) => {
    dispatch({ type: 'question', prompt: `\n━━━ Cesar suggests: ${confirmLabel}${tribunalMode ? ` [${tribunalMode}]` : ''} ━━━`, choices: [
      { key: 'y', label: 'Yes', color: '#4ade80' },
      { key: 'n', label: 'No', color: '#ef4444' },
      { key: 'a', label: 'Always', color: '#60a5fa' },
      { key: 'o', label: 'Other mode', color: '#f59e0b' },
      { key: 'w', label: 'Add context', color: '#a78bfa' },
    ], resolve } as any);
  });
  
  if (answer === 'n') return { approved: false };
  
  if (answer === 'a') {
    // Auto-approve this mode for rest of session
    if (!(promptDelegation as any)._autoApprove) {
      (promptDelegation as any)._autoApprove = new Set<string>();
    }
    ((promptDelegation as any)._autoApprove as Set<string>).add(action);
    dispatch({ type: 'info', message: `Will auto-approve "${action}" for this session` });
    return { approved: true };
  }
  
  if (answer === 'o') {
    // Let user pick a different mode
    const modeAnswer = await new Promise<string>((resolve) => {
      dispatch({ type: 'question', prompt: 'Pick mode:', choices: [
        { key: 'f', label: 'Forge', color: '#a78bfa' },
        { key: 'b', label: 'Brainstorm', color: '#60a5fa' },
        { key: 't', label: 'Tribunal', color: '#f59e0b' },
        { key: 'c', label: 'Campfire', color: '#facc15' },
        { key: 'p', label: 'Pipeline', color: '#f472b6' },
        { key: 'x', label: 'Cancel', color: '#ef4444' },
      ], resolve } as any);
    });
    const modeMap: Record<string, string> = { f: 'forge', b: 'brainstorm', t: 'tribunal', c: 'campfire', p: 'pipeline' };
    if (modeAnswer === 'x' || !modeMap[modeAnswer]) return { approved: false };
    return { approved: true, action: modeMap[modeAnswer] };
  }
  
  if (answer === 'w') {
    // Let user add context/instructions
    const userInput = await new Promise<string>((resolve) => {
      dispatch({ type: 'question', prompt: 'Add context (will be appended to the task):', resolve } as any);
    });
    if (!userInput?.trim()) return { approved: true }; // empty = just approve
    return { approved: true, userContext: userInput.trim() };
  }
  
  // 'y' — approve as-is
  return { approved: true };
}

// @kern-source: cesar-escalation:215
export async function promptProtocolEnforcement(input: string, parsedConfidence: number|null, ctx: HandlerContext, dispatch: Dispatch): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string, team?:boolean}|null> {
  if (parsedConfidence === null
      || parsedConfidence >= CONFIDENCE_TIERS.nero
      || parsedConfidence < CONFIDENCE_TIERS.stop
      || ctx.activeEngines().length <= 1) {
    return null;
  }
  
  // Cesar had full routing context (ELO, engine strengths, task class, scope)
  // but still didn't delegate. Offer brainstorm as a safe default — the user
  // can always pick a different mode from there.
  const answer = await new Promise<string>((resolve) => {
    dispatch({ type: 'question',
      prompt: `${parsedConfidence}% — Cesar didn't delegate. Brainstorm?`,
      choices: [
        { key: 'y', label: 'Brainstorm', color: '#4ade80' },
        { key: 'n', label: 'Skip', color: '#ef4444' },
      ],
      resolve,
    } as any);
  });
  if (answer === 'y') {
    return { delegated: true, responded: true, action: 'brainstorm' };
  }
  return null;
}

