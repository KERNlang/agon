import type { DispatchResult } from './types.js';

export interface ApiConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxTokens?: number;
  format?: 'openai'|'anthropic';
}

export async function apiDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): Promise<DispatchResult> {
  // Route Anthropic format to Messages API
  if ((config as any).format === 'anthropic') {
    const messages: Array<{role:string,content:string}> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    let stdout = '';
    const gen = anthropicStreamDispatchWithHistory(config, messages, timeout, signal);
    let result: any;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      stdout += value as string;
    }
    return result ?? { exitCode: 0, stdout, stderr: '', durationMs: 0, timedOut: false };
  }
  
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Missing API key: set ${config.apiKeyEnv} environment variable`,
      durationMs: 0,
      timedOut: false,
    };
  }
  
  const startTime = Date.now();
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  
  // Separate system and user messages for cache-friendly dispatch.
  // System messages contain stable instructions that APIs can cache across calls.
  const messages: Array<{role: string, content: string}> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: config.maxTokens ?? 4096,
    stream: false,
  });
  
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);
  
    // Forward external abort signal
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });
  
    clearTimeout(timer);
  
    if (!response.ok) {
      // 429 rate limit — retry once after backoff
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') ?? '2', 10);
        const delay = Math.min(retryAfter, 10) * 1000;
        await new Promise(r => setTimeout(r, delay));
        const retry = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body, signal: controller.signal });
        if (retry.ok) {
          const data = await retry.json() as { choices?: Array<{ message?: { content?: string, reasoning_content?: string } }> };
          const msg = data.choices?.[0]?.message;
          return { exitCode: 0, stdout: msg?.content || msg?.reasoning_content || '', stderr: '', durationMs: Date.now() - startTime, timedOut: false };
        }
      }
      const errText = await response.text().catch(() => '');
      return {
        exitCode: 1,
        stdout: '',
        stderr: `API error ${response.status}: ${errText.slice(0, 500)}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    }
  
    const data = await response.json() as { choices?: Array<{ message?: { content?: string, reasoning_content?: string } }> };
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content || '';
  
    return {
      exitCode: 0,
      stdout: content,
      stderr: '',
      durationMs: Date.now() - startTime,
      timedOut: false,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout: '', stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout: '', stderr: `API request failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
}

export async function* apiStreamDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): AsyncGenerator<string, DispatchResult, void> {
  // Route Anthropic format to Messages API
  if ((config as any).format === 'anthropic') {
    const messages: Array<{role:string,content:string}> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return yield* anthropicStreamDispatchWithHistory(config, messages, timeout, signal);
  }
  
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return { exitCode: 1, stdout: '', stderr: `Missing API key: set ${config.apiKeyEnv}`, durationMs: 0, timedOut: false };
  }
  
  const startTime = Date.now();
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  
  const messages: Array<{role: string, content: string}> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
  });
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  
  let stdout = '';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
  
    clearTimeout(timer);
  
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { exitCode: 1, stdout: '', stderr: `API error ${response.status}: ${errText.slice(0, 500)}`, durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const reader = response.body?.getReader();
    if (!reader) {
      return { exitCode: 1, stdout: '', stderr: 'No response body', durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const decoder = new TextDecoder();
    let buffer = '';
  
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
  
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
  
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string, reasoning_content?: string } }> };
          const delta = parsed.choices?.[0]?.delta;
          const chunk = delta?.content ?? delta?.reasoning_content;
          if (chunk) {
            stdout += chunk;
            yield chunk;
          }
        } catch (_e) { console.warn(`[agon] api-dispatch: malformed SSE chunk skipped: ${data.slice(0, 120)}`); }
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout, stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout, stderr: `API stream failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
  
  return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false };
}

export async function* apiStreamDispatchWithHistory(config: ApiConfig, messages: Array<{role:string,content:string}>, timeout: number, signal?: AbortSignal, tools?: Array<{type:string,function:{name:string,description:string,parameters:Record<string,unknown>}}>): AsyncGenerator<string, DispatchResult, void> {
  if ((config as any).format === 'anthropic') {
    return yield* anthropicStreamDispatchWithHistory(config, messages, timeout, signal, tools);
  }
  
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return { exitCode: 1, stdout: '', stderr: `Missing API key: set ${config.apiKeyEnv}`, durationMs: 0, timedOut: false };
  }
  
  const startTime = Date.now();
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  
  const reqBody: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
  };
  if (tools && tools.length > 0) {
    reqBody.tools = tools;
  }
  
  const body = JSON.stringify(reqBody);
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  
  let stdout = '';
  // Accumulate tool calls from streaming deltas
  const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
  
    clearTimeout(timer);
  
    // 429 rate limit — retry up to 3 times with exponential backoff
    let activeResponse = response;
    let retryCount = 0;
    while (!activeResponse.ok && activeResponse.status === 429 && retryCount < 3) {
      retryCount++;
      const retryAfter = parseInt(activeResponse.headers.get('retry-after') ?? String(retryCount * 2), 10);
      const delay = Math.min(retryAfter, 15) * 1000;
      console.warn(`[agon] 429 rate limit — retry ${retryCount}/3 after ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
      activeResponse = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body, signal: controller.signal });
    }
    if (!activeResponse.ok) {
      const errText = await activeResponse.text().catch(() => '');
      return { exitCode: 1, stdout: '', stderr: `API error ${activeResponse.status}: ${errText.slice(0, 500)}`, durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const reader = activeResponse.body?.getReader();
    if (!reader) {
      return { exitCode: 1, stdout: '', stderr: 'No response body', durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = '';
  
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
  
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
  
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as any;
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
  
          // Text content
          const chunk = delta?.content ?? delta?.reasoning_content;
          if (chunk) {
            stdout += chunk;
            yield chunk;
          }
  
          // Tool call deltas — accumulate
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
              }
              const pending = pendingToolCalls.get(idx)!;
              if (tc.id) pending.id = tc.id;
              if (tc.function?.name) pending.name = tc.function.name;
              if (tc.function?.arguments) pending.arguments += tc.function.arguments;
            }
          }
  
          // Track finish reason
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        } catch (_e) { console.warn(`[agon] api-dispatch: malformed SSE chunk skipped: ${data.slice(0, 120)}`); }
      }
    }
  
    // If model returned tool calls, yield them as <tool> markers matching Agon's parser format
    if (pendingToolCalls.size > 0) {
      for (const [, tc] of pendingToolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = { raw: tc.arguments }; }
        // Use <tool name="X"> format — matches existing parseToolCalls regex
        const marker = `\n<tool name="${tc.name}">${JSON.stringify(parsedArgs)}</tool>\n`;
        stdout += marker;
        yield marker;
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout, stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout, stderr: `API stream failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
  
  return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false };
}

export async function* anthropicStreamDispatchWithHistory(config: ApiConfig, messages: Array<{role:string,content:string}>, timeout: number, signal?: AbortSignal, tools?: Array<{type:string,function:{name:string,description:string,parameters:Record<string,unknown>}}>): AsyncGenerator<string, DispatchResult, void> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    return { exitCode: 1, stdout: '', stderr: `Missing API key: set ${config.apiKeyEnv}`, durationMs: 0, timedOut: false };
  }
  
  const startTime = Date.now();
  // Don't double-append /v1 — some providers (MiniMax) already include /v1 in baseUrl
  const base = config.baseUrl.replace(/\/$/, '');
  const url = base.endsWith('/v1') ? base + '/messages' : base + '/v1/messages';
  
  // Separate system messages from conversation messages
  let systemPrompt = '';
  const apiMessages: Array<{role: string, content: string}> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
    } else {
      // Anthropic only accepts 'user' and 'assistant' roles
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      apiMessages.push({ role, content: msg.content });
    }
  }
  
  // Anthropic requires alternating user/assistant messages — merge consecutive same-role
  const merged: Array<{role: string, content: string}> = [];
  for (const msg of apiMessages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }
  
  // Anthropic requires first message to be 'user'
  if (merged.length === 0 || merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: '(continue)' });
  }
  
  const reqBody: Record<string, unknown> = {
    model: config.model,
    messages: merged,
    max_tokens: config.maxTokens ?? 8192,
    stream: true,
  };
  if (systemPrompt) {
    // Use structured system with cache_control for prompt caching.
    reqBody.system = [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ];
  }
  // Convert OpenAI tool format to Anthropic tool format
  if (tools && tools.length > 0) {
    reqBody.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
  
  const body = JSON.stringify(reqBody);
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return { exitCode: 130, stdout: '', stderr: 'Aborted', durationMs: 0, timedOut: false }; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  
  let stdout = '';
  // Accumulate tool calls from Anthropic tool_use content blocks
  const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let currentBlockIdx = -1;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body,
      signal: controller.signal,
    });
  
    clearTimeout(timer);
  
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { exitCode: 1, stdout: '', stderr: `Anthropic API error ${response.status}: ${errText.slice(0, 500)}`, durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const reader = response.body?.getReader();
    if (!reader) {
      return { exitCode: 1, stdout: '', stderr: 'No response body', durationMs: Date.now() - startTime, timedOut: false };
    }
  
    const decoder = new TextDecoder();
    let buffer = '';
  
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
  
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
  
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as any;
  
          // Anthropic SSE: content_block_start with tool_use type
          if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
            currentBlockIdx = parsed.index ?? (pendingToolCalls.size);
            pendingToolCalls.set(currentBlockIdx, {
              id: parsed.content_block.id ?? `call_${Date.now()}_${currentBlockIdx}`,
              name: parsed.content_block.name ?? '',
              arguments: '',
            });
          }
  
          // Anthropic SSE: content_block_delta with input_json_delta (tool arguments streaming)
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
            const idx = parsed.index ?? currentBlockIdx;
            const pending = pendingToolCalls.get(idx);
            if (pending && parsed.delta.partial_json) {
              pending.arguments += parsed.delta.partial_json;
            }
          }
  
          // Anthropic SSE: content_block_delta with text_delta
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const chunk = parsed.delta.text;
            if (chunk) {
              stdout += chunk;
              yield chunk;
            }
          }
        } catch (_e) { console.warn(`[agon] api-dispatch: malformed SSE chunk skipped: ${data.slice(0, 120)}`); }
      }
    }
  
    // Emit accumulated tool calls as <tool> markers (same as OpenAI path)
    if (pendingToolCalls.size > 0) {
      for (const [, tc] of pendingToolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = { raw: tc.arguments }; }
        const marker = `\n<tool name="${tc.name}">${JSON.stringify(parsedArgs)}</tool>\n`;
        stdout += marker;
        yield marker;
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { exitCode: signal?.aborted ? 130 : 124, stdout, stderr: 'Request timed out', durationMs, timedOut: !signal?.aborted };
    }
    return { exitCode: 1, stdout, stderr: `Anthropic API stream failed: ${err instanceof Error ? err.message : String(err)}`, durationMs, timedOut: false };
  }
  
  return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false };
}

