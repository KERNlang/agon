// @kern-source: chat:1
import { join } from 'node:path';

// @kern-source: chat:2
import { mkdirSync } from 'node:fs';

// @kern-source: chat:3
import type { ImageAttachment, DispatchResult } from '@agon/core';

// @kern-source: chat:4
import { RUNS_DIR, appendMessage, tracker, StreamParser, loadConfig, sessionContext, resolveWorkingDir } from '@agon/core';

// @kern-source: chat:5
import { ENGINE_COLORS } from '../blocks/output-format.js';

// @kern-source: chat:6
import type { Dispatch, HandlerContext } from '../../handlers/types.js';

// @kern-source: chat:7
import { yieldToInk } from '../cesar/brain.js';

// @kern-source: chat:10
export const _cachedCwd: {value:string|null} = { value: null };

// @kern-source: chat:13
function cachedCwd(): string {
  if (_cachedCwd.value === null) {
    _cachedCwd.value = resolveWorkingDir();
  }
  return _cachedCwd.value;
}

// @kern-source: chat:21
/**
 * Call when workspace changes (e.g. /workspace switch).
 */
export function invalidateCwdCache(): void {
  _cachedCwd.value = null;
}

// @kern-source: chat:27
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

// @kern-source: chat:43
export async function handleChat(input: string, dispatch: Dispatch, ctx: HandlerContext, images?: ImageAttachment[], opts?: {toolPolicy?:'full'|'none'}): Promise<void> {
  const abort = new AbortController();
  try {
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
    const cwd = cachedCwd();
    const projectCtx = sessionContext.get(cwd, config.projectContext || undefined, config.contextFormat);
    const parts: string[] = [];
    if (projectCtx) parts.push(`## PROJECT CONTEXT\n${projectCtx}`);
    if (history) parts.push(history);
    parts.push(message);
    const prompt = parts.join('\n\n');
    
    const color = ENGINE_COLORS[engineId] ?? 124;
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
    let dispatchResult: DispatchResult | undefined;
    
    try {
      if (useAgent && ctx.adapter.dispatchAgentStream) {
        const gen = ctx.adapter.dispatchAgentStream(dispatchOpts);
        const parser = new StreamParser();
    
        while (true) {
          const iterResult = await gen.next();
          if (iterResult.done) {
            // Capture AgentDispatchResult (generator return value contains diff)
            if (iterResult.value && typeof iterResult.value === 'object') {
              dispatchResult = iterResult.value as any;
            }
            break;
          }
          const value = iterResult.value;
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
        dispatchResult = result;
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
      await yieldToInk();
    }
    if (streaming) {
      dispatch({ type: 'streaming-end', engineId });
      await yieldToInk();
    }
    
    // Emit file-changes event if agent dispatch returned a diff
    if (dispatchResult && (dispatchResult as any).diff) {
      const agentDiff = (dispatchResult as any).diff as string;
      const fileMap = new Map<string, { additions: number; deletions: number; status: 'modified'|'created'|'deleted' }>();
      let currentFile = '';
      for (const line of agentDiff.split('\n')) {
        const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
        if (diffMatch) {
          currentFile = diffMatch[2];
          if (!fileMap.has(currentFile)) fileMap.set(currentFile, { additions: 0, deletions: 0, status: 'modified' });
        }
        if (currentFile && line.startsWith('new file')) {
          const entry = fileMap.get(currentFile);
          if (entry) entry.status = 'created';
        }
        if (currentFile && line.startsWith('deleted file')) {
          const entry = fileMap.get(currentFile);
          if (entry) entry.status = 'deleted';
        }
        if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
          const entry = fileMap.get(currentFile);
          if (entry) entry.additions++;
        }
        if (currentFile && line.startsWith('-') && !line.startsWith('---')) {
          const entry = fileMap.get(currentFile);
          if (entry) entry.deletions++;
        }
      }
      if (fileMap.size > 0) {
        dispatch({ type: 'file-changes', files: Array.from(fileMap.entries()).map(([path, info]) => ({ path, ...info })) } as any);
      }
    }
    
    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString(), images: images?.map(img => img.path) });
      appendMessage(ctx.chatSession, { role: 'engine', engineId, content: response, timestamp: new Date().toISOString() });
      if (dispatchResult?.usage) {
        tracker.record(engineId, { usage: dispatchResult.usage, model: engine.api?.model });
      } else {
        tracker.record(engineId, { prompt: input, response });
      }
    } else {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'info', message: 'No response.' });
    }
  } finally {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
  }
}

