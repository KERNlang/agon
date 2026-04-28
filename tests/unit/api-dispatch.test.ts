import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertMessagesForSdk, convertToolsForSdk, buildModel } from '../../packages/core/src/generated/api/dispatch.js';

// --- Usage capture tests (mocked generateText) ---

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({ chatModel: vi.fn(() => 'mock-model') })),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}));

describe('api-dispatch — AI SDK message conversion', () => {
  it('converts simple user/assistant messages', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
    ]);
  });

  it('merges separated system messages into one leading system message', () => {
    const messages = [
      { role: 'system', content: 'base rules' },
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'context status' },
      { role: 'assistant', content: 'hi' },
    ];

    const result = convertMessagesForSdk(messages, 'anthropic');

    expect(result).toEqual([
      { role: 'system', content: 'base rules\n\ncontext status' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('converts assistant message with tool_calls using input (not args)', () => {
    const messages = [
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: 'Let me read that.',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' },
        }],
      },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read that.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { file_path: '/tmp/test.ts' },
        },
      ],
    });
  });

  it('converts tool result using output (not result)', () => {
    const messages = [
      { role: 'user', content: 'Read it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' },
        }],
      },
      { role: 'tool', content: 'file contents here', tool_call_id: 'call_1' },
    ];
    const result = convertMessagesForSdk(messages);
    // Assistant with null content should only have tool-call parts
    expect(result[1].content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'Read',
        input: { file_path: '/tmp/test.ts' },
      },
    ]);
    // Tool result should use 'output' as {type:'text', value:...} (AI SDK v6 outputSchema)
    expect(result[2]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'Read',
        output: { type: 'text', value: 'file contents here' },
      }],
    });
  });

  it('handles multiple tool calls in one assistant message', () => {
    const messages = [
      { role: 'user', content: 'Read both files' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
          { id: 'call_2', type: 'function', function: { name: 'Read', arguments: '{"file_path":"b.ts"}' } },
        ],
      },
      { role: 'tool', content: 'contents of a', tool_call_id: 'call_1' },
      { role: 'tool', content: 'contents of b', tool_call_id: 'call_2' },
    ];
    const result = convertMessagesForSdk(messages);
    // Both tool results should have correct toolName resolved from assistant tool_calls
    expect(result[2].content[0].toolName).toBe('Read');
    expect(result[3].content[0].toolName).toBe('Read');
    expect(result[2].content[0].output).toEqual({ type: 'text', value: 'contents of a' });
    expect(result[3].content[0].output).toEqual({ type: 'text', value: 'contents of b' });
  });

  it('handles already-parsed tool arguments (object, not string)', () => {
    const messages = [
      { role: 'user', content: 'test' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Grep', arguments: { pattern: 'foo', path: '/tmp' } },
        }],
      },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result[1].content[0].input).toEqual({ pattern: 'foo', path: '/tmp' });
  });

  it('recovers orphan tool results as plain context instead of invalid tool messages', () => {
    const messages = [
      { role: 'user', content: 'continue' },
      { role: 'tool', content: 'old file contents' },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result).toEqual([
      { role: 'user', content: 'continue' },
      { role: 'user', content: '[Recovered orphan tool result omitted from native tool channel]\nold file contents' },
    ]);
  });

  it('recovers tool results whose tool_call_id has no matching assistant tool call', () => {
    const messages = [
      { role: 'assistant', content: 'done' },
      { role: 'tool', content: 'stale result', tool_call_id: 'missing_call' },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result[1]).toEqual({
      role: 'user',
      content: '[Recovered orphan tool result omitted from native tool channel]\nstale result',
    });
  });
});

describe('api-dispatch — AI SDK tool conversion', () => {
  it('converts OpenAI-format tools with parameters (not inputSchema)', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'Read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    }];
    const result = convertToolsForSdk(tools);
    expect(result).toHaveProperty('Read');
    expect(result.Read.description).toBe('Read a file');
    // AI SDK tool uses 'inputSchema' (not 'parameters') — provider reads tool.inputSchema
    expect(result.Read.inputSchema).toBeDefined();
    // Should NOT have 'execute' — tool execution is handled by persistent-session
    expect(result.Read.execute).toBeUndefined();
  });
});

describe('api-dispatch — provider creation', () => {
  it('returns null when API key is missing', () => {
    const config = { baseUrl: 'https://example.com', apiKeyEnv: 'NONEXISTENT_KEY_12345', model: 'test' };
    const result = buildModel(config);
    expect(result).toBeNull();
  });
});

// --- Usage capture from generateText ---

import { generateText, streamText } from 'ai';
import { apiDispatch, apiStreamDispatchWithHistory } from '../../packages/core/src/generated/api/dispatch.js';

const mockGenerateText = vi.mocked(generateText);
const mockStreamText = vi.mocked(streamText);

async function collectApiStream(gen: AsyncGenerator<string, any, void>) {
  const chunks: string[] = [];
  let result: any;
  while (true) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    chunks.push(next.value);
  }
  return { chunks, result };
}

describe('apiDispatch usage capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
  });

  it('includes usage in result when SDK provides it', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello world',
      usage: { inputTokens: 100, outputTokens: 50 },
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello world');
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      source: 'sdk',
    });
  });

  it('returns undefined usage when SDK does not provide it', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello world',
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeUndefined();
  });

  it('handles partial usage (only inputTokens)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'response',
      usage: { inputTokens: 200, outputTokens: undefined },
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 0,
      totalTokens: 200,
      source: 'sdk',
    });
  });

  it('does not expose generateText reasoningText as visible output', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      reasoningText: 'The user has not asked a new question.',
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('apiStreamDispatchWithHistory reasoning visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
  });

  it('captures reasoning deltas without streaming them as assistant text', async () => {
    async function* fullStream() {
      yield { type: 'reasoning-delta', delta: 'The user has not asked a new question.' };
      yield { type: 'text-delta', text: 'Visible answer.' };
    }

    mockStreamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 4 }),
    } as any);

    const { chunks, result } = await collectApiStream(apiStreamDispatchWithHistory(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      [{ role: 'user', content: 'continue' }],
      30,
    ));

    expect(chunks.join('')).toBe('Visible answer.');
    expect(result.stdout).toBe('Visible answer.');
    expect(result.parts).toEqual([
      { kind: 'text', text: 'Visible answer.' },
      { kind: 'reasoning', text: 'The user has not asked a new question.' },
    ]);
  });
});
