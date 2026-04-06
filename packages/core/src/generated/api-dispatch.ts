// @kern-source: api-dispatch:1
import type { DispatchResult } from './types.js';

// @kern-source: api-dispatch:3
export interface ApiConfig {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxTokens?: number;
}

// @kern-source: api-dispatch:9
export async function apiDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): Promise<DispatchResult> {
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
      const errText = await response.text().catch(() => '');
      return {
        exitCode: 1,
        stdout: '',
        stderr: `API error ${response.status}: ${errText.slice(0, 500)}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    }
  
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
  
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

// @kern-source: api-dispatch:92
export async function* apiStreamDispatch(config: ApiConfig, prompt: string, timeout: number, signal?: AbortSignal, systemPrompt?: string): AsyncGenerator<string, DispatchResult, void> {
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
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            stdout += chunk;
            yield chunk;
          }
        } catch (_e) { /* skip malformed SSE lines */ }
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

