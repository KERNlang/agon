import { join } from 'node:path';

import { mkdirSync } from 'node:fs';

import type { EngineAdapter, ImageAttachment, PersistentSession, PersistentSessionConfig, SessionChunk } from '@agon/core';

import { EngineRegistry, loadConfig, ensureAgonHome, RUNS_DIR, appendMessage, tracker, scanProjectContext, StreamParser, createPersistentSession, resolveWorkingDir, ToolRegistry, FileStateCache, createReadTool, createEditTool, createWriteTool, createBashTool, createGrepTool, createGlobTool, buildToolSystemPrompt, parseToolCalls, processToolResponse } from '@agon/core';

import type { ToolContext } from '@agon/core';

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

export async function ensureCesarSession(ctx: HandlerContext): Promise<PersistentSession> {
  // Return existing alive session
  if (ctx.cesarSession && ctx.cesarSession.alive) {
    return ctx.cesarSession;
  }
  
  const config = ctx.config;
  const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
  let engine;
  try {
    engine = ctx.registry.get(cesarEngineId);
  } catch {
    throw new Error(`Cesar engine "${cesarEngineId}" not found`);
  }
  
  const binaryPath = ctx.registry.findBinary(engine);
  if (!binaryPath) {
    throw new Error(`Binary for "${cesarEngineId}" not found`);
  }
  
  // Build context for system prompt
  const cesarCwd = resolveWorkingDir();
  const projectCtx = scanProjectContext(cesarCwd, config.projectContext || undefined);
  const available = ctx.activeEngines();
  const engineList = available.map((id: string) => {
    try {
      const e = ctx.registry.get(id);
      const hasAgent = !!e.agent;
      return `- ${id}${hasAgent ? ' (agent-capable)' : ''}`;
    } catch { return `- ${id}`; }
  }).join('\n');
  
  const systemParts: string[] = [CESAR_SYSTEM_PROMPT];
  if (projectCtx) systemParts.push(`## PROJECT CONTEXT\n${projectCtx}`);
  systemParts.push(`## AVAILABLE ENGINES\n${engineList}`);
  
  // Replay existing conversation history into system prompt so Cesar doesn't lose context on reboot
  if (ctx.chatSession && ctx.chatSession.messages && ctx.chatSession.messages.length > 0) {
    const historyLines: string[] = [];
    // Cap at last 20 messages to avoid blowing context
    const recent = ctx.chatSession.messages.slice(-20);
    for (const msg of recent) {
      if (msg.role === 'user') {
        historyLines.push(`User: ${msg.content}`);
      } else {
        const eid = (msg as any).engineId ?? 'engine';
        historyLines.push(`${eid}: ${msg.content}`);
      }
    }
    systemParts.push(`## CONVERSATION HISTORY (session resumed)\nThe user has an ongoing conversation. Here is the recent context:\n\n${historyLines.join('\n\n')}`);
  }
  
  // Initialize tool registry and inject tool prompt — works with ANY engine
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadTool());
  toolRegistry.register(createEditTool());
  toolRegistry.register(createWriteTool());
  toolRegistry.register(createBashTool());
  toolRegistry.register(createGrepTool());
  toolRegistry.register(createGlobTool());
  const toolPrompt = buildToolSystemPrompt(toolRegistry);
  systemParts.push(toolPrompt);
  
  // Store registry on context for tool execution during responses
  (ctx as any)._toolRegistry = toolRegistry;
  
  const sessionConfig: PersistentSessionConfig = {
    engine,
    binaryPath,
    cwd: cesarCwd,
    systemPrompt: systemParts.join('\n\n'),
  };
  
  const session = createPersistentSession(sessionConfig);
  await session.start();
  ctx.setCesarSession(session);
  return session;
}

export async function handleCesarBrain(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[]): Promise<{delegated:boolean, responded:boolean, action?:string, reasoning?:string}> {
  const abort = new AbortController();
  try {
    ensureAgonHome();
  
    const config = ctx.config;
    const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    const available = ctx.activeEngines();
  
    if (!available.includes(cesarEngineId)) {
      return { delegated: false, responded: false };
    }
  
    const color = ENGINE_COLORS[cesarEngineId] ?? 245;
    ctx.setActiveAbort(abort);
    dispatch({ type: 'spinner-start', message: 'Cesar thinking…', color });
  
    // Boot or reuse persistent session
    let session: PersistentSession;
    try {
      session = await ensureCesarSession(ctx);
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      return { delegated: false, responded: false };
    }
  
    // Ensure tool registry is always available (ensureCesarSession only creates it on first boot)
    if (!(ctx as any)._toolRegistry) {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register(createReadTool());
      toolRegistry.register(createEditTool());
      toolRegistry.register(createWriteTool());
      toolRegistry.register(createBashTool());
      toolRegistry.register(createGrepTool());
      toolRegistry.register(createGlobTool());
      (ctx as any)._toolRegistry = toolRegistry;
    }
  
    let response = '';
    let streaming = false;
    let delegated = false;
  
    try {
      const gen = session.send({ message: input, signal: abort.signal, images: images?.map(img => img.path) });
  
      for await (const chunk of gen) {
        if (abort.signal.aborted) break;
  
        if (chunk.type === 'status') {
          dispatch({ type: 'spinner-update', message: `Cesar ${chunk.content}` });
          continue;
        }
  
        if (chunk.type === 'tool_call') {
          const meta = (chunk.metadata ?? {}) as Record<string, unknown>;
          const toolInput = typeof meta.input === 'string' ? meta.input
            : meta.input ? JSON.stringify(meta.input) : '';
          const toolOutput = typeof meta.output === 'string' ? meta.output : undefined;
          dispatch({
            type: 'tool-call',
            engineId: cesarEngineId,
            tool: chunk.content || 'tool',
            input: toolInput,
            status: (meta.status as any) ?? 'running',
            output: toolOutput,
          } as any);
          continue;
        }
  
        if (chunk.type === 'error') {
          dispatch({ type: 'spinner-stop' });
          // Session died — clear it so next message reboots
          ctx.setCesarSession(null);
          return { delegated: false, responded: false };
        }
  
        if (chunk.type === 'done') {
          break;
        }
  
        if (chunk.type === 'text') {
          if (!streaming) {
            response += chunk.content;
            // Check for delegation marker before streaming
            const { action } = parseDelegation(response);
            if (action) {
              dispatch({ type: 'spinner-stop' });
              const { rest } = parseDelegation(response);
              appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
              appendMessage(ctx.chatSession, { role: 'engine', engineId: cesarEngineId, content: response, timestamp: new Date().toISOString() });
              tracker.record(cesarEngineId, input, response);
              if (rest) dispatch({ type: 'info', message: `Cesar: ${rest}` });
              delegated = true;
              return { delegated: true, responded: true, action, reasoning: rest };
            }
            dispatch({ type: 'spinner-stop' });
            streaming = true;
            dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: response });
          } else {
            response += chunk.content;
            dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk: chunk.content });
          }
        }
      }
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      // Session error — clear and fall back
      ctx.setCesarSession(null);
      return { delegated: false, responded: false };
    }
  
    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return { delegated: false, responded: false };
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
      return { delegated: true, responded: true, action, reasoning: rest };
    }
  
    // Check for tool calls in response — execute locally, feed results back
    const toolRegistry = (ctx as any)._toolRegistry as ToolRegistry | undefined;
    if (toolRegistry && response) {
      const toolParsed = parseToolCalls(response);
      if (toolParsed.hasToolCalls) {
        // Stop streaming — replace the live stream (which has XML) with just the clean text
        if (streaming) {
          // End streaming first (flushes buffer as engine-block with XML)
          dispatch({ type: 'streaming-end', engineId: cesarEngineId });
        }
        streaming = false;
  
        // Show text before tool calls (clean prose, no XML)
        // This appears AFTER the flushed streaming block — the XML block is visible briefly
        // but the tool results below it make the flow clear
        if (toolParsed.textBefore) {
          dispatch({ type: 'engine-block', engineId: cesarEngineId, color, content: toolParsed.textBefore });
        }
  
        // Build tool context — 'auto' mode: edits/writes auto-allowed within CWD, only dangerous bash prompts
        const fileStateCache = new FileStateCache();
        const explorationMode = (ctx as any).explorationMode ?? false;
        const toolCtx: ToolContext = {
          cwd: resolveWorkingDir(),
          readFileState: (fileStateCache as any).cache,
          abortSignal: abort.signal,
          permissionMode: 'auto',
          explorationMode,
          onProgress: (msg: string) => dispatch({ type: 'spinner-update', message: `Cesar: ${msg}` }),
        };
  
        // Execute tool calls and show them inline
        const _lastToolInputs: Record<string, string> = {};
        const processed = await processToolResponse(response, toolCtx, toolRegistry, {
          onToolCall: (name: string, inp: Record<string, unknown>) => {
            const inputJson = JSON.stringify(inp);
            _lastToolInputs[name] = inputJson;
            dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: name, input: inputJson, status: 'running' });
          },
          onToolResult: (name: string, result: any) => {
            const out = result.result.ok ? result.result.content : result.result.error;
            dispatch({
              type: 'tool-call',
              engineId: cesarEngineId,
              tool: name,
              input: _lastToolInputs[name] ?? '',
              status: result.result.ok ? 'done' : 'error',
              output: out,
            });
            delete _lastToolInputs[name];
          },
          onPermissionAsk: async (tool: string, message: string) => {
            // Show styled permission prompt and wait for user response
            return new Promise<boolean>((resolve) => {
              // Extract command from the last tool input
              const lastInput = _lastToolInputs[tool] ?? '{}';
              let command = '';
              try {
                const parsed = JSON.parse(lastInput);
                command = parsed.command ?? parsed.file_path ?? lastInput;
              } catch { command = lastInput; }
              dispatch({
                type: 'permission-ask',
                tool,
                command,
                reason: message,
                resolve,
              } as any);
            });
          },
        });
  
        // Send tool results back to session for next turn
        if (processed.toolResults && session.alive) {
          dispatch({ type: 'spinner-start', message: 'Cesar processing tool results…', color });
          let toolResponse = '';
          const toolGen = session.send({ message: processed.toolResults, signal: abort.signal });
          for await (const chunk of toolGen) {
            if (chunk.type === 'text') toolResponse += chunk.content;
            if (chunk.type === 'done' || chunk.type === 'error') break;
          }
          response = toolResponse.trim();
          // Recurse: the tool response might contain more tool calls
          // For now, just show it — recursive tool loops can be added later
        }
      }
    }
  
    // Direct response
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
      return { delegated: false, responded: true };
    } else {
      dispatch({ type: 'spinner-stop' });
    }
  
    return { delegated: false, responded: false };
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

