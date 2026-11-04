import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EngineRegistry, configSet } from '@kernlang/agon-core';
import { startTelemetryPoller } from '../../packages/cli/src/surfaces/app-lifecycle.js';
import type { TelemetryPollerDeps } from '../../packages/cli/src/surfaces/app-lifecycle.js';
import { takePlanFallback } from '../../packages/cli/src/signals/plan-fallback.js';
import type { QueuedInput } from '../../packages/cli/src/signals/queued-input.js';
import { ensureCesarSession, mcpConfigFingerprint } from '../../packages/cli/src/cesar/session.js';
import { handleCesarBrain } from '../../packages/cli/src/cesar/brain.js';
import { routeWithCesar } from '../../packages/cli/src/signals/dispatch/cesar-router.js';

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
  const queue: QueuedInput[] = [];
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
  expect(queue).toEqual([{ kind: 'telemetry-retry', input: 'fixture prompt' }]);
  expect(turn.retried).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(queue).toEqual([{ kind: 'telemetry-retry', input: 'fixture prompt' }]);
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
  expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning', message: expect.stringContaining('engine selection could not be saved'),
  }));
});

it.each(['close', 'detach', 'plan close', 'plan detach'])('stops automatic replay and reports partial handoff when session %s fails', async phase => {
  const { opts, start, queue, turn, currentClose } = fixture();
  const fail = () => { throw new Error('fixture session failure'); };
  if (phase.startsWith('plan')) {
    opts.activePlanRef.current = { id: 'failed-handoff-plan', state: 'running', steps: [{ id: 's', state: 'running', engine: 'a' }] } as any;
  }
  if (phase.endsWith('close')) currentClose.mockImplementation(fail);
  else vi.mocked(opts.setCesarSessionWrapped).mockImplementation(fail);
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).toHaveBeenCalledExactlyOnceWith('cesarEngine', 'b');
  expect(opts.activeAbortRef.current?.signal.aborted).toBe(true);
  expect(turn.retried).toBe(false);
  expect(queue).toEqual([]);
  expect(takePlanFallback(opts.activeAbortRef.current!.signal, 'failed-handoff-plan')).toBeUndefined();
  expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning', message: expect.stringContaining('Automatic retry was cancelled'),
  }));
  await vi.advanceTimersByTimeAsync(5000);
  expect(configSet).toHaveBeenCalledOnce();
  expect(queue).toEqual([]);
  // An effect restart and a fresh controller must not rehabilitate the same
  // session whose cleanup failed.
  opts.activeAbortRef.current = new AbortController();
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).toHaveBeenCalledOnce();
  // A new session can recover; the failure fence is not a global kill switch.
  opts.activePlanRef.current = null;
  opts.cesarSessionHolder.session = { close: vi.fn() } as any;
  vi.mocked(opts.setCesarSessionWrapped).mockReset();
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(configSet).toHaveBeenCalledTimes(2);
  expect(queue).toEqual([{ kind: 'telemetry-retry', input: 'fixture prompt' }]);
});

it.each(['close', 'detach'])('manual submission refuses a session after handoff %s failure', async phase => {
  const { opts, start, currentClose } = fixture();
  const session = Object.assign(opts.cesarSessionHolder.session!, { alive: true, engineId: 'a', start: vi.fn() });
  const config = { cesarEngine: 'a' };
  const ctx = { config, cesarSession: session, setCesarSession: vi.fn(),
    cesar: { mcpFingerprint: mcpConfigFingerprint(config), harnessProfile: 'legacy' } } as any;
  // Positive control: this is a valid reusable session before the failure.
  await expect(ensureCesarSession(ctx)).resolves.toBe(session);
  const fail = () => { throw new Error('fixture cleanup failure'); };
  if (phase === 'close') currentClose.mockImplementation(fail);
  else vi.mocked(opts.setCesarSessionWrapped).mockImplementation(fail);
  start();
  await vi.advanceTimersByTimeAsync(0);
  await expect(ensureCesarSession(ctx)).rejects.toThrow('Session cleanup previously failed');
  const dispatch = vi.fn();
  const downstream = vi.fn(() => { throw new Error('blocked session reached downstream setup'); });
  const blockedContext = { cesarSession: session, get config() { return downstream(); } } as any;
  await expect(handleCesarBrain('manual', dispatch, blockedContext)).resolves.toMatchObject({
    terminalState: 'failed', decisionReason: 'session-cleanup-failed', responded: false,
  });
  await expect(routeWithCesar('manual', [], { ctx: blockedContext, dispatch } as any)).resolves.toBe(false);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning', message: expect.stringContaining('Session cleanup previously failed'),
  }));
  expect(downstream).not.toHaveBeenCalled();
  // A dead flag must not trigger restart, nor a changed engine another close.
  session.alive = false;
  await expect(ensureCesarSession(ctx)).rejects.toThrow('Session cleanup previously failed');
  config.cesarEngine = 'b';
  await expect(ensureCesarSession(ctx)).rejects.toThrow('Session cleanup previously failed');
  expect(session.start).not.toHaveBeenCalled();
  expect(ctx.setCesarSession).not.toHaveBeenCalled();
  expect(currentClose).toHaveBeenCalledOnce();
  const replacement = { alive: true, engineId: 'a' };
  config.cesarEngine = 'a';
  ctx.cesarSession = replacement;
  await expect(ensureCesarSession(ctx)).resolves.toBe(replacement);
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
  expect(queue).toEqual([{ kind: 'telemetry-retry', input: 'fixture prompt' }]);
});
