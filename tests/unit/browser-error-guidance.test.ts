import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrainClient } from '@kernlang/agon-core';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { runDrive } from '../../packages/cli/src/commands/drive.js';
import { handleChrome } from '../../packages/cli/src/handlers/chrome.js';
import { driveBrowser } from '../../packages/mod-browser/src/implementation.js';
import { createAgonServe } from '../../packages/cli/src/bridge/agon-serve.js';

const connection = vi.hoisted(() => ({ url: 'http://127.0.0.1:9', token: 'fixture-token' }));

vi.mock('../../packages/cli/src/bridge/chrome-bridge.js', () => ({
  ensureChromeBridge: async () => ({ ...connection, embedded: false, origins: [] }),
}));
vi.mock('../../packages/cli/src/telemetry/index.js', () => ({ recordRun: vi.fn() }));

const warning = 'invocation completed but generation lease cleanup failed; do not repeat its effects';

describe('Browser client recovery guidance', () => {
  let home: string;
  let originalExitCode: typeof process.exitCode;
  const send = vi.fn();
  let errorBody: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'browser-guidance-'));
    vi.stubEnv('AGON_HOME', home);
    originalExitCode = process.exitCode;
    send.mockReset();
    errorBody = JSON.stringify({ error: warning });
    Object.assign(connection, { url: 'http://127.0.0.1:9', token: 'fixture-token' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/attach')) return Response.json({ sessionId: 'fixture', lastSeq: 0 });
      if (url.includes('/events?')) return new Response('', { status: 200 });
      if (url.endsWith('/send')) {
        send();
        return new Response(errorBody, { status: 500, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    }));
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('shows recovery guidance in drive without repeating the send', async () => {
    await runDrive({ prompt: 'fixture', url: 'http://127.0.0.1:9', token: 'fixture-token', autoApprove: true });
    expect(process.exitCode).toBe(2);
    expect(send).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(warning);
  });

  it('shows recovery guidance in Chrome without repeating the send', async () => {
    const dispatch = vi.fn();
    const setActiveAbort = vi.fn();
    const context = { setActiveAbort } as unknown as Parameters<typeof handleChrome>[2];
    expect(await handleChrome('fixture', dispatch, context)).toBe(false);
    expect(setActiveAbort).toHaveBeenLastCalledWith(null);
    expect(send).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining(warning) });
  });

  it('shows recovery guidance in the mod without recording success or repeating the send', async () => {
    const record = vi.fn();
    const services = { permissions: { check: async () => 'allow' }, receipts: { record } } as unknown as ModServices;
    const context = { signal: new AbortController().signal } as InvocationContext;
    const result = await driveBrowser({ task: 'fixture', url: 'http://127.0.0.1:9', token: 'fixture-token' }, context, services);
    expect(result.exitCode).toBe(2);
    expect(send).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    expect(result.stderr).toContain(warning);
  });

  it.each(['drive', 'chrome', 'mod'] as const)('preserves the HTTP server warning through the real %s client', async (client) => {
    vi.unstubAllGlobals();
    let completedEffects = 0;
    const runTurn = vi.fn(() => ({ next: async () => {
      completedEffects++;
      throw new Error(warning);
    } }));
    const brain = { runTurn } as unknown as BrainClient;
    const serve = createAgonServe({ brain, sessionId: randomUUID() });
    try {
      Object.assign(connection, await serve.start(0));
      if (client === 'drive') {
        await runDrive({ prompt: 'fixture', ...connection, autoApprove: true });
        expect(process.exitCode).toBe(2);
        expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(warning);
      } else if (client === 'chrome') {
        const dispatch = vi.fn();
        const setActiveAbort = vi.fn();
        const context = { setActiveAbort } as unknown as Parameters<typeof handleChrome>[2];
        expect(await handleChrome('fixture', dispatch, context)).toBe(false);
        expect(setActiveAbort).toHaveBeenLastCalledWith(null);
        expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining(warning) });
      } else {
        const record = vi.fn();
        const services = { permissions: { check: async () => 'allow' }, receipts: { record } } as unknown as ModServices;
        const context = { signal: new AbortController().signal } as InvocationContext;
        const result = await driveBrowser({ task: 'fixture', ...connection }, context, services);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(warning);
        expect(record).not.toHaveBeenCalled();
      }
      expect(runTurn).toHaveBeenCalledOnce();
      expect(completedEffects).toBe(1);
    } finally {
      await serve.close();
    }
  });

  it.each(['', '{}', 'not-json'])('keeps status fallback for all clients with body %j', async (body) => {
    errorBody = body;
    await runDrive({ prompt: 'fixture', ...connection, autoApprove: true });
    expect(process.exitCode).toBe(2);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('send failed (500)');

    const dispatch = vi.fn();
    const chromeContext = { setActiveAbort: vi.fn() } as unknown as Parameters<typeof handleChrome>[2];
    expect(await handleChrome('fixture', dispatch, chromeContext)).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: 'the turn failed (500).' });

    const record = vi.fn();
    const services = { permissions: { check: async () => 'allow' }, receipts: { record } } as unknown as ModServices;
    const context = { signal: new AbortController().signal } as InvocationContext;
    const result = await driveBrowser({ task: 'fixture', ...connection }, context, services);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('Browser send failed (500).\n');
    expect(record).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(3);
  });
});
