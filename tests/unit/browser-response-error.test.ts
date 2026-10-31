import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBrowserResponseError } from '../../packages/support-browser-bridge/src/response-error.js';

afterEach(() => vi.useRealTimers());

describe('Browser error response boundary', () => {
  it.each(['', 'not json', 'null', '[]', '{}', '{"error":42}', '{"error":{"secret":"x"}}'])('rejects unsupported body %s', async body => {
    await expect(readBrowserResponseError(new Response(body))).resolves.toBeUndefined();
  });

  it('strips terminal controls and directional overrides', async () => {
    const response = Response.json({ error: '\x1b[31mdo not repeat\x1b[0m\n\u202e effects\x00' });
    await expect(readBrowserResponseError(response)).resolves.toBe('do not repeat effects');
  });

  it('limits displayed guidance', async () => {
    await expect(readBrowserResponseError(Response.json({ error: 'x'.repeat(3000) }))).resolves.toHaveLength(2048);
  });

  it('rejects oversized bodies and cancels their remaining stream', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(16_385)); }, cancel,
    }));
    await expect(readBrowserResponseError(response)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('decodes a multibyte character split across chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ error: 'é' }));
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    await expect(readBrowserResponseError(response)).resolves.toBe('é');
  });

  it('returns fallback for a body already locked by another reader', async () => {
    const response = Response.json({ error: 'fixture' });
    const reader = response.body!.getReader();
    try { await expect(readBrowserResponseError(response)).resolves.toBeUndefined(); }
    finally { reader.releaseLock(); }
  });

  it('bounds a stalled body even when cancellation acknowledgement stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const result = readBrowserResponseError(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops an active read on cancellation and clears its timer', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const cancel = vi.fn();
    const result = readBrowserResponseError(new Response(new ReadableStream({ cancel })), abort.signal);
    abort.abort();
    await expect(result).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acquire an already-cancelled body', async () => {
    const response = Response.json({ error: 'fixture' });
    await expect(readBrowserResponseError(response, AbortSignal.abort())).resolves.toBeUndefined();
    expect(response.body!.locked).toBe(false);
  });

  it('returns fallback for an errored stream', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('fixture')); } }));
    await expect(readBrowserResponseError(response)).resolves.toBeUndefined();
  });
});
