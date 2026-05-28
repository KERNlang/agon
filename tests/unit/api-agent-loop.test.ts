import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', () => ({
  apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
}));

import { runApiAgentLoop } from '../../packages/core/src/generated/api/agent-loop.js';

async function* streamChunks(chunks: string[]) {
  for (const chunk of chunks) yield chunk;
  return {
    exitCode: 0,
    stdout: chunks.join(''),
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
}

// A dispatch that yields no text and returns a failure DispatchResult — how
// apiStreamDispatchWithHistory surfaces timeouts / rate-limits / stream errors.
async function* failStream(stderr: string, exitCode = 1) {
  return {
    exitCode,
    stdout: '',
    stderr,
    durationMs: 1,
    timedOut: exitCode === 124,
  };
}

async function* reasoningOnlyStream() {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    timedOut: false,
    parts: [{ kind: 'reasoning', text: 'I should inspect the code first.' }],
  };
}

describe('runApiAgentLoop', () => {
  beforeEach(() => {
    apiStreamDispatchWithHistoryMock.mockReset();
  });

  it('records a tool result when local tool plumbing throws after an assistant tool call', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const historyEntries: Array<Record<string, unknown>> = [];
    let secondStepHistory: Array<Record<string, unknown>> = [];

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamChunks([
        '<tool name="Read">{"file_path":"missing.txt"}</tool>',
      ]))
      .mockImplementationOnce((_api, messages) => {
        secondStepHistory = messages;
        return streamChunks(['done']);
      });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Read missing.txt',
        cwd,
        timeout: 120,
        maxSteps: 3,
        onToolCall: () => {
          throw new Error('tool callback exploded');
        },
        onHistoryEntry: (entry) => {
          historyEntries.push(entry);
        },
      });

      expect(result.response).toBe('done');
      expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(2);

      const assistantEntry = historyEntries.find((entry) => Array.isArray((entry as any).tool_calls));
      expect(assistantEntry).toBeTruthy();
      const toolCallId = (assistantEntry as any).tool_calls[0].id;
      const toolEntry = historyEntries.find((entry) => entry.role === 'tool' && entry.tool_call_id === toolCallId);
      expect(toolEntry).toBeTruthy();
      expect(String(toolEntry?.content)).toContain('Tool loop failed before producing a result');
      expect(secondStepHistory.some((entry: any) => entry.role === 'tool' && entry.tool_call_id === toolCallId)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reprompts when an API stream returns only hidden reasoning', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    let secondStepHistory: Array<Record<string, unknown>> = [];

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => reasoningOnlyStream())
      .mockImplementationOnce((_api, messages) => {
        secondStepHistory = messages;
        return streamChunks(['visible answer']);
      });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Fix the thing',
        cwd,
        timeout: 120,
        maxSteps: 3,
      });

      expect(result.response).toBe('visible answer');
      expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(2);
      expect(secondStepHistory.some((entry: any) => entry.role === 'user' && String(entry.content).includes('hidden reasoning'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails loudly when an API stream stays empty', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => reasoningOnlyStream())
      .mockImplementationOnce(() => reasoningOnlyStream())
      .mockImplementationOnce(() => reasoningOnlyStream());

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Fix the thing',
        cwd,
        timeout: 120,
        maxSteps: 5,
      });

      expect(result.response).toContain('Error: API engine produced hidden reasoning');
      expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(3);
      // RC2: empty/hidden-only output fails the turn but is NOT an engine fault
      // — the model misbehaved, the transport was fine, so it stays selectable.
      expect(result.failed).toBe(true);
      expect(result.engineFault).toBeFalsy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('retries a transient API failure with backoff, then completes (same step)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    let calls = 0;

    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      calls++;
      if (calls === 1) return failStream('Request timed out', 124);
      if (calls === 2) return failStream('429 rate limit exceeded — overloaded', 1);
      return streamChunks(['recovered and finished']);
    });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Do the thing despite a flaky network',
        cwd,
        timeout: 120,
        retryBaseMs: 1, // keep the test fast
      });

      expect(result.response).toBe('recovered and finished');
      expect(calls).toBe(3);       // 2 transient failures + 1 success
      expect(result.steps).toBe(1); // retries do NOT consume agent steps
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('recomputes the per-step timeout on each reconnect (never stale/growing)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const timeoutsSeen: number[] = [];
    let calls = 0;

    apiStreamDispatchWithHistoryMock.mockImplementation((_api: unknown, _msgs: unknown, timeoutSec: number) => {
      timeoutsSeen.push(timeoutSec);
      calls++;
      return calls <= 2 ? failStream('Request timed out', 124) : streamChunks(['ok']);
    });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'recover',
        cwd,
        timeout: 120,
        retryBaseMs: 5,
      });

      expect(result.response).toBe('ok');
      expect(timeoutsSeen.length).toBe(3);
      // Each attempt recomputes remaining from the shared deadline, so the value
      // passed to dispatch only ever shrinks — never reuses a stale larger one.
      for (let i = 1; i < timeoutsSeen.length; i++) {
        expect(timeoutsSeen[i]).toBeLessThanOrEqual(timeoutsSeen[i - 1]);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does NOT retry a permanent failure (missing API key)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    let calls = 0;

    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      calls++;
      return failStream('Missing API key: set AGON_TEST_API_KEY environment variable', 1);
    });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Try',
        cwd,
        timeout: 120,
        retryBaseMs: 1,
      });

      expect(result.response).toContain('Missing API key');
      expect(calls).toBe(1); // permanent failure must not be retried
      // RC2: a permanent dispatch failure is flagged as an engine fault so the
      // session classifies it as an error turn (not a 0-tool 'completed') and
      // the engine is quarantined for the session.
      expect(result.failed).toBe(true);
      expect(result.engineFault).toBe(true);
      expect(result.errorReason).toContain('Missing API key');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('runs well past 10 tool steps by default (time-bounded, not capped at 10)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    let calls = 0;

    // Call a tool 12 times, then answer. Old default (10) would have bailed with
    // the "tool loop limit" message at step 10; the new default lets it finish.
    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      calls++;
      return calls <= 12
        ? streamChunks(['<tool name="Read">{"file_path":"missing.txt"}</tool>'])
        : streamChunks(['finished after twelve tool calls']);
    });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep going until done',
        cwd,
        timeout: 120,
        // NOTE: no maxSteps — exercises the default safety ceiling (200), not a small cap.
      });

      expect(result.response).toBe('finished after twelve tool calls');
      expect(result.response).not.toContain('tool loop limit');
      expect(calls).toBeGreaterThan(11);
      expect(result.toolCalls).toBe(12);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not return empty output when the tool loop reaches max steps', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });

    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamChunks([
      '<tool name="Read">{"file_path":"missing.txt"}</tool>',
    ]));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep reading',
        cwd,
        timeout: 120,
        maxSteps: 2,
      });

      expect(result.response).toContain('tool loop limit');
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.toolCalls).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
