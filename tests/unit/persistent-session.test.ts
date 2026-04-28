import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const spawnMock = vi.fn();
const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock };
});

vi.mock('../../packages/core/src/generated/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/generated/api/dispatch.js')>();
  return {
    ...actual,
    apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
  };
});

async function* streamTextToolCall(toolName: string, input: Record<string, unknown>) {
  yield `<tool name="${toolName}">${JSON.stringify(input)}</tool>`;
  return {};
}

async function* streamStaleReadRetryBatch(count: number) {
  const calls = Array.from({ length: count }, (_, index) =>
    `<tool name="Read">${JSON.stringify({ file_path: `src/file-${index}.ts` })}</tool>`,
  ).join('\n');
  yield `I see the issue. The file was modified since my last read. Let me re-read and then edit.\n${calls}`;
  return {};
}

function createMockProcess(onLine: (line: string, stdout: PassThrough) => void) {
  const proc = new EventEmitter() as any;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let buffer = '';
  stdin.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const idx = buffer.indexOf('\n');
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim()) onLine(line, stdout);
    }
  });

  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 4242;
  proc.kill = vi.fn();

  return proc;
}

async function collectTextChunks(gen: AsyncGenerator<{ type: string; content: string }>) {
  const parts: string[] = [];
  for await (const chunk of gen) {
    if (chunk.type === 'text') parts.push(chunk.content);
  }
  return parts;
}

afterEach(() => {
  spawnMock.mockReset();
  apiStreamDispatchWithHistoryMock.mockReset();
});

describe('persistent session streaming dedupe', () => {
  it('dedupes Codex companion completed messages after deltas and forwards MCP servers on thread start', async () => {
    let threadStartParams: Record<string, unknown> | null = null;
    spawnMock.mockImplementationOnce(() => createMockProcess((line, stdout) => {
      const msg = JSON.parse(line);

      if (msg.id && msg.method === 'initialize') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'thread/start') {
        threadStartParams = msg.params;
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'thread-1' } } }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'turn/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { delta: 'Hey. ' },
        }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { delta: 'What do you need help with in Agon-AI?' },
        }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            item: {
              type: 'agentMessage',
              text: 'Hey. What do you need help with in Agon-AI?',
            },
          },
        }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: {} }) + '\n');
      }
    }));

    const { createCompanionSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');
    const session = createCompanionSession({
      engine: {
        id: 'codex',
        binary: 'codex',
        companion: { protocol: 'jsonrpc', serverCmd: ['app-server'] },
      } as any,
      binaryPath: '/usr/local/bin/codex',
      cwd: process.cwd(),
      systemPrompt: 'You are helpful.',
      mcpServers: [{ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }],
    });

    await session.start();
    const text = (await collectTextChunks(session.send({ message: 'hey' }))).join('');

    expect(text).toBe('Hey. What do you need help with in Agon-AI?');
    expect(threadStartParams).toMatchObject({
      cwd: process.cwd(),
      mcpServers: [{ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }],
    });
  });

  it('uses developerInstructions (not instructions) in thread/start params', async () => {
    let capturedParams: Record<string, unknown> | null = null;
    spawnMock.mockImplementationOnce(() => createMockProcess((line, stdout) => {
      const msg = JSON.parse(line);

      if (msg.id && msg.method === 'initialize') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'thread/start') {
        capturedParams = msg.params;
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'thread-2' } } }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'turn/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta: 'OK' } }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'agentMessage', text: 'OK' } } }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: {} }) + '\n');
      }
    }));

    const { createCompanionSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');
    const session = createCompanionSession({
      engine: {
        id: 'codex',
        binary: 'codex',
        companion: { protocol: 'jsonrpc', serverCmd: ['app-server'] },
      } as any,
      binaryPath: '/usr/local/bin/codex',
      cwd: process.cwd(),
      systemPrompt: 'You are a coding assistant.',
    });

    await session.start();
    await collectTextChunks(session.send({ message: 'hi' }));

    expect(capturedParams).toBeDefined();
    // Must use developerInstructions, NOT instructions
    expect((capturedParams as any).developerInstructions).toBe('You are a coding assistant.');
    expect((capturedParams as any).instructions).toBeUndefined();
  });

  it('dedupes Claude result text after streamed deltas and assistant snapshot', async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = createMockProcess((line, stdout) => {
        const msg = JSON.parse(line);
        if (msg.type !== 'user') return;

        stdout.write(JSON.stringify({
          type: 'content_block_delta',
          delta: { text: 'Hey. ' },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'content_block_delta',
          delta: { text: 'What do you need help with in Agon-AI?' },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hey. What do you need help with in Agon-AI?' }],
            stop_reason: 'end_turn',
          },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'result',
          result: 'Hey. What do you need help with in Agon-AI?',
        }) + '\n');
      });

      setTimeout(() => {
        proc.stdout.write(JSON.stringify({
          type: 'system',
          session_id: 'claude-session-1',
          message: 'ready',
        }) + '\n');
      }, 0);

      return proc;
    });

    const { createStreamJsonSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');
    const session = createStreamJsonSession({
      engine: { id: 'claude', binary: 'claude' } as any,
      binaryPath: '/usr/local/bin/claude',
      cwd: process.cwd(),
      systemPrompt: 'You are helpful.',
    });

    await session.start();
    const text = (await collectTextChunks(session.send({ message: 'hey' }))).join('');

    expect(text).toBe('Hey. What do you need help with in Agon-AI?');
  });

  it('starts clean by default even when persisted continuity exists', async () => {
    const testHome = setupTestAgonHome('persistent-session-continuity-default-off');
    try {
      const { saveSessionState, saveConversation, clearSessionState, clearConversation } = await import('@agon/core');
      const { createResumeSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');

      saveSessionState('gemini', {
        messageHistory: [
          { role: 'system', content: 'You are Cesar.' },
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old answer' },
        ],
        confidence: null,
      });

      saveConversation([
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'latest answer' },
      ], 'claude');

      const session = createResumeSession({
        engine: {
          id: 'gemini',
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'gemini-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
      });

      await session.start();
      expect(session.getMessageHistory()).toEqual([]);

      clearSessionState('gemini');
      clearConversation();
    } finally {
      cleanupTestAgonHome(testHome);
    }
  });

  it('prefers newer workspace conversation continuity over stale per-engine state when enabled', async () => {
    const testHome = setupTestAgonHome('persistent-session-continuity');
    try {
      const { saveSessionState, saveConversation, clearSessionState, clearConversation } = await import('@agon/core');
      const { createResumeSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');

      saveSessionState('gemini', {
        messageHistory: [
          { role: 'system', content: 'You are Cesar.' },
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old answer' },
        ],
        confidence: null,
      });

      saveConversation([
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'latest answer' },
      ], 'claude');

      const session = createResumeSession({
        engine: {
          id: 'gemini',
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'gemini-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        sessionContinuity: true,
      });

      await session.start();
      expect(session.getMessageHistory()).toEqual([
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'latest answer' },
      ]);

      clearSessionState('gemini');
      clearConversation();
    } finally {
      cleanupTestAgonHome(testHome);
    }
  });

  it('does not session-cache Read calls above the mtime-aware Read tool in API loops', async () => {
    const { createResumeSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');
    let readCount = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamTextToolCall('Read', { file_path: 'package.json' }));

    const session = createResumeSession({
      engine: {
        id: 'api-test',
        api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
      } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      onToolCall: async (name: string) => {
        if (name !== 'Read') return 'unexpected tool';
        readCount++;
        return `read-${readCount}`;
      },
      toolLoopBaseBudget: 2,
      toolLoopMaxBudget: 2,
    });

    await session.start();
    for await (const _chunk of session.send({ message: 'read twice', toolLoopBaseBudget: 2, toolLoopMaxBudget: 2 })) {
      // Drain the generator.
    }

    expect(readCount).toBe(2);
  });

  it('stops repeated stale-read retry batches before burning tool calls', async () => {
    const { createResumeSession } = await import('../../packages/core/src/generated/sessions/persistent-session.js');
    let readCount = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamStaleReadRetryBatch(25));

    const session = createResumeSession({
      engine: {
        id: 'api-test',
        api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
      } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      onToolCall: async () => {
        readCount++;
        return `read-${readCount}`;
      },
      toolLoopBaseBudget: 3,
      toolLoopMaxBudget: 3,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'stale loop', toolLoopBaseBudget: 3, toolLoopMaxBudget: 3 })) {
      chunks.push(chunk);
    }

    expect(readCount).toBe(0);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /repeated read-only retry loop/.test(chunk.content))).toBe(true);
  });
});
