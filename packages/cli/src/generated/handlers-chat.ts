// @kern-source: handlers-chat:1
import { join } from 'node:path';

// @kern-source: handlers-chat:2
import { mkdirSync } from 'node:fs';

// @kern-source: handlers-chat:3
import type { ImageAttachment } from '@agon/core';

// @kern-source: handlers-chat:4
import { ensureAgonHome, RUNS_DIR, appendMessage, tracker, StreamParser, loadConfig, scanProjectContext, resolveWorkingDir } from '@agon/core';

// @kern-source: handlers-chat:5
import { ENGINE_COLORS } from '../output.js';

// @kern-source: handlers-chat:6
import type { Dispatch, HandlerContext } from '../handlers/types.js';

// @kern-source: handlers-chat:8
function detectTargetEngine(input: string, availableIds: string[]): {engineId:string|null,message:string} {
  const lower = input.toLowerCase();
  for (const id of availableIds) {
    if (lower.startsWith(id + ' ') || lower.startsWith(id + ',') || lower.startsWith(id + ':')) {
      return { engineId: id, message: input.slice(id.length).replace(/^[,:\s]+/, '').trim() || input };
    }
    const heyPattern = new RegExp(`^(?:hey|yo|ok)\\s+${id}\\b[,:]?\\s*`, 'i');
    const heyMatch = input.match(heyPattern);
    if (heyMatch) {
      return { engineId: id, message: input.slice(heyMatch[0].length).trim() || input };
    }
  }
  return { engineId: null, message: input };
}

// @kern-source: handlers-chat:24
export async function handleChat(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[], opts?: {toolPolicy?:'full'|'none'}): Promise<void> {
  const abort = new AbortController();
  try {
    ensureAgonHome();
    
    const available = ctx.activeEngines();
    if (available.length === 0) {
      dispatch({ type: 'error', message: 'No engines available.' });
      return;
    }
    
    const { engineId: targetId, message } = detectTargetEngine(input, available);
    const config = ctx.config;
    
    const engineId = targetId
      ?? config.forgeFixedStarter
      ?? available[0];
    
    if (!available.includes(engineId)) {
      dispatch({ type: 'error', message: `${engineId} is not available. Try: ${available.join(', ')}` });
      return;
    }
    
    let engine;
    try {
      engine = ctx.registry.get(engineId);
    } catch (err) {
      dispatch({ type: 'error', message: `${engineId}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    
    const recent = ctx.chatSession.messages.slice(-20);
    const history = recent.length > 0
      ? recent.map((m: any) => m.role === 'user' ? `User: ${m.content}` : `${m.engineId ?? 'engine'}: ${m.content}`).join('\n\n')
      : '';
    const cwd = resolveWorkingDir();
    const projectCtx = scanProjectContext(cwd, config.projectContext || undefined, config.contextFormat);
    const parts: string[] = [];
    if (projectCtx) parts.push(`## PROJECT CONTEXT\n${projectCtx}`);
    if (history) parts.push(history);
    parts.push(message);
    const prompt = parts.join('\n\n');
    
    const color = ENGINE_COLORS[engineId] ?? 245;
    const outputDir = join(RUNS_DIR, `chat-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    
    ctx.setActiveAbort(abort);
    
    const forceNoTools = opts?.toolPolicy === 'none';
    const useAgent = !forceNoTools && !!engine.agent;
    const dispatchOpts = {
      engine,
      prompt,
      cwd,
      mode: (useAgent ? 'agent' : 'exec') as 'agent' | 'exec',
      timeout: useAgent ? (config.agentTimeout ?? 600) : Math.min(config.timeout ?? 90, 90),
      outputDir,
      signal: abort.signal,
      images: images ?? [],
    };
    
    dispatch({ type: 'spinner-start', message: `${engineId} thinking…`, color });
    
    let response = '';
    let streaming = false;
    
    try {
      if (useAgent && ctx.adapter.dispatchAgentStream) {
        const gen = ctx.adapter.dispatchAgentStream(dispatchOpts);
        const parser = new StreamParser();
    
        while (true) {
          const { value, done } = await gen.next();
          if (done) break;
          if (abort.signal.aborted) break;
    
          if (value.startsWith('\x00')) {
            const status = value.slice(1).trim();
            if (status) dispatch({ type: 'spinner-update', message: `${engineId} ${status}` });
            continue;
          }
    
          for (const parsed of parser.feed(value)) {
            if (parsed.type === 'status') {
              dispatch({ type: 'spinner-update', message: `${engineId} ${parsed.content}` });
              continue;
            }
            if (parsed.type === 'result' && !streaming) {
              response = parsed.content;
              continue;
            }
            if (parsed.type === 'text' || parsed.type === 'raw') {
              if (!streaming) {
                dispatch({ type: 'spinner-stop' });
                streaming = true;
              }
              dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
              response += parsed.content;
            }
          }
        }
    
        // Flush any remaining buffered data
        for (const parsed of parser.flush()) {
          if (parsed.type === 'text' || parsed.type === 'raw') {
            if (!streaming) {
              dispatch({ type: 'spinner-stop' });
              streaming = true;
            }
            dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
            response += parsed.content;
          } else if (parsed.type === 'result' && !streaming) {
            response = parsed.content;
          }
        }
      } else if (ctx.adapter.dispatchStream) {
        const gen = ctx.adapter.dispatchStream(dispatchOpts);
        const parser = new StreamParser();
    
        while (true) {
          const { value, done } = await gen.next();
          if (done) break;
          if (abort.signal.aborted) break;
    
          if (value.startsWith('\x00')) {
            const status = value.slice(1).trim();
            if (status) dispatch({ type: 'spinner-update', message: `${engineId} ${status}` });
            continue;
          }
    
          for (const parsed of parser.feed(value)) {
            if (parsed.type === 'status') {
              dispatch({ type: 'spinner-update', message: `${engineId} ${parsed.content}` });
              continue;
            }
            if (parsed.type === 'result' && !streaming) {
              response = parsed.content;
              continue;
            }
            if (parsed.type === 'text' || parsed.type === 'raw') {
              if (!streaming) {
                dispatch({ type: 'spinner-stop' });
                streaming = true;
              }
              dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
              response += parsed.content;
            }
          }
        }
    
        // Flush any remaining buffered data
        for (const parsed of parser.flush()) {
          if (parsed.type === 'text' || parsed.type === 'raw') {
            if (!streaming) {
              dispatch({ type: 'spinner-stop' });
              streaming = true;
            }
            dispatch({ type: 'streaming-chunk', engineId, chunk: parsed.content });
            response += parsed.content;
          } else if (parsed.type === 'result' && !streaming) {
            response = parsed.content;
          }
        }
      } else {
        const result = await ctx.adapter.dispatch(dispatchOpts);
        response = result.stdout;
      }
    } catch (err) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'error', message: `${engineId}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    
    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      return;
    }
    
    response = response.trim();
    
    if (!streaming && response) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'engine-block', engineId, color, content: response });
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId });
    }
    
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString(), images: images?.map(img => img.path) });
      appendMessage(ctx.chatSession, { role: 'engine', engineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(engineId, { prompt: input, response });
    } else {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'info', message: 'No response.' });
    }
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

