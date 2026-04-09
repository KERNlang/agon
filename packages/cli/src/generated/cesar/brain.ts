// @kern-source: brain:1
import { join } from 'node:path';

// @kern-source: brain:2
import { mkdirSync, appendFileSync } from 'node:fs';

// @kern-source: brain:3
import type { ImageAttachment, PersistentSession, ForgeManifest, ForgeJudgment } from '@agon/core';

// @kern-source: brain:4
import { ensureAgonHome, RUNS_DIR, appendMessage, tracker, resolveWorkingDir, ToolRegistry, FileStateCache, parseToolCalls, formatToolResults, runToolLoop, classifyTask } from '@agon/core';

// @kern-source: brain:5
import type { ToolContext, ToolCallResult } from '@agon/core';

// @kern-source: brain:6
import { ENGINE_COLORS } from '../blocks/output-format.js';

// @kern-source: brain:7
import type { Dispatch, HandlerContext, PendingDelegation } from '../../handlers/types.js';

// @kern-source: brain:8
import { CONFIDENCE_TIERS, parseConfidence, confidenceBadge } from './confidence.js';

// @kern-source: brain:9
import { parseSuggestion } from './suggestion.js';

// @kern-source: brain:10
import { ensureCesarSession, CESAR_SYSTEM_PROMPT } from './session.js';

// @kern-source: brain:11
import { createCesarToolRegistry, createEagerToolContext, executeEagerTool } from './tools.js';

// @kern-source: brain:12
import { fireQuickNero, fireNero, fireAdvisor, handleSecondOpinion, activateNero, deactivateNero, promptDelegation, promptProtocolEnforcement } from './escalation.js';

// @kern-source: brain:13
import { buildRoutingContext } from './routing.js';

// @kern-source: brain:16
export const yieldToInk: () => Promise<void> = () => new Promise<void>(resolve => setImmediate(resolve));

// @kern-source: brain:19
export function extractDelegation(toolName: string, args: Record<string,unknown>): PendingDelegation {
  return {
    action: toolName.toLowerCase(),
    reasoning: (args as any)?.task ?? (args as any)?.question ?? (args as any)?.topic ?? (args as any)?.target ?? '',
    fitnessCmd: typeof (args as any)?.fitnessCmd === 'string'
      ? (args as any).fitnessCmd
      : typeof (args as any)?.fitness === 'string'
        ? (args as any).fitness
        : undefined,
    hardened: (args as any)?.hardened ?? false,
    tribunalMode: (args as any)?.mode,
    team: (args as any)?.team ?? false,
    target: (args as any)?.target,
    engineId: (args as any)?.engine,
    createdAt: Date.now(),
  };
}

// @kern-source: brain:38
export async function commitTurnAndDelegate(pendingDel: PendingDelegation, input: string, response: string, cesarEngineId: string, streaming: boolean, dispatch: Dispatch, ctx: HandlerContext): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string, fitnessCmd?:string, hardened?:boolean, tribunalMode?:string, team?:boolean, target?:string, engineId?:string}> {
  if (streaming) dispatch({ type: 'streaming-end', engineId: cesarEngineId });
  if (!streaming) dispatch({ type: 'spinner-stop' });
  appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
  appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
  tracker.record(cesarEngineId, { prompt: input, response });
  const delResult = await promptDelegation(pendingDel.action, dispatch, pendingDel.hardened, pendingDel.tribunalMode, pendingDel.team);
  if (delResult.approved) {
    const finalAction = delResult.action ?? pendingDel.action;
    const action = pendingDel.team ? `team-${finalAction}` : finalAction;
    const reasoning = delResult.userContext ? `${pendingDel.reasoning ?? ''}\n\nUser context: ${delResult.userContext}` : pendingDel.reasoning;
    return { delegated: true, responded: true, action, reasoning, fitnessCmd: pendingDel.fitnessCmd, hardened: delResult.hardened ?? pendingDel.hardened, tribunalMode: delResult.tribunalMode ?? pendingDel.tribunalMode, team: delResult.team ?? pendingDel.team, target: pendingDel.target, engineId: pendingDel.engineId };
  }
  return { delegated: false, responded: true };
}

// @kern-source: brain:55
export async function commitTurnAndSuggest(suggestion: {action:string, rest?:string, hardened?:boolean, tribunalMode?:string, team?:boolean}, input: string, response: string, cesarEngineId: string, color: number, streaming: boolean, dispatch: Dispatch, ctx: HandlerContext): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string, hardened?:boolean, tribunalMode?:string, team?:boolean}> {
  if (streaming) dispatch({ type: 'streaming-end', engineId: cesarEngineId });
  if (!streaming) dispatch({ type: 'spinner-stop' });
  appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
  appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
  tracker.record(cesarEngineId, { prompt: input, response });
  if (suggestion.rest) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: suggestion.rest });
  const delResult = await promptDelegation(suggestion.action, dispatch, suggestion.hardened, suggestion.tribunalMode, suggestion.team);
  if (delResult.approved) {
    const finalAction = delResult.action ?? suggestion.action;
    const reasoning = delResult.userContext ? `${suggestion.rest ?? ''}\n\nUser context: ${delResult.userContext}` : suggestion.rest;
    return { delegated: true, responded: true, action: finalAction, reasoning, hardened: delResult.hardened ?? suggestion.hardened, tribunalMode: delResult.tribunalMode ?? suggestion.tribunalMode, team: delResult.team ?? suggestion.team };
  }
  return { delegated: false, responded: true };
}

// @kern-source: brain:72
export async function handleCesarBrain(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[]): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string, fitnessCmd?:string, hardened?:boolean, tribunalMode?:string, team?:boolean, target?:string, engineId?:string}> {
  const abort = new AbortController();
  const _turnStart = Date.now();
  const _toolsUsed: string[] = [];
  
  // Short follow-ups bypass escalation/delegation — they're conversation continuations
  const FOLLOWUP_RE = /^(still\??|and\??|go on|continue|yes|no|ok|why\??|how\??|what\??|really\??|more|details|explain|show me|huh\??|so\??|\?\??|y|n)$/i;
  const _isFollowUp = FOLLOWUP_RE.test(input.trim());
  
  if (!ctx.cesar) {
    ctx.cesar = {
      busy: false, busySince: null, queue: null,
      toolRegistry: null, hasNativeTools: false, lastDispatch: null,
      pendingDelegation: null, reportedConfidence: undefined,
      autoNero: false, advisorPending: false, lastEscalation: null as string | null,
      mcpFingerprint: undefined, planDispatch: null, proposedPlan: undefined,
    };
  }
  
  // ── Concurrency guard with message queue ──
  if (ctx.cesar!.busy) {
    const busySince = ctx.cesar!.busySince ?? 0;
    if (busySince && Date.now() - busySince > 180_000) {
      console.warn('[cesar:brain] force-clearing stuck busy flag');
      ctx.cesar!.busy = false;
      ctx.cesar!.queue = null;
    } else {
      // Follow-ups while busy → show elapsed status, don't queue
      if (_isFollowUp) {
        const elapsed = Math.round((Date.now() - busySince) / 1000);
        dispatch({ type: 'info', message: `Cesar still working… ${elapsed}s` });
        return { delegated: false, responded: true };
      }
      const existing = ctx.cesar!.queue;
      if (existing) {
        existing.input = existing.input + '\n\n' + input;
        if (images?.length) existing.images = [...(existing.images ?? []), ...images];
      } else {
        ctx.cesar!.queue = { input, dispatch, images };
      }
      dispatch({ type: 'info', message: 'Queued — will send when Cesar finishes.' });
      return { delegated: false, responded: true };
    }
  }
  ctx.cesar!.busy = true;
  ctx.cesar!.busySince = Date.now();
  ctx.cesar!.lastEscalation = null;
  const _brainStartMs = Date.now();
  if (ctx.eventBus) await ctx.eventBus.emit('pre:cesar-brain', { input });
  
  try {
    ensureAgonHome();
    const config = ctx.config;
  
    if ((config as any).cesarEnabled === false) {
      ctx.cesar!.busy = false;
      return { delegated: false, responded: false };
    }
  
    const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    const allAvailable = ctx.registry.availableIds();
    if (!allAvailable.includes(cesarEngineId)) {
      return { delegated: false, responded: false };
    }
  
    const color = ENGINE_COLORS[cesarEngineId] ?? 124;
    ctx.setActiveAbort(abort);
    ctx.cesar!.lastDispatch = dispatch;
    dispatch({ type: 'confidence-update', value: null });
    dispatch({ type: 'spinner-start', message: 'Cesar thinking…', color });
    await yieldToInk();
  
    // ── Boot or reuse persistent session ──
    let session: PersistentSession;
    try {
      session = await ensureCesarSession(ctx);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'spinner-update', message: `Cesar session error: ${errMsg.slice(0, 80)}` });
      try {
        const engine = ctx.registry.get(cesarEngineId);
        const outputDir = join(RUNS_DIR, `cesar-fallback-${Date.now()}`);
        mkdirSync(outputDir, { recursive: true });
        const freshResult = await ctx.adapter.dispatch({
          engine, prompt: input, cwd: resolveWorkingDir(), mode: 'exec' as any,
          timeout: config.timeout ?? 120, outputDir, signal: abort.signal, systemPrompt: CESAR_SYSTEM_PROMPT,
        });
        dispatch({ type: 'spinner-stop' });
        if (freshResult.stdout.trim()) {
          dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: freshResult.stdout.trim() });
          appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
          appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: freshResult.stdout.trim(), timestamp: new Date().toISOString() });
          tracker.record(cesarEngineId, { prompt: input, response: freshResult.stdout.trim() });
          return { delegated: false, responded: true };
        }
      } catch { /* truly failed */ }
      dispatch({ type: 'spinner-stop' });
      return { delegated: false, responded: false };
    }
  
    // Ensure tool registry is always available
    if (!ctx.cesar!.toolRegistry) {
      ctx.cesar!.toolRegistry = createCesarToolRegistry();
    }
    const toolRegistry = ctx.cesar!.toolRegistry as ToolRegistry;
  
    let response = '';
    let streaming = false;
    let wasStreamed = false; // tracks if response was already shown via streaming chunks
    let parsedConfidence: number | null = null;
    let confidenceParsed = false;
    let insideThinkBlock = false;
    let secondOpinionPromise: Promise<any> | null = null;
    const eagerPromises: Promise<ToolCallResult>[] = [];
    let eagerToolCtx: ToolContext | null = null;
  
    // ── Build routing context (cheap: ~500ms, ~200 tokens) ──
    let enrichedInput = input;
    try {
      const routingCtx = buildRoutingContext(input, ctx);
      if (routingCtx) {
        enrichedInput = `[ROUTING CONTEXT — use this to decide mode + team]\n${routingCtx}\n\n${input}`;
      }
    } catch { /* routing context is best-effort */ }
  
    // ── Heartbeat timer + turn timeout ──
    const cesarTimeout = (config as any).cesarTimeout ?? 300;
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - _turnStart) / 1000);
      if (elapsed >= cesarTimeout) {
        abort.abort();
        clearInterval(heartbeat);
        dispatch({ type: 'spinner-update', message: `Cesar timed out after ${elapsed}s` });
      } else {
        dispatch({ type: 'spinner-update', message: `Cesar thinking… ${elapsed}s` });
      }
    }, 15_000);
  
    // ── Stream response ──
    try {
      const gen = session.send({ message: enrichedInput, signal: abort.signal, images: images?.map(img => img.path) });
  
      for await (const chunk of gen) {
        if (abort.signal.aborted) break;
  
        if (chunk.type === 'status') {
          dispatch({ type: 'spinner-update', message: `Cesar ${chunk.content}` });
          continue;
        }
  
        if (chunk.type === 'tool_call') {
          const meta = (chunk.metadata ?? {}) as Record<string, unknown>;
          const toolInput = typeof meta.input === 'string' ? meta.input : meta.input ? JSON.stringify(meta.input) : '';
          const toolName = chunk.content || 'tool';
          const toolStatus = (meta.status as string) ?? 'running';
          dispatch({ type: 'spinner-update', message: `Cesar: ${toolName}…` });
  
          if (toolStatus === 'done') {
            dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: 'done', output: typeof meta.output === 'string' ? meta.output : undefined } as any);
          } else if (toolStatus === 'native') {
            dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: 'running' } as any);
          } else if (toolStatus === 'running' && meta.input && toolRegistry && !ctx.cesar!.hasNativeTools) {
            // Intercept orchestration signal tools — don't execute as workspace tools
            const EAGER_ORCH = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline', 'Review']);
            if (EAGER_ORCH.has(toolName)) {
              ctx.cesar!.pendingDelegation = extractDelegation(toolName, (meta.input ?? {}) as Record<string, unknown>);
              ctx.eventBus?.emit('cesar:delegation', { action: toolName.toLowerCase(), source: 'stream' }).catch(() => {});
              dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: 'done' } as any);
              // Break stream immediately — Cesar must stop after delegation (RULE 6)
              break;
            }
            dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: 'running' } as any);
            if (!eagerToolCtx) eagerToolCtx = createEagerToolContext(ctx, config, abort.signal, dispatch);
            eagerPromises.push(executeEagerTool(toolName, meta, toolRegistry, eagerToolCtx, dispatch, cesarEngineId));
          } else {
            dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: toolStatus as any, output: typeof meta.output === 'string' ? meta.output : undefined } as any);
          }
          continue;
        }
  
        if (chunk.type === 'error') {
          // If we already have content (text or tool calls happened), don't discard it.
          // API engines often error AFTER producing useful output (timeout on follow-up, malformed final SSE).
          if (response.length > 0 || streaming) {
            dispatch({ type: 'warning', message: `Cesar stream error (partial response preserved): ${(chunk.content ?? '').slice(0, 80)}` });
            break; // Exit stream loop, process whatever we have
          }
          dispatch({ type: 'spinner-stop' });
          return { delegated: false, responded: false };
        }
  
        if (chunk.type === 'done') break;
  
        if (chunk.type === 'text') {
          clearInterval(heartbeat);
          if (!streaming) {
            response += chunk.content;
  
            // Check for tool-reported confidence (ReportConfidence tool)
            if (!confidenceParsed && ctx.cesar!.reportedConfidence !== undefined) {
              const toolConf = ctx.cesar!.reportedConfidence as number;
              ctx.cesar!.reportedConfidence = undefined;
              parsedConfidence = toolConf;
              confidenceParsed = true;
              dispatch({ type: 'info', message: confidenceBadge(toolConf) + ` Cesar` });
              dispatch({ type: 'confidence-update', value: toolConf });
              if (toolConf >= CONFIDENCE_TIERS.direct && ctx.cesar!.autoNero) deactivateNero(ctx, dispatch);
            }
  
            // Parse confidence from first chunk(s)
            if (!confidenceParsed && response.length > 5) {
              const conf = parseConfidence(response);
              if (conf.value !== null) {
                parsedConfidence = conf.value;
                confidenceParsed = true;
                dispatch({ type: 'info', message: confidenceBadge(conf.value) + ` Cesar` });
                dispatch({ type: 'confidence-update', value: conf.value });
                ctx.eventBus?.emit('cesar:confidence', { value: conf.value, source: 'stream' }).catch(() => {});
                response = conf.rest;
                if (conf.value >= CONFIDENCE_TIERS.direct && ctx.cesar!.autoNero) deactivateNero(ctx, dispatch);
              } else if (response.length > 30 && !ctx.cesar!.hasNativeTools) {
                confidenceParsed = true;
              }
            }
  
            // Check for suggestion/delegation marker
            const suggestion = parseSuggestion(response);
            if (suggestion.action) {
              return await commitTurnAndSuggest({ action: suggestion.action!, rest: suggestion.rest, hardened: suggestion.hardened, tribunalMode: suggestion.tribunalMode, team: suggestion.team }, input, response, cesarEngineId, color, streaming, dispatch, ctx);
            }
  
            // Buffer before streaming to detect [SUGGEST:mode]
            if (response.length < 40) continue;
  
            // Initial confidence is just informational — don't escalate yet.
            // The model needs to investigate first. Escalation happens post-stream
            // when we know if the model actually worked or just narrated.
  
            // Switch to streaming mode
            dispatch({ type: 'spinner-update', message: 'Cesar responding…' });
            streaming = true;
            wasStreamed = true;
            let cleanFirst = response;
            if (cleanFirst.includes('<think>')) {
              cleanFirst = cleanFirst.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
              if (response.includes('<think>') && !response.includes('</think>')) {
                insideThinkBlock = true;
                cleanFirst = response.replace(/<think>[\s\S]*/gi, '');
              }
            }
            if (cleanFirst.trim()) dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: cleanFirst });
          } else {
            response += chunk.content;
            if (insideThinkBlock) {
              if (chunk.content.includes('</think>')) {
                insideThinkBlock = false;
                const afterThink = chunk.content.split('</think>').pop()?.trim() ?? '';
                if (afterThink) dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: afterThink });
              }
            } else if (chunk.content.includes('<think>')) {
              const beforeThink = chunk.content.split('<think>')[0];
              if (beforeThink) dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: beforeThink });
              if (!chunk.content.includes('</think>')) {
                insideThinkBlock = true;
              } else {
                const afterThink = chunk.content.split('</think>').pop()?.trim() ?? '';
                if (afterThink) dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: afterThink });
              }
            } else {
              dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: chunk.content });
            }
          }
        }
      }
    } catch (err) {
      clearInterval(heartbeat);
      dispatch({ type: 'spinner-stop' });
      console.error(`[cesar:claude] send error: ${(err as Error).message ?? err}`);
      // If we already have content, preserve it instead of discarding
      if (response.length > 0 || streaming) {
        dispatch({ type: 'warning', message: `Cesar stream error (partial response preserved): ${((err as Error).message ?? '').slice(0, 80)}` });
        // Fall through to process whatever response we have
      } else {
        dispatch({ type: 'warning', message: 'Cesar session error — will restart on next message' });
        return { delegated: false, responded: false };
      }
    }
  
    clearInterval(heartbeat);
  
    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      const elapsed = Math.round((Date.now() - _turnStart) / 1000);
      if (elapsed >= cesarTimeout) {
        dispatch({ type: 'warning', message: `Cesar timed out after ${elapsed}s. Try a simpler question, or use /forge for complex tasks.` });
        return { delegated: false, responded: true };
      }
      return { delegated: false, responded: false };
    }
  
    response = response.trim();
  
    // Strip <think> blocks and internal markers
    response = response.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
    if (ctx.cesar!.hasNativeTools) {
      response = response.replace(/<tool\s+name="[^"]+">[\s\S]*?<\/tool>/g, '').trim();
    }
  
    // ── Await eager tool results ──
    if (eagerPromises.length > 0 && !ctx.cesar!.hasNativeTools && session.alive && !abort.signal.aborted) {
      dispatch({ type: 'spinner-start', message: `Cesar: awaiting ${eagerPromises.length} tool result${eagerPromises.length > 1 ? 's' : ''}…`, color });
      const eagerResults = await Promise.all(eagerPromises);
      const formatted = formatToolResults(
        eagerResults.map((r: ToolCallResult) => ({ name: r.toolName, content: r.result.content, error: r.result.error }))
      );
      if (formatted && session.alive) {
        dispatch({ type: 'spinner-start', message: 'Cesar processing tool results…', color });
        let continuation = '';
        const contGen = session.send({ message: formatted, signal: abort.signal });
        for await (const chunk of contGen) {
          if (chunk.type === 'text') continuation += chunk.content;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        }
        dispatch({ type: 'spinner-stop' });
        if (continuation.trim()) response = continuation.trim();
      }
    }
  
    // Parse confidence from final response (non-streaming path)
    if (!confidenceParsed && response) {
      const conf = parseConfidence(response);
      if (conf.value !== null) {
        parsedConfidence = conf.value;
        dispatch({ type: 'info', message: confidenceBadge(conf.value) + ` Cesar` });
        dispatch({ type: 'confidence-update', value: conf.value });
        response = conf.rest;
      }
      confidenceParsed = true;
    }
  
    // Deferred challenge messages — appended after user/cesar pair to preserve history order
    let _deferredChallenges: Array<{ engineId: string; content: string }> = [];
  
    // Plan mode flag — used below to block execution delegations while allowing thinking
    const inPlanMode = ctx.activePlan && ['planning', 'awaiting_approval'].includes(ctx.activePlan.state);
  
    // Escalation moved to after investigation phase — see below.
  
    // Post-stream: consume tool-reported confidence
    if (!confidenceParsed && ctx.cesar!.reportedConfidence !== undefined) {
      const toolConf = ctx.cesar!.reportedConfidence as number;
      ctx.cesar!.reportedConfidence = undefined;
      parsedConfidence = toolConf;
      confidenceParsed = true;
      dispatch({ type: 'info', message: confidenceBadge(toolConf) + ` Cesar` });
      dispatch({ type: 'confidence-update', value: toolConf });
      if (toolConf >= CONFIDENCE_TIERS.direct && ctx.cesar!.autoNero) deactivateNero(ctx, dispatch);
    }
  
    // ── Check pending delegation from orchestration signal tools ──
    const pendingDel = ctx.cesar!.pendingDelegation;
    if (pendingDel) {
      ctx.cesar!.pendingDelegation = null;
      return await commitTurnAndDelegate(pendingDel, input, response, cesarEngineId, streaming, dispatch, ctx);
    }
  
    // Check final response for suggestion/delegation
    const finalSuggestion = parseSuggestion(response);
    if (finalSuggestion.action) {
      return await commitTurnAndSuggest({ action: finalSuggestion.action!, rest: finalSuggestion.rest, hardened: finalSuggestion.hardened, tribunalMode: finalSuggestion.tribunalMode, team: finalSuggestion.team }, input, response, cesarEngineId, color, streaming, dispatch, ctx);
    }
  
    // ── XML tool loop — CLI engines always, API engines if they emitted text-based tool calls (e.g. GLM-5.1) ──
    let ranToolLoop = false;
    let mutationDeferred = false;
    const fileStateCache = new FileStateCache();
    const explorationMode = ctx.explorationMode ?? false;
    const toolCtx: ToolContext = {
          cwd: resolveWorkingDir(), readFileState: (fileStateCache as any).cache, abortSignal: abort.signal,
          permissionMode: (config as any).permissionMode ?? 'ask', explorationMode,
          allowedCommands: (config as any).allowedCommands ?? [], toolPermissions: (config as any).toolPermissions ?? {},
          onProgress: (msg: string) => dispatch({ type: 'spinner-update', message: `Cesar: ${msg}` }),
          readOnlyMode: true, // Phase 1: investigate only — mutating tools blocked until after escalation check
    };
    const _lastToolInputs: Record<string, string> = {};
    const hasTextToolCalls = response.includes('<tool_call_tool>') || response.includes('<tool name=');
    if (toolRegistry && response && (!ctx.cesar!.hasNativeTools || hasTextToolCalls)) {
      const toolParsed = parseToolCalls(response);
      if (toolParsed.hasToolCalls) {
        if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
        const loopResult = await runToolLoop(
          async (message: string) => {
            if (ctx.cesar!.pendingDelegation) return '[Delegation pending]';
            if (!session.alive || abort.signal.aborted) return '';
            dispatch({ type: 'spinner-start', message: 'Cesar processing results…', color });
            let nextResponse = '';
            const gen = session.send({ message, signal: abort.signal });
            for await (const chunk of gen) {
              if (chunk.type === 'text') nextResponse += chunk.content;
              if (chunk.type === 'tool_call') {
                const meta = (chunk.metadata ?? {}) as Record<string, unknown>;
                dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: chunk.content || 'tool',
                  input: typeof meta.input === 'string' ? meta.input : meta.input ? JSON.stringify(meta.input) : '',
                  status: (meta.status as any) ?? 'running', output: typeof meta.output === 'string' ? meta.output : undefined } as any);
              }
              if (chunk.type === 'done' || chunk.type === 'error') break;
            }
            dispatch({ type: 'spinner-stop' });
            if (!nextResponse.trim()) return '[No response from engine]';
            return nextResponse.trim();
          },
          response, toolCtx, toolRegistry,
          {
            onToolCall: (name: string, inp: Record<string, unknown>) => {
              _lastToolInputs[name] = JSON.stringify(inp);
              _toolsUsed.push(name);
              dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: name, input: JSON.stringify(inp), status: 'running' });
              // Intercept orchestration signal tools — set _pendingDelegation
              const LOOP_ORCH = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline', 'Review']);
              if (LOOP_ORCH.has(name)) {
                ctx.cesar!.pendingDelegation = extractDelegation(name, (inp as Record<string, unknown>) ?? {});
              }
            },
            onToolResult: (name: string, result: any) => {
              const out = result.result.ok ? result.result.content : result.result.error;
              // Track if a mutation was deferred during investigation
              if (!result.result.ok && typeof result.result.error === 'string' && result.result.error.includes('[Investigation phase]')) {
                mutationDeferred = true;
              }
              dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: name, input: _lastToolInputs[name] ?? '', status: result.result.ok ? 'done' : 'error', output: out });
              delete _lastToolInputs[name];
            },
            onPermissionAsk: async (tool: string, message: string) => {
              return new Promise<boolean>((resolve) => {
                const lastInput = _lastToolInputs[tool] ?? '{}';
                let command = '';
                try { command = JSON.parse(lastInput).command ?? JSON.parse(lastInput).file_path ?? lastInput; } catch { command = lastInput; }
                dispatch({ type: 'permission-ask', tool, command, reason: message, resolve } as any);
              });
            },
            onText: (text: string) => { if (text.trim()) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: text }); },
            onTurnComplete: (turn: number) => { dispatch({ type: 'spinner-update', message: `Cesar tool loop turn ${turn}…` }); },
          },
        );
        response = loopResult.finalText.trim();
        ranToolLoop = true;
      }
    }
  
    // ── Post-tool-loop: check delegation set during XML tool loop ──
    const postLoopDel = ctx.cesar!.pendingDelegation;
    if (postLoopDel) {
      ctx.cesar!.pendingDelegation = null;
      return await commitTurnAndDelegate(postLoopDel, input, response, cesarEngineId, streaming, dispatch, ctx);
    }
  
    // ── Post-tool-loop: re-parse suggestion on updated response ──
    if (ranToolLoop && !finalSuggestion.action) {
      const postLoopSuggestion = parseSuggestion(response);
      if (postLoopSuggestion.action) {
        return await commitTurnAndSuggest({ action: postLoopSuggestion.action!, rest: postLoopSuggestion.rest, hardened: postLoopSuggestion.hardened, tribunalMode: postLoopSuggestion.tribunalMode, team: postLoopSuggestion.team }, input, response, cesarEngineId, color, streaming, dispatch, ctx);
      }
    }
  
    // ── Post-investigation: re-parse confidence on the INFORMED response ──
    if (ranToolLoop && !confidenceParsed) {
      const postConf = parseConfidence(response);
      if (postConf.value !== null) {
        parsedConfidence = postConf.value;
        dispatch({ type: 'info', message: confidenceBadge(postConf.value) + ` Cesar (after investigation)` });
        dispatch({ type: 'confidence-update', value: postConf.value });
        response = postConf.rest;
        confidenceParsed = true;
      }
    }
  
    // ── Quick Nero: gentle self-check (only when confidence genuinely warrants it) ──
    // Not a gate — just a nudge. Fires rarely, stays in flow.
    if (parsedConfidence !== null && parsedConfidence < 90 && !secondOpinionPromise && !ctx.cesar!.advisorPending && !_isFollowUp && !abort.signal.aborted) {
      if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
      dispatch({ type: 'spinner-start', message: confidenceBadge(parsedConfidence) + ' Quick Nero — self-challenge…', color });
      await yieldToInk();
      const qnResult = await fireQuickNero(session, response, input, parsedConfidence, dispatch, abort.signal, ctx);
      dispatch({ type: 'spinner-stop' });
      if (qnResult.challenged && qnResult.challengeText) {
        dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: `**Self-challenge:**\n${qnResult.challengeText}` });
        _deferredChallenges.push({ engineId: cesarEngineId, content: `[quick-nero] ${qnResult.challengeText}` });
      }
      if (qnResult.newConfidence !== null && qnResult.newConfidence !== parsedConfidence) {
        parsedConfidence = qnResult.newConfidence;
        dispatch({ type: 'info', message: confidenceBadge(parsedConfidence) + (qnResult.newConfidence < parsedConfidence ? ' Confidence adjusted' : ' Confidence confirmed') });
        dispatch({ type: 'confidence-update', value: parsedConfidence });
      }
    }
  
    // ── No forced escalation — Cesar decides via tool calls ──
    // Confidence is displayed. Cesar has Brainstorm/Tribunal/Campfire/Forge/Delegate
    // available as tools. If Cesar wants to escalate, it calls them during the tool loop.
    // The orchestrator handles the delegation via pendingDelegation intercept.
  
    // ── Execution phase: unlock mutating tools (only if a mutation was actually deferred) ──
    const investigationResponse = response; // Preserve for chat history
    if (mutationDeferred && toolRegistry && session.alive && !abort.signal.aborted) {
      toolCtx.readOnlyMode = false;
      // Ask engine to continue with execution now that tools are unlocked
      dispatch({ type: 'spinner-start', message: 'Cesar executing…', color });
      let execResponse = '';
      const execGen = session.send({ message: 'Investigation complete. You may now use write, edit, and bash tools to execute your plan. Proceed.', signal: abort.signal });
      for await (const chunk of execGen) {
        if (chunk.type === 'text') execResponse += chunk.content;
        if (chunk.type === 'done' || chunk.type === 'error') break;
      }
      dispatch({ type: 'spinner-stop' });
      if (execResponse.trim()) {
        const execParsed = parseToolCalls(execResponse.trim());
        if (execParsed.hasToolCalls) {
          const execResult = await runToolLoop(
            async (message: string) => {
              if (ctx.cesar!.pendingDelegation) return '[Delegation pending]';
              if (!session.alive || abort.signal.aborted) return '';
              dispatch({ type: 'spinner-start', message: 'Cesar executing…', color });
              let nextResponse = '';
              const gen = session.send({ message, signal: abort.signal });
              for await (const chunk of gen) {
                if (chunk.type === 'text') nextResponse += chunk.content;
                if (chunk.type === 'done' || chunk.type === 'error') break;
              }
              dispatch({ type: 'spinner-stop' });
              return nextResponse.trim() || '[No response from engine]';
            },
            execResponse.trim(), toolCtx, toolRegistry,
            {
              onToolCall: (name: string, inp: Record<string, unknown>) => {
                _toolsUsed.push(name);
                dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: name, input: JSON.stringify(inp), status: 'running' });
              },
              onToolResult: (name: string, result: any) => {
                const out = result.result.ok ? result.result.content : result.result.error;
                dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: name, input: '', status: result.result.ok ? 'done' : 'error', output: out });
              },
              onPermissionAsk: async (tool: string, message: string) => {
                return new Promise<boolean>((resolve) => {
                  dispatch({ type: 'permission-ask', tool, command: tool, reason: message, resolve } as any);
                });
              },
              onText: (text: string) => { if (text.trim()) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: text }); },
              onTurnComplete: (turn: number) => { dispatch({ type: 'spinner-update', message: `Cesar executing turn ${turn}…` }); },
            },
          );
          response = investigationResponse + '\n\n' + execResult.finalText.trim();
        } else {
          // Engine responded with text only (e.g. "Done" or summary) — display it
          if (execResponse.trim()) {
            dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: execResponse.trim() });
          }
          response = investigationResponse + '\n\n' + execResponse.trim();
        }
      }
    }
  
    // ── Auto-review: when Cesar wrote code, run a quick review before declaring done ──
    // Data: 79% bug catch rate from reviewers. Architecture, not prompts.
    const WRITE_TOOL_NAMES = new Set(['Edit', 'Write']);
    const cesarWroteCode = _toolsUsed.some((t: string) => WRITE_TOOL_NAMES.has(t));
    if (cesarWroteCode && (config as any).autoReviewAfterImpl !== false && session.alive && !abort.signal.aborted && !ctx.cesar!.pendingDelegation) {
      dispatch({ type: 'spinner-start', message: 'Auto-reviewing changes…', color });
      try {
        let reviewResponse = '';
        const reviewGen = session.send({
          message: 'You just wrote code. Before we present this to the user, quickly self-review: check for bugs, missing edge cases, type errors, and off-by-one issues in what you just changed. If you find issues, fix them now. If everything looks correct, say "Review passed." Be brief.',
          signal: abort.signal,
        });
        for await (const chunk of reviewGen) {
          if (chunk.type === 'text') reviewResponse += chunk.content;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        }
        dispatch({ type: 'spinner-stop' });
        if (reviewResponse.trim() && !reviewResponse.includes('Review passed')) {
          dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: `**Auto-review:**\n${reviewResponse.trim()}` });
          response += `\n\n[Auto-review: ${reviewResponse.trim().slice(0, 200)}]`;
        }
      } catch {
        dispatch({ type: 'spinner-stop' });
        // Auto-review is best-effort — don't crash
      }
    }
  
    // ── Protocol enforcement: suggest mode when engine didn't ──
    if (!finalSuggestion.action && !ranToolLoop && !secondOpinionPromise && !_isFollowUp && !abort.signal.aborted) {
      if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
      const enforcement = await promptProtocolEnforcement(input, parsedConfidence, ctx, dispatch);
      if (enforcement) {
        appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
        appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
        tracker.record(cesarEngineId, { prompt: input, response });
        return enforcement;
      }
    }
  
    // ── Display final response (skip if already displayed via streaming or tool loop) ──
    if (!streaming && response && !ranToolLoop && !wasStreamed) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: response });
      await yieldToInk();
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId: cesarEngineId });
      dispatch({ type: 'spinner-stop' });
    }
  
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      // Append deferred challenge messages after user/cesar pair to preserve history order
      if (_deferredChallenges && _deferredChallenges.length > 0) {
        for (const ch of _deferredChallenges) {
          appendMessage(ctx.chatSession, { role: 'engine', engineId: ch.engineId, content: ch.content, timestamp: new Date().toISOString() });
        }
      }
      const tokenUsage = tracker.record(cesarEngineId, { prompt: input, response });
  
      // Trace
      try {
        const tracePath = join(RUNS_DIR, 'cesar-trace.jsonl');
        const taskClass = classifyTask(input);
        appendFileSync(tracePath, JSON.stringify({
          ts: new Date().toISOString(), engineId: cesarEngineId, backend: (config as any).cesarBackend ?? 'auto',
          durationMs: Date.now() - _turnStart, inputLen: input.length, responseLen: response.length, taskClass,
          toolsUsed: _toolsUsed.length > 0 ? _toolsUsed : undefined, toolCount: _toolsUsed.length, delegated: false,
          confidence: parsedConfidence,
          tokens: tokenUsage ? { prompt: tokenUsage.promptTokens, response: tokenUsage.responseTokens, cost: tokenUsage.costUsd } : undefined,
        }) + '\n');
      } catch { /* tracing is best-effort */ }
  
      // Auto-remember
      if (ctx.cesarMemory) {
        const mem = ctx.cesarMemory;
        const topic = input.slice(0, 80).replace(/\n/g, ' ');
        mem.remember(`turn:${Date.now()}`, topic, 'decision');
        if (ranToolLoop) mem.remember(`tools:${Date.now()}`, `Cesar used tools for: ${topic}`, 'file');
      }
  
      // Detect yes/no question — show choice buttons
      const lastLine = response.split('\n').filter((l: string) => l.trim()).pop()?.trim() ?? '';
      const asksConfirmation = !ranToolLoop && /\?\s*$/.test(lastLine) && /\b(want|shall|should|ready|proceed|go ahead|dispatch|confirm|continue|implement)\b/i.test(lastLine);
      if (asksConfirmation) {
        const answer = await new Promise<string>((resolve) => {
          dispatch({ type: 'question', prompt: `${cesarEngineId}: ${lastLine.length > 80 ? lastLine.slice(0, 80) + '…' : lastLine}`, choices: [
            { key: 'y', label: 'Yes', color: '#4ade80' },
            { key: 'n', label: 'No', color: '#ef4444' },
          ], resolve } as any);
        });
        if (answer === 'y' && session.alive && !abort.signal.aborted) {
          dispatch({ type: 'spinner-start', message: `${cesarEngineId} continuing…`, color });
          let followUp = '';
          const gen = session.send({ message: 'yes', signal: abort.signal });
          for await (const chunk of gen) {
            if (abort.signal.aborted) break;
            if (chunk.type === 'text') followUp += chunk.content;
            if (chunk.type === 'done' || chunk.type === 'error') break;
          }
          dispatch({ type: 'spinner-stop' });
          if (followUp.trim()) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: followUp.trim() });
        }
      }
  
      return { delegated: false, responded: true };
    } else {
      dispatch({ type: 'spinner-stop' });
    }
  
    return { delegated: false, responded: false };
  } finally {
    ctx.eventBus?.emit('post:cesar-brain', { durationMs: Date.now() - _brainStartMs }).catch(() => {});
    ctx.cesar!.busy = false;
    ctx.cesar!.busySince = null;
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  
    // Auto-drain queue
    const queued = ctx.cesar!.queue;
    if (queued) {
      ctx.cesar!.queue = null;
      setTimeout(() => {
        handleCesarBrain(queued.input, queued.dispatch, ctx, queued.images).catch((err: any) => {
          console.error(`[cesar:queue] drain failed: ${err.message ?? err}`);
          ctx.cesar!.busy = false;
        });
      }, 100);
    }
  }
}

