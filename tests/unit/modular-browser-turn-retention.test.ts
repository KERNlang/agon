import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrainClient, EngineRegistry } from '@kernlang/agon-core';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange, previewManagedGenerationCollection } from '@kernlang/agon-kernel';
import { createAgonServe } from '../../packages/cli/src/bridge/agon-serve.js';
import { AgenticTurnBrainClient } from '../../packages/cli/src/bridge/agentic-brain-client.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

describe('Browser turn generation retention', () => {
  let home: string;
  let root: string;
  let host: DurableModHost;
  let serve: ReturnType<typeof createAgonServe> | undefined;
  const catalog = createFirstPartyModCatalog();
  const timestamp = '2026-10-31T00:00:00.000Z';
  const enabled = createFullCompatDesiredState(catalog, timestamp);

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'agon-http-retention-'));
    root = join(home, 'host');
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(enabled), desiredState: enabled, installedIndex: {} });
  });

  afterEach(async () => {
    try { await serve?.close(); }
    finally {
      serve = undefined;
      await disposeProcessSurfaceAuthority();
      vi.restoreAllMocks();
      const generations = join(root, 'generations');
      if (existsSync(generations)) {
        for (const generation of readdirSync(generations)) chmodSync(join(generations, generation), 0o755);
      }
      rmSync(home, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  async function disableBrowser(): Promise<void> {
    const desiredState = planDesiredStateChange(catalog, enabled, { kind: 'disable', id: 'agon.browser' }, timestamp).nextState;
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desiredState), desiredState, installedIndex: {} });
    expect((await host.readCurrentPointer())?.generation).toBe(2);
  }

  const preview = () => previewManagedGenerationCollection(host, {
    generations: [1], rollbackWindowMs: 0, now: () => new Date('2030-01-01T00:00:00.000Z'),
  });

  it('distinguishes a protected lease from an otherwise collectible prior generation', async () => {
    await disableBrowser();
    await expect(preview()).resolves.toMatchObject({ kind: 'generation-retention' });
    const lease = await host.leaseGeneration(1, 'agon.kernel.invocation');
    try {
      await expect(preview()).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT', message: 'generation remains protected from collection' });
    } finally { await host.releaseGenerationLease(lease.leaseId); }
    await expect(preview()).resolves.toMatchObject({ kind: 'generation-retention' });
  });

  it.each(['completion', 'failure', 'cancellation'] as const)('protects an admitted HTTP turn until %s', async outcome => {
    await initializeProcessSurfaceAuthority(root);
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    const cancel = vi.fn(async () => ({ status: 'accepted' as const }));
    const brain = {
      async *runTurn(request: { turnId: string }) {
        entered = true;
        yield { kind: 'notice', level: 'info', message: 'fixture' };
        await held;
        if (outcome === 'failure') throw new Error('fixture brain failure');
        return { turnId: request.turnId, delegated: false, responded: true, engineId: 'fixture' };
      },
      cancel,
    } as unknown as BrainClient;
    const sessionId = randomUUID();
    serve = createAgonServe({ brain, sessionId });
    const { url, token } = await serve.start();
    const request = fetch(`${url}/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'held fixture turn' }), signal: AbortSignal.timeout(10_000),
    });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await disableBrowser();
      await expect(preview()).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT', message: 'generation remains protected from collection' });
      if (outcome === 'cancellation') {
        const cancelled = await fetch(`${url}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnId: `${sessionId}-1` }), signal: AbortSignal.timeout(5_000),
        });
        expect(cancelled.status).toBe(200);
        expect(await cancelled.json()).toEqual({ status: 'accepted' });
        expect(cancel).toHaveBeenCalledOnce();
        // Cancellation acknowledgement does not mean the turn has drained.
        await expect(preview()).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT', message: 'generation remains protected from collection' });
      } else {
        expect(cancel).not.toHaveBeenCalled();
      }
      release();
      const response = await request;
      expect(response.status).toBe(outcome === 'failure' ? 500 : 200);
      expect(await response.json()).toMatchObject(outcome === 'failure'
        ? { error: 'fixture brain failure' } : { result: { responded: true } });
      await expect(preview()).resolves.toMatchObject({ kind: 'generation-retention' });
    } finally {
      release();
      await Promise.allSettled([request]);
    }
  });

  it.each(['completion', 'cancellation'] as const)('retains the real brain invocation through %s and adapter cleanup', async outcome => {
    await initializeProcessSurfaceAuthority(root);
    const engine = { id: 'fixture', displayName: 'Fixture', binary: 'fixture' };
    const registry = {
      listIds: () => ['fixture'], get: () => engine, findBinary: () => '/fixture-not-launched',
    } as unknown as EngineRegistry;
    const brain = new AgenticTurnBrainClient(registry);
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let dispatchSignal: AbortSignal | undefined;
    Reflect.set(brain, 'adapter', {
      dispatch: async ({ signal }: { signal: AbortSignal }) => {
        dispatchSignal = signal;
        await held;
        return { stdout: signal.aborted ? '' : 'Fixture complete.', stderr: '', exitCode: signal.aborted ? 1 : 0, timedOut: false };
      },
    });
    await brain.open({ engineId: 'fixture', cwd: home });
    const sessionId = randomUUID();
    serve = createAgonServe({ brain, sessionId });
    const { url, token } = await serve.start();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const request = fetch(`${url}/send`, {
      method: 'POST', headers, body: JSON.stringify({ input: 'Say fixture complete.' }), signal: AbortSignal.timeout(10_000),
    });
    try {
      await vi.waitFor(() => expect(dispatchSignal).toBeDefined());
      await disableBrowser();
      await expect(preview()).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
      if (outcome === 'cancellation') {
        const cancelled = await fetch(`${url}/cancel`, {
          method: 'POST', headers, body: JSON.stringify({ turnId: `${sessionId}-1` }), signal: AbortSignal.timeout(5_000),
        });
        expect(cancelled.status).toBe(200);
        expect(await cancelled.json()).toEqual({ status: 'accepted' });
        expect(dispatchSignal?.aborted).toBe(true);
        await expect(preview()).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
      }
      release();
      const response = await request;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: outcome === 'cancellation'
        ? { responded: false, reason: 'cancelled by client' } : { responded: true } });
      expect(await host.activeGenerationLeases()).toEqual([]);
      await expect(preview()).resolves.toMatchObject({ kind: 'generation-retention' });
    } finally {
      release();
      await Promise.allSettled([request]);
      await brain.close();
    }
  });

  it('does not enter the brain when selection changes during lease acquisition', async () => {
    await initializeProcessSurfaceAuthority(root);
    const acquire = DurableModHost.prototype.leaseGeneration;
    vi.spyOn(DurableModHost.prototype, 'leaseGeneration').mockImplementationOnce(async function (...args) {
      const lease = await acquire.apply(this, args);
      await disableBrowser();
      return lease;
    });
    const entered = vi.fn();
    const brain = {
      async *runTurn() { entered(); yield { kind: 'notice', level: 'info', message: 'must not run' }; },
    } as unknown as BrainClient;
    serve = createAgonServe({ brain, sessionId: randomUUID() });
    const { url, token } = await serve.start();
    const response = await fetch(`${url}/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'race fixture' }), signal: AbortSignal.timeout(5_000),
    });
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('generation changed') });
    expect(entered).not.toHaveBeenCalled();
    expect(await host.activeGenerationLeases()).toEqual([]);
    await expect(preview()).resolves.toMatchObject({ kind: 'generation-retention' });
  });
});
