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

// Mirrors apiStreamDispatchWithHistory for a NATIVE function-call: the SDK
// yields a display-only <tool> marker into the text AND returns a structured
// tool_call part in the done value. Structured-first execution must use the
// part's clean args, never re-parse the marker text.
async function* streamStructuredToolCall(toolName: string, input: Record<string, unknown>, toolCallId = 'call_sdk_1') {
  yield `\n<tool name="${toolName}">${JSON.stringify(input)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName, toolCallId, args: input }] };
}

async function* streamStaleReadRetryBatch(count: number) {
  const calls = Array.from({ length: count }, (_, index) =>
    `<tool name="Read">${JSON.stringify({ file_path: `src/file-${index}.ts` })}</tool>`,
  ).join('\n');
  yield `I see the issue. The file was modified since my last read. Let me re-read and then edit.\n${calls}`;
  return {};
}

async function* streamStaleReadRetryBatchFrom(start: number, count: number) {
  const calls = Array.from({ length: count }, (_, index) =>
    `<tool name="Read">${JSON.stringify({ file_path: `src/file-${start + index}.ts` })}</tool>`,
  ).join('\n');
  yield `I see the issue. The file was modified since my last read. Let me re-read and then edit.\n${calls}`;
  return {};
}

// Reads an EXPLICIT set of files in one read-only step. Used to exercise the
// no-new-info re-read spin detector: varying batch *compositions* over the same
// already-seen files (so the byte-identical-signature guard never fires) must
// still be caught once they stop introducing new cache-keys.
async function* streamReadFiles(paths: string[]) {
  const calls = paths.map(p => `<tool name="Read">${JSON.stringify({ file_path: p })}</tool>`).join('\n');
  yield `Let me look at the relevant files again.\n${calls}`;
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

    const { createCompanionSession } = await import('../../packages/core/src/persistent-session.js');
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

    const { createCompanionSession } = await import('../../packages/core/src/persistent-session.js');
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

    const { createStreamJsonSession } = await import('../../packages/core/src/persistent-session.js');
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
      const { saveSessionState, saveConversation, clearSessionState, clearConversation } = await import('@kernlang/agon-core');
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

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
      const { saveSessionState, saveConversation, clearSessionState, clearConversation } = await import('@kernlang/agon-core');
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

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
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
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

  it('executes native tool calls from structured parts, not the text round-trip (args containing </tool> survive)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    // An arg value that WOULD be mangled by the <tool>{json}</tool> regex round-trip.
    const trickyArgs = { command: 'echo "</tool> and <tool name=\\"x\\">"' };
    let captured: { name: string; args: any } | null = null;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamStructuredToolCall('Bash', trickyArgs, 'call_sdk_42'))
      .mockImplementationOnce(async function* () { yield 'Done.'; return {}; });

    const session = createResumeSession({
      engine: {
        id: 'api-test',
        api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
      } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: [{ type: 'function', function: { name: 'Bash', description: 'run', parameters: {} } }] as any,
      onToolCall: async (name: string, args: Record<string, unknown>) => {
        captured = { name, args };
        return 'ok';
      },
      toolLoopBaseBudget: 3,
      toolLoopMaxBudget: 3,
    });

    await session.start();
    for await (const _chunk of session.send({ message: 'run it', toolLoopBaseBudget: 3, toolLoopMaxBudget: 3 })) {
      // Drain the generator.
    }

    // Structured-first: clean SDK args preserved exactly (regex round-trip would have mangled this).
    expect(captured).not.toBeNull();
    expect(captured!.name).toBe('Bash');
    expect(captured!.args).toEqual(trickyArgs);
    // History reconstruction uses the SDK's real tool_call id, not a synthetic one.
    const history = session.getMessageHistory();
    const assistantWithCalls = history.find((m: any) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    expect(assistantWithCalls?.tool_calls?.[0]?.id).toBe('call_sdk_42');
  });

  it('recovers once from repeated stale-read retry batches before hard-stopping', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let readCount = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamStaleReadRetryBatch(25))
      .mockImplementationOnce(async function* () {
        yield 'Done after recovery.';
        return {};
      });

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
    expect(chunks.some((chunk: any) => chunk.type === 'status' && /recovering from repeated stale read loop/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /repeated read-only retry loop/.test(chunk.content))).toBe(false);
    expect(chunks.some((chunk: any) => chunk.type === 'text' && /Done after recovery/.test(chunk.content))).toBe(true);
    const history = session.getMessageHistory();
    expect(history.some((msg: any) => msg.role === 'assistant' && Array.isArray(msg.tool_calls))).toBe(false);
    expect(history.some((msg: any) => msg.role === 'assistant' && /Agon omitted a duplicate read-only tool batch/.test(String(msg.content)))).toBe(true);
  });

  it('does not stop stale-read narration when the engine reads different files', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let readCount = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamStaleReadRetryBatchFrom(0, 2))
      .mockImplementationOnce(() => streamStaleReadRetryBatchFrom(2, 2))
      .mockImplementationOnce(() => streamStaleReadRetryBatchFrom(4, 2))
      .mockImplementationOnce(async function* () {
        yield 'Finished after fresh reads.';
        return {};
      });

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
      toolLoopBaseBudget: 5,
      toolLoopMaxBudget: 5,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'fresh stale reads', toolLoopBaseBudget: 5, toolLoopMaxBudget: 5 })) {
      chunks.push(chunk);
    }

    expect(readCount).toBe(6);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /repeated read-only retry loop/.test(chunk.content))).toBe(false);
    expect(chunks.some((chunk: any) => chunk.type === 'text' && /Finished after fresh reads/.test(chunk.content))).toBe(true);
  });

  it('breaks a re-read spin with varying batch composition (no new cache-keys)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let readCount = 0;
    // Steps 2-4 re-read already-seen files in DIFFERENT compositions, so the
    // byte-identical-signature guard never fires — only the no-new-info counter
    // catches it. Step 1 establishes the keys; steps 2,3,4 add nothing new.
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // new keys → counter 0
      .mockImplementationOnce(() => streamReadFiles(['src/a.ts']))             // no new → 1
      .mockImplementationOnce(() => streamReadFiles(['src/b.ts']))             // no new → 2
      .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // no new → 3 → recovery (omitted)
      .mockImplementationOnce(async function* () {
        yield 'Done after re-read recovery.';
        return {};
      });

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
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 6,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'spin', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 })) {
      chunks.push(chunk);
    }

    // Steps 1-3 executed (2 + 1 + 1 = 4 reads); step 4's duplicate batch was omitted.
    expect(readCount).toBe(4);
    expect(chunks.some((chunk: any) => chunk.type === 'status' && /recovering from repeated stale read loop/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk: any) => chunk.type === 'text' && /Done after re-read recovery/.test(chunk.content))).toBe(true);
    const history = session.getMessageHistory();
    expect(history.some((msg: any) => msg.role === 'assistant' && /Agon omitted a duplicate read-only tool batch/.test(String(msg.content)))).toBe(true);
  });

  it('retries an empty completion before surfacing the empty-response error', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(async function* () { return {}; })           // empty completion (transient)
      .mockImplementationOnce(async function* () {
        yield 'Recovered after a transient empty.';
        return {};
      });

    const session = createResumeSession({
      engine: {
        id: 'api-test',
        api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
      } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      onToolCall: async () => 'unused',
      toolLoopBaseBudget: 3,
      toolLoopMaxBudget: 3,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'empty then ok', toolLoopBaseBudget: 3, toolLoopMaxBudget: 3 })) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk: any) => chunk.type === 'status' && /engine returned empty — retrying/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /empty response/i.test(chunk.content))).toBe(false);
    expect(chunks.some((chunk: any) => chunk.type === 'text' && /Recovered after a transient empty/.test(chunk.content))).toBe(true);
  }, 15000);

  it('still surfaces the empty-response error after exhausting retries', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    apiStreamDispatchWithHistoryMock.mockImplementation(async function* () { return {}; }); // always empty

    const session = createResumeSession({
      engine: {
        id: 'api-test',
        api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
      } as any,
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      onToolCall: async () => 'unused',
      toolLoopBaseBudget: 3,
      toolLoopMaxBudget: 3,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'always empty', toolLoopBaseBudget: 3, toolLoopMaxBudget: 3 })) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk: any) => chunk.type === 'status' && /engine returned empty — retrying/.test(chunk.content)).length).toBe(2);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /empty response/i.test(chunk.content))).toBe(true);
  }, 15000);
});
