import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSessionHost } from '@kernlang/agon-core';
import type { BrainClient } from '@kernlang/agon-core';
import { DurableModHost, SurfaceGenerationError, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '@kernlang/agon-kernel';
import { createAgonServe } from '../../packages/cli/src/bridge/agon-serve.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

describe('Browser HTTP admission authority', () => {
  let home: string;
  let root: string;
  let serve: ReturnType<typeof createAgonServe> | undefined;
  let url: string;
  let token: string;
  let inputs: string[];
  let sessionId: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-http-authority-'));
    root = join(home, 'modular-host');
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    inputs = [];
    sessionId = randomUUID();
  });

  afterEach(async () => {
    try { await serve?.close(); }
    finally {
      serve = undefined;
      await disposeProcessSurfaceAuthority();
      const generations = join(root, 'generations');
      if (existsSync(generations)) {
        for (const generation of readdirSync(generations)) chmodSync(join(generations, generation), 0o755);
      }
      rmSync(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  async function disableBrowser(): Promise<void> {
    const catalog = createFirstPartyModCatalog();
    const now = '2026-10-31T00:00:00.000Z';
    const desired = planDesiredStateChange(catalog, createFullCompatDesiredState(catalog, now),
      { kind: 'disable', id: 'agon.browser' }, now).nextState;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'browser-http-test' });
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
  }

  async function start(beforeResult?: () => Promise<void>, onCancel?: () => void): Promise<void> {
    await initializeProcessSurfaceAuthority(root);
    const brain = {
      async *runTurn(request: { input: string; turnId: string }) {
        inputs.push(request.input);
        yield { kind: 'notice', level: 'info', message: 'fixture' };
        await beforeResult?.();
        return { turnId: request.turnId, delegated: false, responded: true, engineId: 'fixture' };
      },
      async cancel() { onCancel?.(); return { status: 'accepted' as const }; },
    } as unknown as BrainClient;
    serve = createAgonServe({ brain, sessionId });
    ({ url, token } = await serve.start());
  }

  async function send(input: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${url}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() };
  }

  it('refuses new turns after a durable generation change without entering the brain', async () => {
    await start();
    expect((await send('enabled control')).status).toBe(200);
    expect(inputs).toEqual(['enabled control']);
    const previousSequence = getSessionHost().latestSeq(sessionId);
    await disableBrowser();
    const rejected = await send('stale request');
    expect(inputs).toEqual(['enabled control']);
    expect(getSessionHost().latestSeq(sessionId)).toBe(previousSequence);
    expect(rejected).toMatchObject({ status: 409, body: { code: 'MOD_GENERATION_MISMATCH', restartRequired: true } });
  });

  it('refuses new turns when initialized with Browser disabled', async () => {
    await disableBrowser();
    await start();
    const rejected = await send('disabled request');
    expect(inputs).toEqual([]);
    expect(getSessionHost().latestSeq(sessionId)).toBe(0);
    expect(rejected).toMatchObject({ status: 403, body: { code: 'MOD_SURFACE_UNAVAILABLE' } });
  });

  it('rejects a queued stale turn while allowing cancellation and completion of the active turn', async () => {
    let releaseTurn = () => {};
    const held = new Promise<void>(resolve => { releaseTurn = resolve; });
    const cancelled = vi.fn(releaseTurn);
    await start(() => held, cancelled);
    const active = send('active');
    let queued: ReturnType<typeof send> | undefined;
    try {
      await vi.waitFor(() => expect(inputs).toEqual(['active']));
      // Observe queue entry, not elapsed time, before switching generations.
      const previousTail: unknown = Reflect.get(serve!, 'turnTail');
      queued = send('queued');
      await vi.waitFor(() => expect(Reflect.get(serve!, 'turnTail')).not.toBe(previousTail));
      await disableBrowser();
      const cancellation = await fetch(`${url}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: `${sessionId}-1` }),
        signal: AbortSignal.timeout(5_000),
      });
      expect(cancellation.status).toBe(200);
      expect(await cancellation.json()).toEqual({ status: 'accepted' });
      expect(cancelled).toHaveBeenCalledOnce();
      expect((await active).status).toBe(200);
      expect(await queued).toMatchObject({ status: 409, body: { code: 'MOD_GENERATION_MISMATCH' } });
      expect(inputs).toEqual(['active']);
    } finally {
      releaseTurn();
      await Promise.allSettled([active, ...(queued ? [queued] : [])]);
    }
  });

  it('does not retarget an old HTTP host after process authority is replaced', async () => {
    await start();
    await disposeProcessSurfaceAuthority();
    await initializeProcessSurfaceAuthority(root);
    expect(await send('replaced host')).toMatchObject({ status: 409, body: { code: 'MOD_GENERATION_MISMATCH' } });
    expect(inputs).toEqual([]);
  });

  it('preserves brain execution failures instead of classifying them as admission denial', async () => {
    await start(async () => { throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'brain failure', true); });
    expect(await send('failing turn')).toEqual({ status: 500, body: { error: 'brain failure' } });
    expect(inputs).toEqual(['failing turn']);
  });

  it('allows a running turn to finish naturally after disable without accepting another turn', async () => {
    let finish = () => {};
    const held = new Promise<void>(resolve => { finish = resolve; });
    const cancelled = vi.fn();
    await start(() => held, cancelled);
    const active = send('natural completion');
    try {
      await vi.waitFor(() => expect(inputs).toEqual(['natural completion']));
      await disableBrowser();
      finish();
      expect(await active).toMatchObject({ status: 200, body: { result: { responded: true } } });
      expect(cancelled).not.toHaveBeenCalled();
      const previousSequence = getSessionHost().latestSeq(sessionId);
      expect(await send('must not start')).toMatchObject({ status: 409, body: { code: 'MOD_GENERATION_MISMATCH' } });
      expect(inputs).toEqual(['natural completion']);
      expect(getSessionHost().latestSeq(sessionId)).toBe(previousSequence);
    } finally {
      finish();
      await Promise.allSettled([active]);
    }
  });
});
