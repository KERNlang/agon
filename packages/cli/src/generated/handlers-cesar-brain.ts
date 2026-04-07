// @kern-source: handlers-cesar-brain:1
import { join } from 'node:path';

// @kern-source: handlers-cesar-brain:2
import { mkdirSync, appendFileSync } from 'node:fs';

// @kern-source: handlers-cesar-brain:3
import type { ImageAttachment, PersistentSession, ForgeManifest, ForgeJudgment } from '@agon/core';

// @kern-source: handlers-cesar-brain:4
import { ensureAgonHome, RUNS_DIR, appendMessage, tracker, resolveWorkingDir, ToolRegistry, FileStateCache, parseToolCalls, formatToolResults, runToolLoop, classifyTask } from '@agon/core';

// @kern-source: handlers-cesar-brain:5
import type { ToolContext, ToolCallResult } from '@agon/core';

// @kern-source: handlers-cesar-brain:6
import { ENGINE_COLORS } from '../output.js';

// @kern-source: handlers-cesar-brain:7
import type { Dispatch, HandlerContext } from '../handlers/types.js';

// @kern-source: handlers-cesar-brain:8
import { CONFIDENCE_TIERS, parseConfidence, confidenceBadge } from './cesar-confidence.js';

// @kern-source: handlers-cesar-brain:9
import { parseSuggestion } from './cesar-suggestion.js';

// @kern-source: handlers-cesar-brain:10
import { ensureCesarSession, CESAR_SYSTEM_PROMPT } from './cesar-session.js';

// @kern-source: handlers-cesar-brain:11
import { createCesarToolRegistry, createEagerToolContext, executeEagerTool } from './cesar-tools.js';

// @kern-source: handlers-cesar-brain:12
import { fireSecondOpinion, fireAdvisor, handleSecondOpinion, activateNero, deactivateNero, promptDelegation, promptProtocolEnforcement } from './cesar-escalation.js';

// @kern-source: handlers-cesar-brain:13
import { buildRoutingContext } from './cesar-routing.js';

// @kern-source: handlers-cesar-brain:15
export async function handleCesarBrain(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[]): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string, hardened?:boolean, tribunalMode?:string, team?:boolean}> {
  const abort = new AbortController();
  const _turnStart = Date.now();
  const _toolsUsed: string[] = [];
  
  // Short follow-ups bypass escalation/delegation — they're conversation continuations
  const FOLLOWUP_RE = /^(still\??|and\??|go on|continue|yes|no|ok|why\??|how\??|what\??|really\??|more|details|explain|show me|huh\??|so\??|\?\??|y|n)$/i;
  const _isFollowUp = FOLLOWUP_RE.test(input.trim());
  
  // ── Concurrency guard with message queue ──
  if ((ctx as any)._cesarBusy) {
    const busySince = (ctx as any)._cesarBusySince ?? 0;
    if (busySince && Date.now() - busySince > 180_000) {
      console.warn('[cesar:brain] force-clearing stuck busy flag');
      (ctx as any)._cesarBusy = false;
      (ctx as any)._cesarQueue = null;
    } else {
      const existing = (ctx as any)._cesarQueue;
      if (existing) {
        existing.input = existing.input + '\n\n' + input;
        if (images?.length) existing.images = [...(existing.images ?? []), ...images];
      } else {
        (ctx as any)._cesarQueue = { input, dispatch, images };
      }
      dispatch({ type: 'info', message: 'Queued — will send when Cesar finishes.' });
      return { delegated: false, responded: true };
    }
  }
  (ctx as any)._cesarBusy = true;
  (ctx as any)._cesarBusySince = Date.now();
  
  try {
    ensureAgonHome();
    const config = ctx.config;
  
    if ((config as any).cesarEnabled === false) {
      (ctx as any)._cesarBusy = false;
      return { delegated: false, responded: false };
    }
  
    const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    const allAvailable = ctx.registry.availableIds();
    if (!allAvailable.includes(cesarEngineId)) {
      return { delegated: false, responded: false };
    }
  
    const color = ENGINE_COLORS[cesarEngineId] ?? 245;
    ctx.setActiveAbort(abort);
    (ctx as any)._lastDispatch = dispatch;
    dispatch({ type: 'spinner-start', message: 'Cesar thinking…', color });
  
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
          tracker.record(cesarEngineId, input, freshResult.stdout.trim());
          return { delegated: false, responded: true };
        }
      } catch { /* truly failed */ }
      dispatch({ type: 'spinner-stop' });
      return { delegated: false, responded: false };
    }
  
    // Ensure tool registry is always available
    if (!(ctx as any)._toolRegistry) {
      (ctx as any)._toolRegistry = createCesarToolRegistry();
    }
    const toolRegistry = (ctx as any)._toolRegistry as ToolRegistry;
  
    let response = '';
    let streaming = false;
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
    const cesarTimeout = (config as any).cesarTimeout ?? 120;
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
          } else if (toolStatus === 'running' && meta.input && toolRegistry && !(ctx as any)._hasNativeTools) {
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
            if (!confidenceParsed && (ctx as any)._reportedConfidence !== undefined) {
              const toolConf = (ctx as any)._reportedConfidence as number;
              delete (ctx as any)._reportedConfidence;
              parsedConfidence = toolConf;
              confidenceParsed = true;
              dispatch({ type: 'info', message: confidenceBadge(toolConf) + ` Cesar` });
              if (toolConf >= CONFIDENCE_TIERS.direct && (ctx as any)._autoNero) deactivateNero(ctx, dispatch);
            }
  
            // Parse confidence from first chunk(s)
            if (!confidenceParsed && response.length > 5) {
              const conf = parseConfidence(response);
              if (conf.value !== null) {
                parsedConfidence = conf.value;
                confidenceParsed = true;
                dispatch({ type: 'info', message: confidenceBadge(conf.value) + ` Cesar` });
                response = conf.rest;
                if (conf.value >= CONFIDENCE_TIERS.direct && (ctx as any)._autoNero) deactivateNero(ctx, dispatch);
              } else if (response.length > 30 && !(ctx as any)._hasNativeTools) {
                confidenceParsed = true;
              }
            }
  
            // Check for suggestion/delegation marker
            const suggestion = parseSuggestion(response);
            if (suggestion.action) {
              dispatch({ type: 'spinner-stop' });
              appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
              appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
              tracker.record(cesarEngineId, input, response);
              if (suggestion.rest) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: suggestion.rest });
              const delResult = await promptDelegation(suggestion.action, dispatch, suggestion.hardened, suggestion.tribunalMode, suggestion.team);
              if (delResult.approved) {
                const finalAction = delResult.action ?? suggestion.action;
                const reasoning = delResult.userContext ? `${suggestion.rest ?? ''}\n\nUser context: ${delResult.userContext}` : suggestion.rest;
                return { delegated: true, responded: true, action: finalAction, reasoning, hardened: delResult.hardened ?? suggestion.hardened, tribunalMode: delResult.tribunalMode ?? suggestion.tribunalMode, team: delResult.team ?? suggestion.team };
              }
              return { delegated: false, responded: true };
            }
  
            // Buffer before streaming to detect [SUGGEST:mode]
            if (response.length < 40) continue;
  
            // Initial confidence is just informational — don't escalate yet.
            // The model needs to investigate first. Escalation happens post-stream
            // when we know if the model actually worked or just narrated.
  
            // Switch to streaming mode
            dispatch({ type: 'spinner-update', message: 'Cesar responding…' });
            streaming = true;
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
    if ((ctx as any)._hasNativeTools) {
      response = response.replace(/<tool\s+name="[^"]+">[\s\S]*?<\/tool>/g, '').trim();
    }
  
    // ── Await eager tool results ──
    if (eagerPromises.length > 0 && !(ctx as any)._hasNativeTools && session.alive && !abort.signal.aborted) {
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
        response = conf.rest;
      }
      confidenceParsed = true;
    }
  
    // ── Post-stream escalation — only NOW do we apply confidence tiers ──
    // Initial confidence was just "I haven't read the code yet". Now the model
    // has finished its turn (tool calls done, response complete). If confidence
    // is still low and model didn't delegate, escalate.
    if (parsedConfidence !== null && !secondOpinionPromise && !(ctx as any)._advisorPending && !_isFollowUp) {
      // Check: did the model delegate via tool call or [SUGGEST:mode]?
      const pendingDel = (ctx as any)._pendingDelegation;
      const didDelegate = !!pendingDel;
  
      if (!didDelegate) {
        if (parsedConfidence >= CONFIDENCE_TIERS.nero && parsedConfidence < CONFIDENCE_TIERS.direct) {
          // 88-92%: Nero — challenge on next turn
          activateNero(ctx, dispatch);
        } else if (parsedConfidence >= CONFIDENCE_TIERS.stop && parsedConfidence < CONFIDENCE_TIERS.nero) {
          // 70-87%: second opinion from best-ranked engine
          if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
          dispatch({ type: 'spinner-start', message: confidenceBadge(parsedConfidence) + ' Getting second opinion…', color });
          const secondResult = await fireSecondOpinion(input, ctx, abort);
          dispatch({ type: 'spinner-stop' });
          const escalation = await handleSecondOpinion(secondResult, input, response, parsedConfidence, cesarEngineId, dispatch, ctx);
          if (escalation) return escalation;
          activateNero(ctx, dispatch);
        } else if (parsedConfidence < CONFIDENCE_TIERS.stop) {
          // <70%: advisor
          if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
          dispatch({ type: 'spinner-start', message: confidenceBadge(parsedConfidence) + ' Consulting advisor…', color });
          const advisorResult = await fireAdvisor(input, response, parsedConfidence, ctx, abort);
          dispatch({ type: 'spinner-stop' });
          if (advisorResult) {
            const escalation = await handleSecondOpinion(advisorResult, input, response, parsedConfidence, cesarEngineId, dispatch, ctx);
            if (escalation) return escalation;
          } else {
            dispatch({ type: 'warning', message: 'Advisor unavailable' });
            appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
            appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
            tracker.record(cesarEngineId, input, response);
            const fallbackAnswer = await new Promise<string>((resolve) => {
              dispatch({ type: 'question', prompt: `Cesar ${parsedConfidence}% — no advisor. What next?`, choices: [
                { key: 'a', label: 'Accept Cesar', color: '#4ade80' },
                { key: 'b', label: 'Brainstorm', color: '#60a5fa' },
                { key: 't', label: 'Tribunal', color: '#f59e0b' },
                { key: 'f', label: 'Forge', color: '#a78bfa' },
              ], resolve } as any);
            });
            if (fallbackAnswer === 'b') return { delegated: true, responded: true, action: 'brainstorm', reasoning: response };
            if (fallbackAnswer === 't') return { delegated: true, responded: true, action: 'tribunal', reasoning: response };
            if (fallbackAnswer === 'f') return { delegated: true, responded: true, action: 'forge', reasoning: response };
            return { delegated: false, responded: true };
          }
        }
      }
    }
  
    // Post-stream: consume tool-reported confidence
    if (!confidenceParsed && (ctx as any)._reportedConfidence !== undefined) {
      const toolConf = (ctx as any)._reportedConfidence as number;
      delete (ctx as any)._reportedConfidence;
      parsedConfidence = toolConf;
      confidenceParsed = true;
      dispatch({ type: 'info', message: confidenceBadge(toolConf) + ` Cesar` });
      if (toolConf >= CONFIDENCE_TIERS.direct && (ctx as any)._autoNero) deactivateNero(ctx, dispatch);
    }
  
    // ── Check pending delegation from orchestration signal tools ──
    const pendingDel = (ctx as any)._pendingDelegation;
    if (pendingDel) {
      delete (ctx as any)._pendingDelegation;
      if (streaming) dispatch({ type: 'streaming-end', engineId: cesarEngineId });
      if (!streaming) dispatch({ type: 'spinner-stop' });
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(cesarEngineId, input, response);
      const delResult = await promptDelegation(pendingDel.action, dispatch, pendingDel.hardened, pendingDel.tribunalMode, pendingDel.team);
      if (delResult.approved) {
        const finalAction = delResult.action ?? pendingDel.action;
        let action = pendingDel.team ? `team-${finalAction}` : finalAction;
        const reasoning = delResult.userContext ? `${pendingDel.reasoning ?? ''}\n\nUser context: ${delResult.userContext}` : pendingDel.reasoning;
        return { delegated: true, responded: true, action, reasoning, hardened: delResult.hardened ?? pendingDel.hardened, tribunalMode: delResult.tribunalMode ?? pendingDel.tribunalMode, team: delResult.team ?? pendingDel.team };
      }
      return { delegated: false, responded: true };
    }
  
    // Check final response for suggestion/delegation
    const finalSuggestion = parseSuggestion(response);
    if (finalSuggestion.action) {
      if (!streaming) dispatch({ type: 'spinner-stop' });
      if (streaming) dispatch({ type: 'streaming-end', engineId: cesarEngineId });
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(cesarEngineId, input, response);
      if (finalSuggestion.rest) dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: finalSuggestion.rest });
      const delResult = await promptDelegation(finalSuggestion.action, dispatch, finalSuggestion.hardened, finalSuggestion.tribunalMode, finalSuggestion.team);
      if (delResult.approved) {
        const finalAction = delResult.action ?? finalSuggestion.action;
        const reasoning = delResult.userContext ? `${finalSuggestion.rest ?? ''}\n\nUser context: ${delResult.userContext}` : finalSuggestion.rest;
        return { delegated: true, responded: true, action: finalAction, reasoning, hardened: delResult.hardened ?? finalSuggestion.hardened, tribunalMode: delResult.tribunalMode ?? finalSuggestion.tribunalMode, team: delResult.team ?? finalSuggestion.team };
      }
      return { delegated: false, responded: true };
    }
  
    // ── XML tool loop — CLI engines always, API engines if they emitted text-based tool calls (e.g. GLM-5.1) ──
    let ranToolLoop = false;
    const hasTextToolCalls = response.includes('<tool_call_tool>') || response.includes('<tool name=');
    if (toolRegistry && response && (!(ctx as any)._hasNativeTools || hasTextToolCalls)) {
      const toolParsed = parseToolCalls(response);
      if (toolParsed.hasToolCalls) {
        if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
        const fileStateCache = new FileStateCache();
        const explorationMode = (ctx as any).explorationMode ?? false;
        const toolCtx: ToolContext = {
          cwd: resolveWorkingDir(), readFileState: (fileStateCache as any).cache, abortSignal: abort.signal,
          permissionMode: (config as any).permissionMode ?? 'ask', explorationMode,
          allowedCommands: (config as any).allowedCommands ?? [], toolPermissions: (config as any).toolPermissions ?? {},
          onProgress: (msg: string) => dispatch({ type: 'spinner-update', message: `Cesar: ${msg}` }),
        };
        const _lastToolInputs: Record<string, string> = {};
        const loopResult = await runToolLoop(
          async (message: string) => {
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
            },
            onToolResult: (name: string, result: any) => {
              const out = result.result.ok ? result.result.content : result.result.error;
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
  
    // ── Protocol enforcement: suggest mode when engine didn't ──
    if (!finalSuggestion.action && !ranToolLoop && !secondOpinionPromise && !_isFollowUp) {
      if (streaming) { dispatch({ type: 'streaming-end', engineId: cesarEngineId }); streaming = false; }
      const enforcement = await promptProtocolEnforcement(input, parsedConfidence, ctx, dispatch);
      if (enforcement) {
        appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
        appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
        tracker.record(cesarEngineId, input, response);
        return enforcement;
      }
    }
  
    // ── Display final response ──
    if (!streaming && response) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: response });
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId: cesarEngineId });
      dispatch({ type: 'spinner-stop' });
    }
  
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
      const tokenUsage = tracker.record(cesarEngineId, input, response);
  
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
      if ((ctx as any).cesarMemory) {
        const mem = (ctx as any).cesarMemory;
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
    (ctx as any)._cesarBusy = false;
    (ctx as any)._cesarBusySince = null;
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  
    // Auto-drain queue
    const queued = (ctx as any)._cesarQueue;
    if (queued) {
      (ctx as any)._cesarQueue = null;
      setTimeout(() => {
        handleCesarBrain(queued.input, queued.dispatch, ctx, queued.images).catch((err: any) => {
          console.error(`[cesar:queue] drain failed: ${err.message ?? err}`);
          (ctx as any)._cesarBusy = false;
        });
      }, 100);
    }
  }
}

