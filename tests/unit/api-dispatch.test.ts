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

  it('passes a multimodal user array (text + image part) through untouched', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: "what's wrong here?" },
          { type: 'image', image: 'QUFB', mediaType: 'image/png' },
        ],
      },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result).toEqual([
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: "what's wrong here?" },
          { type: 'image', image: 'QUFB', mediaType: 'image/png' },
        ],
      },
    ]);
  });

  it('passes an image-only user turn through (no empty text part)', () => {
    // Mirrors withImages() for a /img drop with no text: image part(s) only.
    const messages = [
      { role: 'user', content: [{ type: 'image', image: 'QUFB', mediaType: 'image/png' }] },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result).toHaveLength(1);
    expect((result[0] as any).content).toEqual([{ type: 'image', image: 'QUFB', mediaType: 'image/png' }]);
    // No empty {type:'text',text:''} block slipped in.
    expect((result[0] as any).content.some((p: any) => p.type === 'text')).toBe(false);
  });

  it('does not merge a multimodal user turn into an adjacent string user turn', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'user', content: [{ type: 'text', text: 'second' }, { type: 'image', image: 'QUFB', mediaType: 'image/png' }] },
    ];
    const result = convertMessagesForSdk(messages);
    // The string turn stays separate; the image part survives as its own message.
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'first' });
    expect(Array.isArray((result[1] as any).content)).toBe(true);
    expect((result[1] as any).content).toContainEqual({ type: 'image', image: 'QUFB', mediaType: 'image/png' });
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

  it('merges adjacent user messages after status/context normalization', () => {
    const messages = [
      { role: 'system', content: 'base rules' },
      { role: 'user', content: 'original request' },
      { role: 'user', content: '[CONTEXT STATUS]\ncompacted history loaded' },
      { role: 'assistant', content: 'ok' },
    ];

    const result = convertMessagesForSdk(messages, 'anthropic');

    expect(result).toEqual([
      { role: 'system', content: 'base rules' },
      { role: 'user', content: 'original request\n\n[CONTEXT STATUS]\ncompacted history loaded' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
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
      { role: 'tool', content: 'file contents here', tool_call_id: 'call_1' },
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
      { role: 'tool', content: 'grep output', tool_call_id: 'call_1' },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result[1].content[0].input).toEqual({ pattern: 'foo', path: '/tmp' });
  });

  it('recovers assistant tool calls whose matching tool result never arrived', () => {
    const messages = [
      { role: 'user', content: 'read package.json' },
      {
        role: 'assistant',
        content: 'I will read it.',
        tool_calls: [{
          id: 'call_missing',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"package.json"}' },
        }],
      },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result).toEqual([
      { role: 'user', content: 'read package.json' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will read it.' },
          { type: 'text', text: '[Recovered incomplete tool call omitted from native tool channel: Read]' },
        ],
      },
    ]);
  });

  it('recovers assistant tool calls whose matching result is not contiguous', () => {
    const messages = [
      { role: 'user', content: 'read then continue' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [{
          id: 'call_late',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"package.json"}' },
        }],
      },
      { role: 'user', content: 'status note inserted after interruption' },
      { role: 'tool', content: 'late file contents', tool_call_id: 'call_late' },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading.' },
        { type: 'text', text: '[Recovered incomplete tool call omitted from native tool channel: Read]' },
      ],
    });
    expect(result[2]).toEqual({
      role: 'user',
      content: 'status note inserted after interruption\n\n[Recovered orphan tool result omitted from native tool channel]\nlate file contents',
    });
  });

  it('keeps completed tool calls while recovering incomplete calls from the same assistant turn', () => {
    const messages = [
      { role: 'user', content: 'read both files' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_done', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
          { id: 'call_missing', type: 'function', function: { name: 'Read', arguments: '{"file_path":"b.ts"}' } },
        ],
      },
      { role: 'tool', content: 'contents of a', tool_call_id: 'call_done' },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_done', toolName: 'Read', input: { file_path: 'a.ts' } },
        { type: 'text', text: '[Recovered incomplete tool call omitted from native tool channel: Read]' },
      ],
    });
    expect(result[2]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_done',
        toolName: 'Read',
        output: { type: 'text', value: 'contents of a' },
      }],
    });
  });

  it('recovers orphan tool results as plain context instead of invalid tool messages', () => {
    const messages = [
      { role: 'user', content: 'continue' },
      { role: 'tool', content: 'old file contents' },
    ];

    const result = convertMessagesForSdk(messages);

    expect(result).toEqual([
      { role: 'user', content: 'continue\n\n[Recovered orphan tool result omitted from native tool channel]\nold file contents' },
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
      cachedInputTokens: 0,
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
      cachedInputTokens: 0,
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

// --- Fix A: idle-timeout paths must NEVER return a silent success ---
// Regression coverage for the double-swallowed-error bug: a stalled SSE stream
// (no format-mismatch hint) used to fall through to the success return
// ({ exitCode: 0, stderr: '' }), making a hung engine indistinguishable from a
// real empty answer. Both the inter-chunk and first-chunk idle-timeout paths
// must now return directly with exitCode 124 / timedOut: true / a descriptive
// stderr, and must preserve any partial stdout already streamed.
describe('apiStreamDispatchWithHistory idle-timeout contract (Fix A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
  });

  it('returns exitCode 124 + timedOut on an inter-chunk idle timeout, preserving partial stdout', async () => {
    // Yields one real chunk, then the generator's next .next() call never
    // resolves — mirrors a stream that stalls mid-answer (the kimi/zai
    // failure mode: reasoning phase goes silent for minutes).
    async function* fullStream() {
      yield { type: 'text-delta', text: 'partial answer' };
      await new Promise<never>(() => { /* never resolves — simulates a stalled stream */ });
    }

    mockStreamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve({ inputTokens: 5, outputTokens: 2 }),
    } as any);

    const { chunks, result } = await collectApiStream(apiStreamDispatchWithHistory(
      {
        baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model',
        idleTimeoutMs: 50, firstChunkTimeoutMs: 50,
      },
      [{ role: 'user', content: 'continue' }],
      30,
    ));

    expect(chunks.join('')).toBe('partial answer');
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('partial answer');
    expect(result.stderr).toMatch(/idle timeout/i);
    expect(result.stderr).toContain('inter-chunk');
    expect(result.stderr).toContain('0.05s');
  });

  it('returns exitCode 124 + timedOut on a first-chunk idle timeout with no format-mismatch hint', async () => {
    // Never yields anything — mirrors a stream that never produces a first
    // chunk (queuing / cold-start hang) on a host with no format mismatch
    // (baseUrl does not look Anthropic-shaped, format left unset), so the
    // hint path is skipped and this must still be a hard failure, not a
    // silent success.
    async function* fullStream(): AsyncGenerator<{ type: string; text: string }, void, void> {
      await new Promise<never>(() => { /* never resolves — simulates no first chunk ever arriving */ });
    }

    mockStreamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve(undefined),
    } as any);

    const { chunks, result } = await collectApiStream(apiStreamDispatchWithHistory(
      {
        baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model',
        idleTimeoutMs: 50, firstChunkTimeoutMs: 50,
      },
      [{ role: 'user', content: 'continue' }],
      30,
    ));

    expect(chunks).toEqual([]);
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/idle timeout/i);
    expect(result.stderr).toContain('first-chunk');
    expect(result.stderr).toContain('0.05s');
  });
});

// --- Fix C(a): finishReason capture from the fullStream 'finish' part ---
// A reasoning model that spends its entire maxOutputTokens budget thinking
// finishes CLEANLY (exit 0, no stderr) with zero text and finishReason
// 'length'. The dispatch layer must surface that finishReason on the
// DispatchResult so callers (runReviewCore) can name reasoning-exhaustion
// instead of misreporting a generic empty response.
describe('apiStreamDispatchWithHistory finishReason capture (Fix C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
  });

  it('captures finishReason=length from a reasoning-only stream that ends cleanly', async () => {
    async function* fullStream() {
      yield { type: 'reasoning-delta', delta: 'thinking hard about the diff...' };
      yield { type: 'finish', finishReason: 'length', rawFinishReason: 'length', totalUsage: { inputTokens: 30000, outputTokens: 8192 } };
    }

    mockStreamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve({ inputTokens: 30000, outputTokens: 8192 }),
    } as any);

    const { chunks, result } = await collectApiStream(apiStreamDispatchWithHistory(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      [{ role: 'user', content: 'review this' }],
      30,
    ));

    expect(chunks).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.finishReason).toBe('length');
    expect(result.parts).toEqual([
      { kind: 'reasoning', text: 'thinking hard about the diff...' },
    ]);
  });

  it('captures finishReason=stop on a normal completion', async () => {
    async function* fullStream() {
      yield { type: 'text-delta', text: 'the answer' };
      yield { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 3 } };
    }

    mockStreamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 3 }),
    } as any);

    const { result } = await collectApiStream(apiStreamDispatchWithHistory(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      [{ role: 'user', content: 'q' }],
      30,
    ));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('the answer');
    expect(result.finishReason).toBe('stop');
  });
});
