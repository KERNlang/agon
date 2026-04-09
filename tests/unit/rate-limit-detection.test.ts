import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({ chatModel: vi.fn(() => 'mock-model') })),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}));

import { generateText } from 'ai';
import { apiDispatch } from '../../packages/core/src/generated/api/dispatch.js';

const mockGenerateText = vi.mocked(generateText);

describe('apiDispatch — rate-limit detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_RATE_KEY = 'test-key';
  });

  it('returns exitCode 2 on 429 rate limit error', async () => {
    const err = new Error('API error 429: Too Many Requests');
    mockGenerateText.mockRejectedValueOnce(err);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_RATE_KEY', model: 'test' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('rate limited');
  });

  it('returns exitCode 2 on AI_RetryError (AI SDK retry exhaustion)', async () => {
    const err = new Error('All retries exhausted');
    err.name = 'AI_RetryError';
    mockGenerateText.mockRejectedValueOnce(err);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_RATE_KEY', model: 'test' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('rate limited');
  });

  it('returns exitCode 1 on generic API error', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_RATE_KEY', model: 'test' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('API request failed');
    expect(result.stderr).not.toContain('rate limited');
  });

  it('passes maxRetries: 5 to generateText', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' } as any);

    await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_RATE_KEY', model: 'test' },
      'test prompt',
      30,
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 5 }),
    );
  });
});
