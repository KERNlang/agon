import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/api/dispatch.js', async (importOriginal) => ({
  ...await importOriginal<object>(), apiStreamDispatchWithHistory: dispatchMock,
}));

const TOOLS = [
  { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
] as any;

let home: string;
let toolCalls: number;

async function newSession() {
  const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
  const session = createResumeSession({
    engine: { id: `failure-${Math.random().toString(36).slice(2)}`, api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'm' } } as any,
    binaryPath: '',
    cwd: process.cwd(),
    systemPrompt: 'You are Cesar.',
    nativeTools: TOOLS,
    onToolCall: async () => { toolCalls++; return 'ok'; },
  });
  await session.start();
  return session;
}

async function collect(gen: AsyncIterable<any>) {
  const chunks: any[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

beforeEach(() => {
  home = setupTestAgonHome('stream-failure-session');
  toolCalls = 0;
});

afterEach(() => {
  dispatchMock.mockReset();
  cleanupTestAgonHome(home);
});

describe('Cesar session after a stream failure', () => {
  it('does not execute a tool call when the dispatch generator throws after yielding it', async () => {
    dispatchMock.mockImplementation(async function* () {
      yield '\n<tool name="Bash">{"command":"touch x"}</tool>\n';
      throw new Error('socket hang up');
    });
    const session = await newSession();

    const chunks = await collect(session.send({ message: 'go' }));

    expect(toolCalls).toBe(0);
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(chunks.find((c) => c.type === 'error')?.metadata).toMatchObject({ outputStarted: true });
  });

  it.each([
    ['a cut-off tool block', 'Looking.\n<tool_call>{"name":"Bash","arg'],
    ['a complete tool_call block', 'Looking.\n<tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>'],
  ])('keeps %s out of the history the next model call reads', async (_label, streamed) => {
    dispatchMock.mockImplementationOnce(async function* () {
      yield streamed;
      return { exitCode: 1, stdout: streamed, stderr: 'Stream error: terminated', modelFailure: { retryable: false, outputStarted: true } };
    });
    dispatchMock.mockImplementationOnce(async function* () {
      yield 'ok';
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });
    const session = await newSession();

    await collect(session.send({ message: 'go' }));
    await collect(session.send({ message: 'next' }));

    const history = dispatchMock.mock.calls[1]![1] as Array<{ role: string; content: unknown }>;
    const assistant = history.filter((m) => m.role === 'assistant').map((m) => String(m.content)).join('\n');
    expect(assistant).toContain('Looking.');
    expect(assistant).not.toMatch(/tool_call/);
  });
});
