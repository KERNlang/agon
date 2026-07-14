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
  it('threads the active turn and stable RPC id into companion approvals', async () => {
    const approvals: Array<Record<string, unknown> | undefined> = [];
    spawnMock.mockImplementationOnce(() => createMockProcess((line, stdout) => {
      const msg = JSON.parse(line);
      if (msg.id && msg.method === 'initialize') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
      } else if (msg.id && msg.method === 'thread/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'thread-approval' } } }) + '\n');
      } else if (msg.id && msg.method === 'turn/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'item/commandExecution/requestApproval',
          params: { command: { command: 'npm test' } },
        }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: {} }) + '\n');
      }
    }));

    const { createCompanionSession } = await import('../../packages/core/src/persistent-session.js');
    const session = createCompanionSession({
      engine: { id: 'codex', binary: 'codex', companion: { protocol: 'jsonrpc', serverCmd: ['app-server'] } } as any,
      binaryPath: '/usr/local/bin/codex',
      cwd: process.cwd(),
      onApproval: async (_tool, _command, controlPlane) => {
        approvals.push(controlPlane as unknown as Record<string, unknown> | undefined);
        return true;
      },
    });
    const envelope = {
      schemaVersion: 1 as const,
      sessionId: 'chat-approval',
      turnId: 'turn-approval',
      leaseEpoch: 4,
      attempt: 1,
      producerId: 'cesar-brain',
    };

    await session.start();
    await collectTextChunks(session.send({ message: 'test', controlPlane: envelope }));
    await vi.waitFor(() => expect(approvals).toHaveLength(1));

    expect(approvals[0]).toEqual({ ...envelope, toolCallId: '77', stepId: 'approval:77' });
  });

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

  it('Read dedupe: an UNCHANGED re-read of a real file returns a tier-1 stub (full bytes NOT re-fed)', async () => {
    // Feature 1 (READ DEDUPE) replaced the old "Read is never session-cached"
    // behavior: an identical re-Read of an unchanged file (verified via a single
    // fs.statSync on mtime+size) now stubs instead of re-feeding the file bytes.
    // package.json is a REAL repo file, so stat succeeds and the second read HITS.
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
        return `the full file contents here, read number ${readCount}`;
      },
      toolLoopBaseBudget: 2,
      toolLoopMaxBudget: 2,
    });

    await session.start();
    for await (const _chunk of session.send({ message: 'read twice', toolLoopBaseBudget: 2, toolLoopMaxBudget: 2 })) {
      // Drain the generator.
    }

    // Only the FIRST read executed; the unchanged re-read was deduped to a stub.
    expect(readCount).toBe(1);
    const history = session.getMessageHistory();
    const toolResults = history.filter((m: any) => m.role === 'tool').map((m: any) => String(m.content));
    // Exactly two Read tool-result messages: the real bytes, then the stub.
    expect(toolResults.length).toBe(2);
    expect(toolResults[0]).toContain('the full file contents here, read number 1');
    // The second result is the tier-1 stub — the bytes were NOT re-fed.
    expect(toolResults[1]).toMatch(/^\[unchanged since read .+ — full content \(\d+ bytes\) is already in context above/);
    expect(toolResults[1]).not.toContain('the full file contents here, read number 2');
  });

  it('Read dedupe: kill-switch AGON_READ_DEDUPE=off → every re-read executes fully', async () => {
    const prev = process.env.AGON_READ_DEDUPE;
    process.env.AGON_READ_DEDUPE = 'off';
    try {
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

      // Kill-switch off → dedupe disabled → both reads execute (legacy behavior).
      expect(readCount).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.AGON_READ_DEDUPE;
      else process.env.AGON_READ_DEDUPE = prev;
    }
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

  it('breaks a re-read spin with varying batch composition (no new cache-keys) — telemetry OFF, immediate recovery', async () => {
    // Phase-0 guard telemetry DISABLED → byte-identical legacy behavior: the
    // no-new-info counter crossing 3 omits the duplicate batch and nudges
    // IMMEDIATELY (no one-step deferral). With telemetry ON the first crossing
    // is deferred by one step (see the next test).
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '0';
    try {
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
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
    }
  });

  it('defers the read-spin recovery by one step when guard telemetry is ON (delayed observation)', async () => {
    // Phase-0 DELAYED OBSERVATION: the FIRST time the no-new-info counter crosses
    // 3 (sole trigger), telemetry defers the recovery nudge by one step so the
    // tracker can observe whether the model would pivot on its own. The duplicate
    // batch at step 4 EXECUTES (not omitted), then step 5's spontaneous finish
    // resolves the deferred fire as would_have_recovered — the nudge never fires.
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '1';
    const homeDir = setupTestAgonHome('readspin-defer');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const { readGuardCounters } = await import('../../packages/core/src/telemetry.js');
      let readCount = 0;
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // new keys → 0
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts']))             // no new → 1
        .mockImplementationOnce(() => streamReadFiles(['src/b.ts']))             // no new → 2
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // no new → 3 → DEFER (executes)
        .mockImplementationOnce(async function* () {
          yield 'Done — pivoted on my own.';
          return {};
        });

      const session = createResumeSession({
        engine: {
          id: 'api-defer-test',
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

      // Step 4's duplicate batch EXECUTED (deferral) → 2+1+1+2 = 6 reads, not 4.
      expect(readCount).toBe(6);
      // Recovery nudge was NOT emitted — the model pivoted within the deferral window.
      expect(chunks.some((chunk: any) => chunk.type === 'status' && /recovering from repeated stale read loop/.test(chunk.content))).toBe(false);
      expect(chunks.some((chunk: any) => chunk.type === 'text' && /pivoted on my own/.test(chunk.content))).toBe(true);
      // The deferred read-spin fire flushed to the counters as would_have_recovered.
      const counters = readGuardCounters();
      const cell = counters?.byEngineGuard?.['api-defer-test']?.['read-spin'];
      expect(cell?.fires).toBe(1);
      expect(cell?.wouldHaveRecovered).toBe(1);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
      cleanupTestAgonHome(homeDir);
    }
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

  it('retries a first-chunk timeout once when no side effect has started', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(async function* () {
        return { stderr: 'API stream first-chunk idle timeout after 1s (received 0 chunks, 0 text chars)' };
      })
      .mockImplementationOnce(async function* () {
        yield 'Recovered after safe retry.';
        return {};
      });
    const session = createResumeSession({
      engine: {
        id: 'api-first-chunk-retry',
        api: {
          baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test',
          firstChunkRetryCount: 1, firstChunkRetryBackoffMs: 0,
        },
      } as any,
      binaryPath: '', cwd: process.cwd(), systemPrompt: 'You are Cesar.', onToolCall: async () => 'unused',
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'retry safely' })) chunks.push(chunk);

    expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(2);
    expect(chunks.some((chunk: any) => chunk.type === 'status' && /safe retry 1\/1/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk: any) => chunk.type === 'text' && /Recovered after safe retry/.test(chunk.content))).toBe(true);
  });

  it('does not retry a later first-chunk timeout after an unsafe tool was initiated', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamStructuredToolCall('Bash', { command: 'npm run build' }, 'build-1'))
      .mockImplementationOnce(async function* () {
        return { stderr: 'API stream first-chunk idle timeout after 1s (received 0 chunks, 0 text chars)' };
      })
      .mockImplementationOnce(async function* () {
        yield 'This retry must never run.';
        return {};
      });
    const session = createResumeSession({
      engine: {
        id: 'api-first-chunk-no-retry',
        api: {
          baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test',
          firstChunkRetryCount: 1, firstChunkRetryBackoffMs: 0,
        },
      } as any,
      binaryPath: '', cwd: process.cwd(), systemPrompt: 'You are Cesar.', onToolCall: async () => 'build complete',
      toolLoopBaseBudget: 3, toolLoopMaxBudget: 3,
    });

    await session.start();
    const chunks = [];
    for await (const chunk of session.send({ message: 'build then continue' })) chunks.push(chunk);

    expect(apiStreamDispatchWithHistoryMock).toHaveBeenCalledTimes(2);
    expect(chunks.some((chunk: any) => chunk.type === 'error' && /first-chunk idle timeout/.test(chunk.content))).toBe(true);
    expect(chunks.some((chunk: any) => /This retry must never run/.test(chunk.content))).toBe(false);
  });

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

  it('codex FIX 1: a turn that ends abnormally (circuit-breaker) finalizes as aborted → open grounded-write fire stays UNRESOLVED, not averted', async () => {
    // The solo-coding gate fires a grounded-write guard on step 1 (a complex
    // task writing without investigating). The turn then ends ABNORMALLY via the
    // circuit breaker (3 consecutive all-failing steps), never reaching the
    // no-tool-calls terminal path. finalize() must run with reason 'aborted', so
    // the open fire stays `unresolved` (observedInTurn=false) — NOT mislabelled
    // `averted` (which the old unconditional guardDoneNormally=true produced,
    // crediting an aborted turn as completed-turn evidence).
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '1';
    const homeDir = setupTestAgonHome('finalize-aborted');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const { readGuardCounters } = await import('../../packages/core/src/telemetry.js');

      apiStreamDispatchWithHistoryMock
        // Step 1: write WITHOUT investigating on a complex task → gate fires +
        // records a grounded-write fire; the write is blocked (not executed).
        .mockImplementationOnce(() => streamStructuredToolCall('Write', { file_path: 'src/x.ts', content: 'export const x = 1;' }, 'call_w1'))
        // Steps 2-4: a failing Bash each → 3 consecutive all-fail steps trip the
        // circuit breaker, ending the turn abnormally (no later ok-write).
        .mockImplementation(() => streamStructuredToolCall('Bash', { command: 'false' }, 'call_b'));

      const session = createResumeSession({
        engine: {
          id: 'api-abort-test',
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Write', description: 'w', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
        ] as any,
        // Bash always errors → all-fail steps for the circuit breaker.
        onToolCall: async (name: string) => (name === 'Bash' ? 'Error: command failed' : 'ok'),
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();
      const chunks: any[] = [];
      // A complex, multi-file task so isComplexTask is true and the gate arms.
      for await (const chunk of session.send({
        message: 'refactor the auth module across files and rewrite the token handler',
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      })) {
        chunks.push(chunk);
      }

      // The gate fired (blocked the write) and the circuit breaker ended the turn.
      expect(chunks.some((c: any) => c.type === 'status' && /solo-coding gate/.test(c.content))).toBe(true);
      expect(chunks.some((c: any) => c.type === 'error' && /circuit breaker/.test(c.content))).toBe(true);
      const blockedChunk = chunks.find((c: any) => c.type === 'tool_call' && c.metadata?.output === 'Blocked: investigate first');
      expect(blockedChunk?.metadata).toEqual(expect.objectContaining({
        toolCallId: 'call_w1',
        terminalReason: 'skipped_policy',
        executionOwner: 'session',
      }));

      // The grounded-write fire flushed as UNRESOLVED (aborted finalize), not averted.
      const counters = readGuardCounters();
      const cell = counters?.byEngineGuard?.['api-abort-test']?.['grounded-write'];
      expect(cell?.fires).toBe(1);
      expect(cell?.unresolved).toBe(1);
      expect(cell?.averted ?? 0).toBe(0);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
      cleanupTestAgonHome(homeDir);
    }
  }, 20000);
});
