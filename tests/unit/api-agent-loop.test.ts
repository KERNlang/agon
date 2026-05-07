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
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
