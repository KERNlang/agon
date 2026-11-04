import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: vi.fn(), generateText: vi.fn() };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({ chatModel: vi.fn(() => 'mock-model') })),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}));

import { generateText, streamText } from 'ai';
import { apiDispatch, apiStreamDispatch } from '../../packages/core/src/api/dispatch.js';

const mockStreamText = vi.mocked(streamText);
const config = { baseUrl: 'http://test', apiKeyEnv: 'TEST_STREAM_KEY', model: 'reasoner' };

function abortError() {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

describe('apiDispatch streams plain-text requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_STREAM_KEY = 'test-key';
  });

  it('drains a stream whose answer arrives only after a long silent reasoning phase', async () => {
    async function* fullStream() {
      yield { type: 'start' };
      yield { type: 'reasoning-delta', delta: 'thinking' };
      await new Promise(resolve => setTimeout(resolve, 120));
      yield { type: 'text-delta', text: 'late ' };
      yield { type: 'text-delta', text: 'answer' };
      yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 9, outputTokens: 4 } };
    }
    mockStreamText.mockReturnValueOnce({ fullStream: fullStream(), usage: Promise.resolve({ inputTokens: 9, outputTokens: 4, cachedInputTokens: 2 }) } as unknown as ReturnType<typeof streamText>);

    const result = await apiDispatch({ ...config, firstChunkTimeoutMs: 1000, idleTimeoutMs: 1000 }, 'review this', 30, undefined, 'system');

    expect(generateText).not.toHaveBeenCalled();
    expect(mockStreamText).toHaveBeenCalledOnce();
    expect(mockStreamText.mock.calls[0][0]).toMatchObject({
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'review this' }],
    });
    expect(result).toMatchObject({
      exitCode: 0, stdout: 'late answer', stderr: '', timedOut: false, finishReason: 'stop',
      usage: { promptTokens: 9, completionTokens: 4, totalTokens: 13, cachedInputTokens: 2, source: 'sdk' },
    });
  });

  it('surfaces finishReason length when reasoning exhausts the output budget', async () => {
    async function* fullStream() {
      yield { type: 'reasoning-delta', delta: 'thinking about everything' };
      yield { type: 'finish', finishReason: 'length', totalUsage: { inputTokens: 100, outputTokens: 16384 } };
    }
    mockStreamText.mockReturnValueOnce({ fullStream: fullStream(), usage: Promise.resolve({ inputTokens: 100, outputTokens: 16384 }) } as unknown as ReturnType<typeof streamText>);

    const result = await apiDispatch({ ...config, maxTokens: 16384 }, 'review', 30);

    expect(mockStreamText.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 16384 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.finishReason).toBe('length');
    expect(result.usage?.completionTokens).toBe(16384);
  });

  it('returns 130 without timedOut when the caller aborts mid-stream', async () => {
    const caller = new AbortController();
    mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
      async function* fullStream() {
        yield { type: 'text-delta', text: 'partial' };
        await untilAborted(options.abortSignal);
      }
      return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
    }) as unknown as typeof streamText);

    const pending = apiDispatch(config, 'q', 30, caller.signal);
    setTimeout(() => caller.abort(), 20);
    const result = await pending;

    expect(result.exitCode).toBe(130);
    expect(result.timedOut).toBe(false);
  });

  it('aborts the upstream request when a consumer stops reading the stream early', async () => {
    let upstream: AbortSignal | undefined;
    mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
      upstream = options.abortSignal;
      async function* fullStream() {
        yield { type: 'text-delta', text: 'partial' };
        await untilAborted(options.abortSignal);
      }
      return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
    }) as unknown as typeof streamText);

    const gen = apiStreamDispatch(config, 'q', 30);
    expect((await gen.next()).value).toBe('partial');
    await gen.return(undefined as never);

    expect(upstream?.aborted).toBe(true);
  });

  it('returns 124 timedOut when the overall timeout elapses', async () => {
    mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
      async function* fullStream() {
        yield { type: 'reasoning-delta', delta: 'still thinking' };
        await untilAborted(options.abortSignal);
      }
      return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
    }) as unknown as typeof streamText);

    const result = await apiDispatch({ ...config, firstChunkTimeoutMs: 5000, idleTimeoutMs: 5000 }, 'q', 0.05);

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
  });

  it('returns 124 timedOut when the SDK reports the timeout abort as a stream error part', async () => {
    mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
      async function* fullStream() {
        yield { type: 'reasoning-delta', delta: 'still thinking' };
        await new Promise<void>(resolve => options.abortSignal.addEventListener('abort', () => resolve(), { once: true }));
        yield { type: 'error', error: abortError() };
      }
      return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
    }) as unknown as typeof streamText);

    const result = await apiDispatch({ ...config, firstChunkTimeoutMs: 5000, idleTimeoutMs: 5000 }, 'q', 0.05);

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
  });

  it('returns 124 timedOut when the overall timeout ends a still-reasoning stream without an error part', async () => {
    mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
      async function* fullStream() {
        yield { type: 'reasoning-delta', delta: 'still thinking' };
        await new Promise<void>(resolve => options.abortSignal.addEventListener('abort', () => resolve(), { once: true }));
      }
      return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
    }) as unknown as typeof streamText);

    const result = await apiDispatch({ ...config, firstChunkTimeoutMs: 5000, idleTimeoutMs: 5000 }, 'q', 0.05);

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toBe('Request timed out');
  });

  it('captures reasoning from the SDK v6 fullStream text field', async () => {
    async function* fullStream() {
      yield { type: 'reasoning-delta', id: 'r1', text: 'weighing ' };
      yield { type: 'reasoning-delta', id: 'r1', text: 'the diff' };
      yield { type: 'text-delta', id: 't1', text: 'done' };
      yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } };
    }
    mockStreamText.mockReturnValueOnce({ fullStream: fullStream(), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }) } as unknown as ReturnType<typeof streamText>);

    const result = await apiDispatch(config, 'q', 30);

    expect(result.stdout).toBe('done');
    expect(result.parts).toContainEqual({ kind: 'reasoning', text: 'weighing the diff' });
  });

  describe('extend while active', () => {
    function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        const t = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
      });
    }

    function reasoningFor(ms: number, then: Array<Record<string, unknown>>) {
      return ((options: { abortSignal: AbortSignal }) => {
        async function* fullStream() {
          yield { type: 'text-delta', text: 'partial ' };
          const until = Date.now() + ms;
          while (Date.now() < until) {
            yield { type: 'reasoning-delta', text: 'r' };
            await sleepUnlessAborted(10, options.abortSignal);
          }
          for (const part of then) yield part;
          if (!then.length) await untilAborted(options.abortSignal);
        }
        return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
      }) as unknown as typeof streamText;
    }

    const extending = { ...config, firstChunkTimeoutMs: 5000, idleTimeoutMs: 5000, activityWindowMs: 40 };

    it('keeps a stream alive past the base timeout while reasoning keeps flowing', async () => {
      mockStreamText.mockImplementationOnce(reasoningFor(150, [
        { type: 'text-delta', text: 'answer' },
        { type: 'finish', finishReason: 'stop' },
      ]));

      const result = await apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 2 }, 'q', 0.05);

      expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: 'partial answer' });
      expect(result.extendedSeconds).toBeGreaterThan(0);
      expect(result).not.toHaveProperty('timeoutKind');
    });

    it('stops at the ceiling and says so, keeping partial stdout', async () => {
      mockStreamText.mockImplementationOnce(reasoningFor(60_000, []));

      const result = await apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 0.2 }, 'q', 0.05);

      expect(result).toMatchObject({
        exitCode: 124, timedOut: true, stdout: 'partial ',
        timeoutKind: 'ceiling', stderr: 'Request timed out at ceiling after extending while active',
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(190);
      expect(result.extendedSeconds).toBeGreaterThan(0.1);
    });

    it('stops extending once the stream goes quiet for the activity window', async () => {
      mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
        async function* fullStream() {
          for (let i = 0; i < 10; i++) {
            yield { type: 'reasoning-delta', text: 'r' };
            await sleepUnlessAborted(10, options.abortSignal);
          }
          await new Promise<void>(resolve => options.abortSignal.addEventListener('abort', () => resolve(), { once: true }));
        }
        return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
      }) as unknown as typeof streamText);

      const result = await apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 5 }, 'q', 0.05);

      expect(result).toMatchObject({ exitCode: 124, timedOut: true, timeoutKind: 'idle' });
      expect(result.stderr).toMatch(/^Request timed out after extending while active/);
      expect(result.durationMs).toBeLessThan(1000);
    });

    it('aborts a never-streaming request at the base timeout exactly as before', async () => {
      mockStreamText.mockImplementationOnce(((options: { abortSignal: AbortSignal }) => {
        async function* fullStream() {
          yield { type: 'start' };
          await untilAborted(options.abortSignal);
        }
        return { fullStream: fullStream(), usage: Promise.resolve(undefined) };
      }) as unknown as typeof streamText);

      const result = await apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 5 }, 'q', 0.05);

      expect(result).toMatchObject({ exitCode: 124, timedOut: true, stderr: 'Request timed out', timeoutKind: 'base', extendedSeconds: 0 });
      expect(result.durationMs).toBeLessThan(500);
    });

    it('never extends when the option is unset', async () => {
      mockStreamText.mockImplementationOnce(reasoningFor(60_000, []));

      const result = await apiDispatch(extending, 'q', 0.05);

      expect(result).toMatchObject({ exitCode: 124, timedOut: true, stderr: 'Request timed out' });
      expect(result).not.toHaveProperty('timeoutKind');
      expect(result).not.toHaveProperty('extendedSeconds');
      expect(result.durationMs).toBeLessThan(500);
    });

    it('never extends when the ceiling does not exceed the base timeout', async () => {
      mockStreamText.mockImplementationOnce(reasoningFor(60_000, []));

      const result = await apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 0.05 }, 'q', 0.05);

      expect(result).toMatchObject({ exitCode: 124, stderr: 'Request timed out' });
      expect(result).not.toHaveProperty('timeoutKind');
      expect(result.durationMs).toBeLessThan(500);
    });

    it('still returns 130 when the caller aborts during an extension', async () => {
      const caller = new AbortController();
      mockStreamText.mockImplementationOnce(reasoningFor(60_000, []));

      const pending = apiDispatch({ ...extending, extendWhileActiveMaxSeconds: 5 }, 'q', 0.05, caller.signal);
      setTimeout(() => caller.abort(), 120);
      const result = await pending;

      expect(result).toMatchObject({ exitCode: 130, timedOut: false, stderr: 'Aborted' });
      expect(result).not.toHaveProperty('timeoutKind');
    });
  });

  it('keeps the missing-key message without calling the SDK', async () => {
    delete process.env.TEST_STREAM_KEY;
    const result = await apiDispatch(config, 'q', 30);
    expect(result).toMatchObject({ exitCode: 1, stderr: 'Missing API key: set TEST_STREAM_KEY environment variable' });
    expect(mockStreamText).not.toHaveBeenCalled();
  });
});
