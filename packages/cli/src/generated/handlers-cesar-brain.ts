import { join } from 'node:path';

import { mkdirSync } from 'node:fs';

import type { EngineAdapter, ImageAttachment } from '@agon/core';

import { EngineRegistry, loadConfig, ensureAgonHome, RUNS_DIR, appendMessage, tracker, scanProjectContext } from '@agon/core';

import { ENGINE_COLORS } from '../output.js';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

export const CESAR_SYSTEM_PROMPT: string = `You are Cesar, the orchestrator of Agon AI — a multi-engine competitive AI system.

You are the user's primary interface. Answer questions directly when you can. You have full context of the conversation.

When you encounter tasks that would benefit from other engines, delegate by including one of these markers at the START of your response:

[DELEGATE:build] — for code implementation tasks you want an agent engine to handle
[DELEGATE:forge] — for tasks that should be competitively built by multiple engines
[DELEGATE:brainstorm] — for questions where multiple AI perspectives would help
[DELEGATE:tribunal] — for debates or comparative analysis

Only delegate when genuinely needed. Most questions you should answer yourself.
When you delegate, briefly explain WHY in the same response.

After delegation, you'll receive the results and can synthesize or comment on them.`;

export function parseDelegation(response: string): {action:string|null, rest:string} {
  const match = response.match(/^\[DELEGATE:(build|forge|brainstorm|tribunal)\]\s*/);
  if (match) {
    return { action: match[1], rest: response.slice(match[0].length).trim() };
  }
  return { action: null, rest: response };
}

export async function handleCesarBrain(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[]): Promise<{delegated:boolean, action?:string, reasoning?:string}> {
  const abort = new AbortController();
  try {
    ensureAgonHome();
  
    const config = ctx.config;
    const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    const available = ctx.activeEngines();
  
    if (!available.includes(cesarEngineId)) {
      // Cesar engine not available, fall through to regular chat
      return { delegated: false };
    }
  
    let engine;
    try {
      engine = ctx.registry.get(cesarEngineId);
    } catch {
      return { delegated: false };
    }
  
    // Build context with conversation history
    const recent = ctx.chatSession.messages.slice(-30);
    const history = recent.length > 0
      ? recent.map((m: any) => m.role === 'user' ? `User: ${m.content}` : `${m.engineId ?? 'Cesar'}: ${m.content}`).join('\n\n')
      : '';
    const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined);
  
    const parts: string[] = [];
    parts.push(CESAR_SYSTEM_PROMPT);
    if (projectCtx) parts.push(`## PROJECT CONTEXT\n${projectCtx}`);
  
    // Include available engines info
    const engineList = available.map((id: string) => {
      try {
        const e = ctx.registry.get(id);
        const hasAgent = !!e.agent;
        return `- ${id}${hasAgent ? ' (agent-capable)' : ''}`;
      } catch { return `- ${id}`; }
    }).join('\n');
    parts.push(`## AVAILABLE ENGINES\n${engineList}`);
  
    if (history) parts.push(`## CONVERSATION\n${history}`);
    parts.push(`## USER\n${input}`);
  
    const prompt = parts.join('\n\n');
    const color = ENGINE_COLORS[cesarEngineId] ?? 245;
    const outputDir = join(RUNS_DIR, `cesar-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  
    ctx.setActiveAbort(abort);
    dispatch({ type: 'spinner-start', message: 'Cesar thinking…', color });
  
    let response = '';
    let streaming = false;
  
    try {
      const streamFn = ctx.adapter.dispatchStream;
      if (streamFn) {
        const gen = streamFn({
          engine, prompt, cwd: process.cwd(),
          mode: 'exec', timeout: Math.min(config.timeout ?? 90, 90),
          outputDir, signal: abort.signal, images: images ?? [],
        });
  
        while (true) {
          const { value, done } = await gen.next();
          if (done) break;
          if (abort.signal.aborted) break;
          if (value.startsWith('\x00')) continue;
  
          if (!streaming) {
            // Check first chunk for delegation marker
            response += value;
            const { action } = parseDelegation(response);
            if (action) {
              // Delegation detected — stop streaming, return to REPL for dispatch
              dispatch({ type: 'spinner-stop' });
              const { rest } = parseDelegation(response);
  
              // Record in chat history
              appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
              appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
              tracker.record(cesarEngineId, input, response);
  
              if (rest) {
                dispatch({ type: 'info', message: `Cesar: ${rest}` });
              }
  
              return { delegated: true, action, reasoning: rest };
            }
            // No delegation — start streaming to user
            dispatch({ type: 'spinner-stop' });
            streaming = true;
            dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: response });
          } else {
            response += value;
            dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: value });
          }
        }
      } else {
        const result = await ctx.adapter.dispatch({
          engine, prompt, cwd: process.cwd(),
          mode: 'exec', timeout: Math.min(config.timeout ?? 90, 90),
          outputDir, signal: abort.signal, images: images ?? [],
        });
        response = result.stdout;
      }
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      return { delegated: false }; // Fall back to regular chat on error
    }
  
    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return { delegated: false };
    }
  
    response = response.trim();
  
    // Check final response for delegation (non-streaming path)
    const { action, rest } = parseDelegation(response);
    if (action) {
      if (!streaming) dispatch({ type: 'spinner-stop' });
      if (streaming) dispatch({ type: 'streaming-end', engineId: cesarEngineId });
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(cesarEngineId, input, response);
      if (rest) dispatch({ type: 'info', message: `Cesar: ${rest}` });
      return { delegated: true, action, reasoning: rest };
    }
  
    // Direct response — render it
    if (!streaming && response) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: response });
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId: cesarEngineId });
    }
  
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(cesarEngineId, input, response);
    } else {
      dispatch({ type: 'spinner-stop' });
    }
  
    return { delegated: false };
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

