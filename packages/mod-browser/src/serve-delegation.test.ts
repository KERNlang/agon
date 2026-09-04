import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserServeHandle, InvocationContext, ModServices } from '@kernlang/agon-mod-api';

import { driveBrowser, runServe } from './implementation.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function context(signal: AbortSignal): InvocationContext {
  return {
    invocationId: 'browser-test',
    cwd: process.cwd(),
    platform: `${process.platform}-${process.arch}` as InvocationContext['platform'],
    signal,
    config: {},
  };
}

function services(overrides: Partial<ModServices> = {}): ModServices {
  return {
    identity: { id: 'agon.browser', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'receipt-browser') },
    permissions: { check: vi.fn(async () => 'allow') },
    state: { read: vi.fn(), write: vi.fn() },
    engines: { dispatch: vi.fn() },
    ...overrides,
  } as ModServices;
}

describe('physical browser host delegation', () => {
  it('delegates serve startup to the full host runtime and stops it on abort', async () => {
    const controller = new AbortController();
    const stop = vi.fn(async () => undefined);
    const handle: BrowserServeHandle = {
      url: 'http://127.0.0.1:4123',
      token: 'secret-token',
      sessionId: 'serve-test',
      engineId: 'codex',
      allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      connectionFile: '/tmp/serve-test.json',
      stop,
    };
    const startServe = vi.fn(async () => handle);
    const resultPromise = runServe({
      port: '4123',
      engine: 'codex',
      origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, context(controller.signal), services({ browser: { startServe } }));

    await vi.waitFor(() => expect(startServe).toHaveBeenCalledOnce());
    controller.abort();
    const result = await resultPromise;

    expect(startServe).toHaveBeenCalledWith({
      port: 4123,
      engineId: 'codex',
      allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    }, expect.objectContaining({ invocationId: 'browser-test' }));
    expect(stop).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ exitCode: 0, result: { sessionId: 'serve-test', url: handle.url } });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('fails closed without the host runtime and rejects invalid ports before startup', async () => {
    const signal = new AbortController().signal;
    expect(await runServe({}, context(signal), services())).toMatchObject({ exitCode: 2 });
    const startServe = vi.fn();
    expect(await runServe({ port: '70000' }, context(signal), services({ browser: { startServe } }))).toMatchObject({ exitCode: 1 });
    expect(startServe).not.toHaveBeenCalled();
  });

  it('uses the established /send wire shape rather than the obsolete prompt shape', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(String(url).endsWith('/attach') ? { sessionId: 'serve-test', lastSeq: 0 } : { result: { responded: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await driveBrowser({
      task: 'inspect this page',
      engine: 'codex',
      url: 'http://127.0.0.1:4123',
      token: 'secret-token',
    }, context(new AbortController().signal), services());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      input: 'inspect this page',
      engineId: 'codex',
      clientId: expect.any(String),
    });
  });
});
