import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EngineRegistry, configSet } from '@kernlang/agon-core';
import { startTelemetryPoller } from '../../packages/cli/src/surfaces/app-lifecycle.js';
import type { TelemetryPollerDeps } from '../../packages/cli/src/surfaces/app-lifecycle.js';
import { takePlanFallback } from '../../packages/cli/src/signals/plan-fallback.js';

vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<typeof import('@kernlang/agon-core')>(),
  configSet: vi.fn(),
}));
vi.mock('../../packages/cli/src/surfaces/app-telemetry.js', () => ({
  probeEngineVitals: async (_registry: unknown, id: string) => ({
    state: id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: Date.now() - 40000,
  }),
}));

const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); vi.mocked(configSet).mockReset(); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

function fixture() {
  const registry = new EngineRegistry();
  for (const id of ['a', 'b']) registry.register({ id, displayName: id, binary: 'node', timeout: 1, tier: 'user' } as any);
  const oldClose = vi.fn();
  const currentClose = vi.fn();
  const queue: string[] = [];
  const turn = { input: 'fixture prompt', engineId: 'a', retried: false };
  const opts: TelemetryPollerDeps = {
    registry, cesarSession: { close: oldClose } as any,
    cesarSessionHolder: { session: { close: currentClose } as any },
    activeEngines: () => ['a', 'b'], dispatch: vi.fn(),
    telemetryPollerRef: { current: null }, activeEnginePidsRef: { current: new Map() },
    activeTurnRef: { current: turn }, activePlanRef: { current: null },
    activeAbortRef: { current: new AbortController() }, setRecentFallbacks: vi.fn(),
    setConfigVersion: vi.fn(), setCesarSessionWrapped: vi.fn(),
    setInputQueue: vi.fn(updater => { queue.splice(0, queue.length, ...updater(queue)); }),
    setTelemetryVitals: vi.fn(), statusDashboardOpenRef: { current: false },
  };
  const start = () => { const cleanup = startTelemetryPoller(opts)!; cleanups.push(cleanup); return cleanup; };
  return { opts, start, queue, turn, oldClose, currentClose };
}

it('closes the current session and queues a foreground retry exactly once', async () => {
  const { opts, start, queue, turn, currentClose, oldClose } = fixture();
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(currentClose).toHaveBeenCalledOnce();
  expect(oldClose).not.toHaveBeenCalled();
  expect(configSet).toHaveBeenCalledWith('cesarEngine', 'b');
  expect(opts.activeAbortRef.current?.signal.aborted).toBe(true);
  expect(queue).toEqual(['fixture prompt']);
  expect(turn.retried).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(queue).toEqual(['fixture prompt']);
  expect(configSet).toHaveBeenCalledOnce();
});

it('does not revive a foreground turn that was already cancelled', async () => {
  const { opts, start, queue, turn, currentClose, oldClose } = fixture();
  opts.activeAbortRef.current!.abort();
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).not.toHaveBeenCalled();
  expect(currentClose).not.toHaveBeenCalled();
  expect(oldClose).not.toHaveBeenCalled();
  expect(queue).toEqual([]);
  expect(turn.retried).toBe(false);
});

it('does not consume a retry when writing the engine selection fails', async () => {
  const { opts, start, queue, turn, currentClose, oldClose } = fixture();
  vi.mocked(configSet).mockImplementation(() => { throw new Error('fixture config failure'); });
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).toHaveBeenCalledOnce();
  expect(turn.retried).toBe(false);
  expect(opts.activeAbortRef.current?.signal.aborted).toBe(false);
  expect(currentClose).not.toHaveBeenCalled();
  expect(oldClose).not.toHaveBeenCalled();
  expect(queue).toEqual([]);
});

it('plan fallback does not consume or enqueue the foreground prompt retry', async () => {
  const { opts, start, queue, turn } = fixture();
  opts.activePlanRef.current = { id: 'fixture-plan', state: 'running', steps: [{ id: 'step-1', state: 'running', engine: 'a' }] } as any;
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).toHaveBeenCalledWith('cesarEngine', 'b');
  expect(opts.activeAbortRef.current?.signal.aborted).toBe(true);
  expect(queue).toEqual([]);
  expect(turn.retried).toBe(false);
  expect(takePlanFallback(opts.activeAbortRef.current!.signal, 'fixture-plan')).toEqual({
    planId: 'fixture-plan', stepId: 'step-1', engine: 'b',
  });
});

it('old effect cleanup cannot clear the replacement poller reference', () => {
  const { opts, start } = fixture();
  const stopOld = start();
  const old = opts.telemetryPollerRef.current;
  start();
  const replacement = opts.telemetryPollerRef.current;
  stopOld();
  expect(old?.isRunning()).toBe(false);
  expect(opts.telemetryPollerRef.current).toBe(replacement);
  expect(replacement?.isRunning()).toBe(true);
});

it.each(['no work', 'unrelated prompt', 'spent prompt retry', 'unrelated plan', 'spent plan retry'])(
  'does not switch engines for %s', async scenario => {
    const { opts, start, queue, currentClose, oldClose } = fixture();
    if (scenario === 'unrelated prompt') opts.activeTurnRef.current!.engineId = 'b';
    else if (scenario === 'spent prompt retry') opts.activeTurnRef.current!.retried = true;
    else opts.activeTurnRef.current = null;
    if (scenario === 'unrelated plan' || scenario === 'spent plan retry') {
      opts.activePlanRef.current = { state: 'running', steps: [{ id: 's', state: 'running', engine: scenario === 'unrelated plan' ? 'b' : 'a' }],
        fallbackRetriesUsed: scenario === 'spent plan retry' ? { s: 1 } : {} } as any;
    }
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(configSet).not.toHaveBeenCalled();
    expect(currentClose).not.toHaveBeenCalled();
    expect(oldClose).not.toHaveBeenCalled();
    expect(opts.activeAbortRef.current?.signal.aborted).toBe(false);
    expect(queue).toEqual([]);
  });

it('does not close an obsolete captured session when the current holder is empty', async () => {
  const { opts, start, oldClose, queue } = fixture();
  opts.cesarSessionHolder.session = null;
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(oldClose).not.toHaveBeenCalled();
  expect(queue).toEqual(['fixture prompt']);
});
