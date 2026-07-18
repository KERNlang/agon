import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', () => ({
  apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
}));

import { repairToolName, runApiAgentLoop } from '../../packages/core/src/generated/api/agent-loop.js';

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

async function* partialTimeoutStream() {
  yield 'partial before timeout';
  return {
    exitCode: 124,
    stdout: 'partial before timeout',
    stderr: 'API stream inter-chunk idle timeout',
    durationMs: 1,
    timedOut: true,
  };
}

async function* partialThrowTimeoutStream() {
  yield 'partial before thrown timeout';
  throw new Error('Request timed out while reading stream');
}

async function* partialFailureStream() {
  yield 'partial before transport failure';
  return {
    exitCode: 1,
    stdout: 'partial before transport failure',
    stderr: 'upstream stream closed',
    durationMs: 1,
    timedOut: false,
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
  it.each([
    ['webfetch', 'WebFetch'],
    ['WEBSEARCH', 'WebSearch'],
    ['todowrite', 'TodoWrite'],
    ['retrieveresult', 'RetrieveResult'],
  ])('repairs newer tool name %s to %s', (input, expected) => {
    expect(repairToolName(input, undefined)).toBe(expected);
  });

  it('returns the registry canonical name when a registered tool matches case-insensitively', () => {
    const registry = {
      get: (name: string) => name.toLowerCase() === 'customtool'
        ? { definition: { name: 'CustomTool' } }
        : undefined,
    };
    expect(repairToolName('CUSTOMTOOL', registry)).toBe('CustomTool');
  });
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

      // INVARIANT (finding 3): a throw-before-execute (the onToolCall listener
      // exploding) still counts one tool call — and it must carry EXACTLY one
      // native outcome, not increment totalToolCalls with no ledger outcome.
      expect(result.toolCalls).toBe(1);
      const nativeOutcomes = (result.toolOutcomes ?? []).filter((o) => o.provenance === 'native');
      expect(nativeOutcomes).toHaveLength(result.toolCalls);
      expect(nativeOutcomes[0]).toMatchObject({ tool: 'Read', status: 'error' });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('records exactly one native outcome for a semaphore-abort pre-execution failure (invariant)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-sem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });

    // A heavy-tool semaphore whose waiter is rejected on abort BEFORE the tool
    // runs — the exact seam where totalToolCalls++ used to happen with no outcome.
    const abortingSemaphore = {
      runWith: async () => {
        const e: any = new Error('aborted while queued for heavy-tool slot');
        e.name = 'AbortError';
        throw e;
      },
    };

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamChunks(['<tool name="Bash">{"command":"npm test"}</tool>']))
      .mockImplementationOnce(() => streamChunks(['done after semaphore abort']));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'run a heavy tool',
        cwd,
        timeout: 120,
        maxSteps: 3,
        heavyToolSemaphore: abortingSemaphore as any,
      });

      expect(result.response).toBe('done after semaphore abort');
      // The aborted heavy call is still counted as one tool call...
      expect(result.toolCalls).toBe(1);
      // ...and now carries EXACTLY one native error outcome (no silent gap).
      const nativeOutcomes = (result.toolOutcomes ?? []).filter((o) => o.provenance === 'native');
      expect(nativeOutcomes).toHaveLength(result.toolCalls);
      expect(nativeOutcomes[0]).toMatchObject({ tool: 'Bash', status: 'error' });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('emits only parsed visible narration and a verified final response', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-visible-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const visible: Array<{ text: string; phase: string }> = [];

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamChunks([
        'I will inspect it. <tool name="Read">{"file_path":"missing.txt"}</tool>',
      ]))
      .mockImplementationOnce(() => streamChunks(['Verified final answer.']));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Inspect and answer',
        cwd,
        timeout: 120,
        onVisibleChunk: (text, phase) => visible.push({ text, phase }),
      });

      expect(result.response).toBe('Verified final answer.');
      expect(visible).toEqual([
        { text: 'I will inspect it.', phase: 'narration' },
        { text: 'Verified final answer.', phase: 'final' },
      ]);
      expect(visible.map((entry) => entry.text).join('\n')).not.toContain('<tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not expose a truncated provider tool wrapper as final visible text', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-truncated-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const visible: Array<{ text: string; phase: string }> = [];
    apiStreamDispatchWithHistoryMock.mockImplementationOnce(() => streamChunks([
      'prefix <tool_ca',
    ]));

    try {
      await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Inspect and answer',
        cwd,
        timeout: 120,
        onVisibleChunk: (text, phase) => visible.push({ text, phase }),
      });

      expect(visible).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not emit a fake approval gate as a terminal visible response', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const visible: Array<{ text: string; phase: string }> = [];

    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamChunks(['I need user approval before I can edit.']))
      .mockImplementationOnce(() => streamChunks(['I continued autonomously.']));

    try {
      await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Continue',
        cwd,
        timeout: 120,
        onVisibleChunk: (text, phase) => visible.push({ text, phase }),
      });

      expect(visible).toEqual([{ text: 'I continued autonomously.', phase: 'final' }]);
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

  it('degrades to the last visible narration when the engine then goes silent (S3)', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });

    apiStreamDispatchWithHistoryMock
      // Step 1: visible narration + a tool call → loop continues, narration retained.
      .mockImplementationOnce(() => streamChunks(['Let me check the config file.\n<tool name="Read">{"file_path":"missing.txt"}</tool>']))
      // Then the engine goes reasoning-only until the retry budget is exhausted.
      .mockImplementationOnce(() => reasoningOnlyStream())
      .mockImplementationOnce(() => reasoningOnlyStream())
      .mockImplementationOnce(() => reasoningOnlyStream());

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Fix the thing',
        cwd,
        timeout: 120,
        maxSteps: 6,
      });

      // Best-effort partial surfaced instead of a bare error string...
      expect(result.response).toContain('Let me check the config file.');
      expect(result.response).not.toContain('Error: API engine produced hidden reasoning');
      // ...but the turn is still flagged failed so the caller classifies it as
      // an error turn (quarantine/diagnostic signal preserved via errorReason).
      expect(result.failed).toBe(true);
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

  it('still performs the first dispatch when the total timeout is 30 seconds or less', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamChunks(['quick answer']));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Answer quickly',
        cwd,
        timeout: 15,
      });

      expect(result.response).toBe('quick answer');
      expect(result.timedOut).toBeFalsy();
      expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('retries a transient failure inside a short total timeout when backoff fits', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => failStream('429 rate limit exceeded', 1))
      .mockImplementationOnce(() => streamChunks(['recovered quickly']));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Retry quickly',
        cwd,
        timeout: 15,
        retryBaseMs: 1,
      });
      expect(result.response).toBe('recovered quickly');
      expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves timeout state when a stream times out after partial output', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock.mockImplementation(() => partialTimeoutStream());

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep partial output',
        cwd,
        timeout: 120,
      });
      expect(result.response).toBe('partial before timeout');
      expect(result.failed).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.errorReason).toContain('idle timeout');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves timeout state when a stream throws after partial output', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock.mockImplementation(() => partialThrowTimeoutStream());

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep thrown-timeout output',
        cwd,
        timeout: 120,
      });
      expect(result.response).toBe('partial before thrown timeout');
      expect(result.failed).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.engineFault).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves partial output while marking a non-timeout transport failure as an engine fault', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock.mockImplementation(() => partialFailureStream());

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep partial output',
        cwd,
        timeout: 120,
      });
      expect(result.response).toBe('partial before transport failure');
      expect(result.failed).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.engineFault).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('treats a nonzero dispatch result with empty stderr as failure', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    apiStreamDispatchWithHistoryMock.mockImplementation(() => failStream('', 1));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Fail truthfully',
        cwd,
        timeout: 120,
      });
      expect(result.failed).toBe(true);
      expect(result.errorReason).toContain('exited with code 1');
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

  it('marks a caller abort as cancelled instead of completed', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    const controller = new AbortController();
    controller.abort();
    apiStreamDispatchWithHistoryMock.mockImplementation(() => failStream('aborted', 130));

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Stop now',
        cwd,
        timeout: 120,
        signal: controller.signal,
      });

      expect(result.cancelled).toBe(true);
      expect(result.failed).toBeFalsy();
      expect(result.errorReason).toContain('aborted');
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
      expect(result.failed).toBe(true);
      expect(result.harvestable).toBe(true);
      expect(result.errorReason).toContain('tool loop limit');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves the last visible narration when the shared deadline expires between tool steps', async () => {
    const cwd = join(tmpdir(), `agon-api-agent-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      now += 1_100;
      return streamChunks([
        'I inspected the current state. <tool name="Read">{"file_path":"missing.txt"}</tool>',
      ]);
    });

    try {
      const result = await runApiAgentLoop({
        api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'AGON_TEST_API_KEY', model: 'test-model' },
        prompt: 'Keep working',
        cwd,
        timeout: 1,
        maxSteps: 3,
      });

      expect(result.timedOut).toBe(true);
      expect(result.response).toContain('I inspected the current state.');
      expect(result.response).not.toBe('[Timeout — ran out of time]');
    } finally {
      nowSpy.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
