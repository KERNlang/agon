// @kern-source: dispatch:1
import { streamText, generateText, jsonSchema } from 'ai';

// @kern-source: dispatch:2
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// @kern-source: dispatch:3
import { createAnthropic } from '@ai-sdk/anthropic';

// @kern-source: dispatch:4
import type { DispatchResult } from '../models/types.js';

// @kern-source: dispatch:6
export interface ApiConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxTokens?: number;
  format?: 'openai'|'anthropic';
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
}

// @kern-source: dispatch:15
export function buildModel(config: ApiConfig): any {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) return null;
  
  const base = config.baseUrl.replace(/\/$/, '');
  
  if (config.format === 'anthropic') {
    // createAnthropic baseURL should include /v1 — it appends /messages
    const baseURL = base.endsWith('/v1') ? base : base + '/v1';
    const provider = createAnthropic({ apiKey, baseURL });
    return provider(config.model);
  }
  
  // OpenAI-compatible: baseURL is used as prefix, SDK appends /chat/completions
  const provider = createOpenAICompatible({
    name: 'agon-api',
    apiKey,
    baseURL: base,
  });
  return provider.chatModel(config.model);
}

// @kern-source: dispatch:39
export function convertToolsForSdk(tools: Array<{type:string,function:{name:string,description:string,parameters:Record<string,unknown>}}>): Record<string,any> {
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.function.name] = {
      description: t.function.description,
      inputSchema: jsonSchema(t.function.parameters as any),
      // No execute — tool execution is handled by the caller (persistent-session)
    };
  }
  return result;
}

// @kern-source: dispatch:53
export function convertMessagesForSdk(messages: Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>): any[] {
  // Build tool call ID -> name lookup for tool result messages
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) toolNameMap.set(tc.id, tc.function.name);
      }
    }
  }
  
  const result: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
    } else if (msg.role === 'user') {
      result.push({ role: 'user', content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? '') });
    } else if (msg.role === 'assistant') {
      const parts: any[] = [];
      if (msg.content && typeof msg.content === 'string') {
        parts.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments ?? {};
          } catch { args = {}; /* malformed tool_calls JSON — use empty args */ }
          parts.push({
            type: 'tool-call',
            toolCallId: tc.id ?? `call_${Date.now()}`,
            toolName: tc.function?.name ?? 'unknown',
            input: args,
          });
        }
      }
      if (parts.length > 0) {
        result.push({ role: 'assistant', content: parts });
      } else {
        // Empty assistant message (shouldn't happen but handle gracefully)
        result.push({ role: 'assistant', content: '' });
      }
    } else if (msg.role === 'tool') {
      const toolCallId = (msg as any).tool_call_id ?? '';
      const toolName = toolNameMap.get(toolCallId) ?? 'unknown';
      result.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId,
          toolName,
          output: {
            type: 'text' as const,
            value: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          },
        }],
      });
    }
  }
  
  return result;
}

// @kern-source: dispatch:120
export async function apiDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): Promise<DispatchResult> {
  const model = buildModel(config);
  if (!model) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Missing API key: set ${config.apiKeyEnv} environment variable`,
      durationMs: 0,
      timedOut: false,
    };
  }
  
  const startTime = Date.now();
  const messages: Array<{role: 'system'|'user', content: string}> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  
  try {
    const result = await generateText({
      model,
      messages,
      maxOutputTokens: config.maxTokens ?? 4096,
      abortSignal: controller.signal,
      maxRetries: 3,
    });
    clearTimeout(timer);
    const text = result.text || (result as any).reasoningText || '';
    const usage = result.usage ? {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      source: 'sdk' as const,
    } : undefined;
    return { exitCode: 0, stdout: text, stderr: '', durationMs: Date.now() - startTime, timedOut: false, usage };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;
    if (err instanceof Error && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout: '', stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout: '', stderr: `API request failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
}

// @kern-source: dispatch:172
export async function* apiStreamDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): AsyncGenerator<string, DispatchResult, void> {
  const messages: Array<{role:string, content:string}> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  return yield* apiStreamDispatchWithHistory(config, messages, timeout, signal);
}

// @kern-source: dispatch:180
export async function* apiStreamDispatchWithHistory(config: ApiConfig, messages: Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>, timeout: number, signal?: AbortSignal, tools?: Array<{type:string,function:{name:string,description:string,parameters:Record<string,unknown>}}>): AsyncGenerator<string, DispatchResult, void> {
  const model = buildModel(config);
  if (!model) {
    return { exitCode: 1, stdout: '', stderr: `Missing API key: set ${config.apiKeyEnv}`, durationMs: 0, timedOut: false };
  }
  
  const startTime = Date.now();
  
  // Convert messages to AI SDK CoreMessage format
  const coreMessages = convertMessagesForSdk(messages);
  
  // Set up timeout + external abort
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  
  let stdout = '';
  
  try {
    const streamOpts: any = {
      model,
      messages: coreMessages,
      maxOutputTokens: config.maxTokens ?? 4096,
      abortSignal: controller.signal,
      maxRetries: 3,
    };
  
    if (tools && tools.length > 0) {
      streamOpts.tools = convertToolsForSdk(tools);
    }
  
    const result = streamText(streamOpts);
  
    // Two-tier idle timeout: longer patience before first chunk (queuing/cold start),
    // tighter watchdog once streaming starts. Per-engine config overrides defaults.
    const FIRST_CHUNK_TIMEOUT = config.firstChunkTimeoutMs ?? 60_000;  // 60s default
    const IDLE_TIMEOUT = config.idleTimeoutMs ?? 15_000;              // 15s default
    const iterator = result.fullStream[Symbol.asyncIterator]();
    let iterDone = false;
    let gotFirstChunk = false;
  
    while (!iterDone) {
      const timeoutMs = gotFirstChunk ? IDLE_TIMEOUT : FIRST_CHUNK_TIMEOUT;
      const next = iterator.next();
      const idle = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('IDLE_TIMEOUT')), timeoutMs);
        next.then(() => clearTimeout(t), () => clearTimeout(t));
      });
  
      let iterResult: IteratorResult<any>;
      try {
        iterResult = await Promise.race([next, idle]);
      } catch (err: any) {
        if (err?.message === 'IDLE_TIMEOUT') {
          const phase = gotFirstChunk ? 'inter-chunk' : 'first-chunk';
          console.warn(`[agon] api-dispatch: ${phase} idle timeout (${timeoutMs / 1000}s) — breaking stream`);
          controller.abort();
          break;
        }
        throw err;
      }
  
      if (iterResult.done) { iterDone = true; break; }
      const part = iterResult.value;
  
      // Any productive event switches to tighter inter-chunk timeout
      if (!gotFirstChunk && (part.type === 'text-delta' || part.type === 'reasoning-delta' || part.type === 'tool-call')) {
        gotFirstChunk = true;
      }
  
      switch (part.type) {
        case 'text-delta': {
          stdout += (part as any).text;
          yield (part as any).text;
          break;
        }
        case 'reasoning-delta': {
          // Treat reasoning content as regular text (matches previous behavior
          // where reasoning_content was yielded alongside content)
          const text = (part as any).delta ?? '';
          if (text) {
            stdout += text;
            yield text;
          }
          break;
        }
        case 'tool-call': {
          // Emit as <tool> marker matching Agon's parseToolCalls regex
          const toolInput = (part as any).input ?? {};
          const marker = `\n<tool name="${(part as any).toolName}">${JSON.stringify(toolInput)}</tool>\n`;
          stdout += marker;
          yield marker;
          break;
        }
        case 'error': {
          clearTimeout(timer);
          return { exitCode: 1, stdout, stderr: `Stream error: ${String((part as any).error)}`, durationMs: Date.now() - startTime, timedOut: false };
        }
      }
    }
  
    clearTimeout(timer);
  
    let usage: DispatchResult['usage'] = undefined;
    try {
      const finalUsage = await (result as any).usage;
      if (finalUsage) {
        usage = {
          promptTokens: finalUsage.inputTokens ?? 0,
          completionTokens: finalUsage.outputTokens ?? 0,
          totalTokens: (finalUsage.inputTokens ?? 0) + (finalUsage.outputTokens ?? 0),
          source: 'sdk' as const,
        };
      }
    } catch { /* usage tokens optional — extraction failure is non-critical */ }
    return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false, usage };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;
    if (err instanceof Error && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout, stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout, stderr: `API stream failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
}

