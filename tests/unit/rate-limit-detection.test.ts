import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn(),
  };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({ chatModel: vi.fn(() => 'mock-model') })),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}));

import { APICallError } from '@ai-sdk/provider';
import { RetryError, streamText } from 'ai';
import { apiDispatch } from '../../packages/core/src/api/dispatch.js';

const mockStreamText = vi.mocked(streamText);
const config = { baseUrl: 'http://test', apiKeyEnv: 'TEST_RATE_KEY', model: 'test' };

function erroringStream(error: unknown) {
  async function* fullStream() { yield { type: 'error', error }; }
  return { fullStream: fullStream(), usage: Promise.resolve(undefined) } as unknown as ReturnType<typeof streamText>;
}

function throwingStream(error: unknown) {
  async function* fullStream(): AsyncGenerator<never, void, void> { throw error; }
  return { fullStream: fullStream(), usage: Promise.resolve(undefined) } as unknown as ReturnType<typeof streamText>;
}

function apiCallError(message: string, statusCode?: number, cause?: unknown) {
  return new APICallError({ message, url: 'http://test/chat/completions', requestBodyValues: {}, statusCode, cause });
}

function headersTimeout() {
  return Object.assign(new Error('Headers Timeout Error'), { name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' });
}

describe('apiDispatch — retry-exhausted error classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_RATE_KEY = 'test-key';
  });

  it('returns exitCode 2 on a 429 rate limit error', async () => {
    mockStreamText.mockReturnValueOnce(throwingStream(new Error('API error 429: Too Many Requests')));

    const result = await apiDispatch(config, 'test prompt', 30);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('rate limited');
  });

  it('labels a RetryError whose last cause is a 429 as rate limited', async () => {
    const err = new RetryError({ message: 'Failed after 6 attempts.', reason: 'maxRetriesExceeded',
      errors: [apiCallError('Too Many Requests', 429), apiCallError('Too Many Requests', 429)] });
    mockStreamText.mockReturnValueOnce(erroringStream(err));

    const result = await apiDispatch(config, 'test prompt', 30);

    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('rate limited');
  });

  it('labels a RetryError whose last cause is an undici headers timeout as a timeout, not a rate limit', async () => {
    const err = new RetryError({ message: 'Failed after 6 attempts. Last error: Cannot connect to API: Headers Timeout Error', reason: 'maxRetriesExceeded',
      errors: [apiCallError('Cannot connect to API: Headers Timeout Error', undefined, headersTimeout())] });
    mockStreamText.mockReturnValueOnce(erroringStream(err));

    const result = await apiDispatch(config, 'test prompt', 30);

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toMatch(/^Request timed out \(/);
    expect(result.stderr).not.toContain('rate limited');
  });

  it('does not label a RetryError over a generic server error as rate limited', async () => {
    const err = new RetryError({ message: 'Failed after 6 attempts.', reason: 'maxRetriesExceeded',
      errors: [apiCallError('Internal Server Error', 500)] });
    mockStreamText.mockReturnValueOnce(throwingStream(err));

    const result = await apiDispatch(config, 'test prompt', 30);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('API stream failed');
    expect(result.stderr).not.toContain('rate limited');
  });

  it('returns exitCode 1 on a generic stream error', async () => {
    mockStreamText.mockReturnValueOnce(erroringStream(new Error('Connection refused')));

    const result = await apiDispatch(config, 'test prompt', 30);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Connection refused');
    expect(result.stderr).not.toContain('rate limited');
  });

  it('passes maxRetries: 5 and the output budget to streamText', async () => {
    async function* fullStream() { yield { type: 'text-delta', text: 'ok' }; }
    mockStreamText.mockReturnValueOnce({ fullStream: fullStream(), usage: Promise.resolve(undefined) } as unknown as ReturnType<typeof streamText>);

    await apiDispatch({ ...config, maxTokens: 16384 }, 'test prompt', 30);

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 5, maxOutputTokens: 16384 }),
    );
  });
});
