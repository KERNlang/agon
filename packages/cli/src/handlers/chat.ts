import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ensureAgonHome,
  RUNS_DIR,
  appendMessage,
  tracker,
  parseStreamChunk,
  wordWrap,
  loadConfig,
} from '@agon/core';
import { ENGINE_COLORS } from '../output.js';
import type { Dispatch, HandlerContext } from './types.js';

/** Detect if message is addressed to a specific engine ("codex what do you think?") */
function detectTargetEngine(
  input: string,
  availableIds: string[],
): { engineId: string | null; message: string } {
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

export async function handleChat(
  input: string,
  dispatch: Dispatch,
  ctx: HandlerContext,
): Promise<void> {
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

  // Build prompt with chat history
  const recent = ctx.chatSession.messages.slice(-20);
  const history = recent.length > 0
    ? recent.map(m => m.role === 'user' ? `User: ${m.content}` : `${m.engineId ?? 'engine'}: ${m.content}`).join('\n\n')
    : '';
  const parts: string[] = [];
  if (history) parts.push(history);
  parts.push(message);
  const prompt = parts.join('\n\n');

  const engine = ctx.registry.get(engineId);
  const color = ENGINE_COLORS[engineId] ?? 245;
  const outputDir = join(RUNS_DIR, `chat-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const abort = new AbortController();
  ctx.setActiveAbort(abort);

  const dispatchOpts = {
    engine,
    prompt,
    cwd: process.cwd(),
    mode: 'exec' as const,
    timeout: Math.min(config.timeout ?? 90, 90),
    outputDir,
    signal: abort.signal,
  };

  dispatch({ type: 'spinner-start', message: `${engineId} thinking…`, color });

  try {
    let response = '';
    let streaming = false;

    if (ctx.adapter.dispatchStream) {
      const gen = ctx.adapter.dispatchStream(dispatchOpts);

      while (true) {
        const { value, done } = await gen.next();
        if (done) break;
        if (abort.signal.aborted) break;

        if (value.startsWith('\x00')) {
          const status = value.slice(1).trim();
          if (status) dispatch({ type: 'spinner-update', message: `${engineId} ${status}` });
          continue;
        }

        for (const parsed of parseStreamChunk(value)) {
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
    } else {
      const result = await ctx.adapter.dispatch(dispatchOpts);
      response = result.stdout;
    }

    if (abort.signal.aborted) {
      dispatch({ type: 'spinner-stop' });
      ctx.setActiveAbort(null);
      return;
    }

    ctx.setActiveAbort(null);
    response = response.trim();

    if (!streaming && response) {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'engine-block', engineId, color, content: response });
    }
    if (streaming) {
      // Newline after streaming
      dispatch({ type: 'text', content: '' });
    }

    if (response) {
      appendMessage(ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(ctx.chatSession, { role: 'engine', engineId, content: response, timestamp: new Date().toISOString() });
      tracker.record(engineId, input, response);
    } else {
      dispatch({ type: 'spinner-stop' });
      dispatch({ type: 'info', message: 'No response.' });
    }
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    ctx.setActiveAbort(null);
    if (abort.signal.aborted) return;
    dispatch({ type: 'error', message: `${engineId}: ${err instanceof Error ? err.message : String(err)}` });
  }
}
