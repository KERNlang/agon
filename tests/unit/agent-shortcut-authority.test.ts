import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../../packages/cli/src/surface-authority-runtime.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import { runInJobAbortScope, trackJobAbortController } from '../../packages/cli/src/signals/job-abort-scope.js';

const effects = vi.hoisted(() => ({ solo: vi.fn(), team: vi.fn(), brain: vi.fn() }));
vi.mock('../../packages/cli/src/handlers/agent.js', async original => ({
  ...await original<object>(), runAgentMode: effects.solo, runAgentTeam: effects.team,
}));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: effects.brain,
}));

const NOW = '2026-11-02T00:00:00.000Z';
let root: string;
let host: DurableModHost;
beforeEach(async () => {
  vi.clearAllMocks();
  effects.solo.mockResolvedValue(null);
  effects.team.mockResolvedValue(null);
  effects.brain.mockResolvedValue({ responded: true, delegated: false });
  root = await mkdtemp(join(tmpdir(), 'agon-agent-shortcut-'));
  host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'agent-shortcut-test' });
});
afterEach(async () => {
  await disposeProcessSurfaceAuthority();
  const generations = await readdir(join(root, 'generations')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const generation of generations) await chmod(join(root, 'generations', generation), 0o755);
  await rm(root, { recursive: true, force: true });
});

async function install(disabled: boolean, initialize = true) {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, NOW);
  const desired = disabled
    ? planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.agent' }, NOW).nextState
    : full;
  await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
  if (initialize) await initializeProcessSurfaceAuthority(root);
}

function callbacks(apiEngines: string[] = []) {
  return {
    ctx: { config: {}, registry: { get: (id: string) => ({ id, ...(apiEngines.includes(id) ? { api: { model: 'fixture' } } : {}) }) }, adapter: {},
      activeEngines: () => apiEngines.length ? apiEngines : ['fixture'], chatSession: { id: 'fixture', messages: [] } },
    dispatch: vi.fn(), runAsJob: vi.fn(), setPendingImages: vi.fn(),
  };
}

it.each(['run agent inspect fixture', 'agent mode inspect fixture', 'autonomous agent inspect fixture'])(
  'refuses disabled Agent before scheduling: %s', async input => {
    await install(true);
    expect(() => assertProcessSurfaceAvailable('tui', '/agent')).toThrow();
    const cb = callbacks();
    const intent = detectIntent(input);
    expect(intent).toMatchObject({ type: 'agent', input: 'inspect fixture' });
    await expect(dispatchIntent(intent, input, cb as unknown as DispatchCallbacks)).rejects.toThrow();
    expect(cb.runAsJob).not.toHaveBeenCalled();
    expect(effects.solo).not.toHaveBeenCalled();
    expect(effects.team).not.toHaveBeenCalled();
  },
);

it('keeps the enabled natural shortcut on its existing solo handler', async () => {
  await install(false);
  const cb = callbacks();
  const input = 'run agent inspect fixture';
  await dispatchIntent(detectIntent(input), input, cb as unknown as DispatchCallbacks);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  expect(effects.solo).toHaveBeenCalledOnce();
  expect(effects.solo.mock.calls[0][0]).toBe('inspect fixture');
  expect(effects.team).not.toHaveBeenCalled();
});

it('cancels a running Cesar continuation when the durable pointer changes', async () => {
  await install(false);
  const cb = callbacks();
  let continuationAborted = false;
  let laterEffects = 0;
  effects.solo.mockResolvedValueOnce({ kind: 'agent', status: 'completed', task: 'fixture', summary: 'done' });
  effects.brain.mockImplementationOnce(async () => {
    const controller = new AbortController();
    trackJobAbortController(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancelled = new Promise<void>(resolve => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true });
        timer = setTimeout(resolve, 500);
      });
      await install(true, false);
      await cancelled;
      continuationAborted = controller.signal.aborted;
      if (!continuationAborted) laterEffects++;
      return { responded: true, delegated: false };
    } finally {
      clearTimeout(timer);
      trackJobAbortController(null, controller);
    }
  });
  const input = 'run agent inspect fixture';
  await dispatchIntent(detectIntent(input), input, cb as unknown as DispatchCallbacks);
  const parent = new AbortController();
  await runInJobAbortScope(parent.signal, () => cb.runAsJob.mock.calls[0][2](parent.signal)).catch(() => {});
  expect(effects.brain).toHaveBeenCalledOnce();
  expect(continuationAborted).toBe(true);
  expect(laterEffects).toBe(0);
  expect(parent.signal.aborted).toBe(false);
});

it.each(['agent', 'agent-solo', 'team-agent'])('refuses disabled legacy-shaped %s intents', async type => {
  await install(true);
  const cb = callbacks();
  await expect(dispatchIntent({ type, input: 'inspect fixture' }, 'fixture', cb as unknown as DispatchCallbacks)).rejects.toThrow();
  expect(cb.runAsJob).not.toHaveBeenCalled();
});

it.each(['agent', 'agent-solo', 'team-agent'])('rejects queued %s work after host replacement', async type => {
  await install(false);
  const cb = callbacks();
  await dispatchIntent({ type, input: 'inspect fixture' }, 'fixture', cb as unknown as DispatchCallbacks);
  await disposeProcessSurfaceAuthority();
  await initializeProcessSurfaceAuthority(root);
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow(/replaced|restart/);
  expect(effects.solo).not.toHaveBeenCalled();
  expect(effects.team).not.toHaveBeenCalled();
});

it.each(['agent', 'agent-solo', 'team-agent'])('rejects already cancelled %s work', async type => {
  await install(false);
  const cb = callbacks();
  await dispatchIntent({ type, input: 'inspect fixture' }, 'fixture', cb as unknown as DispatchCallbacks);
  const controller = new AbortController();
  const reason = new Error('fixture cancelled');
  controller.abort(reason);
  await expect(cb.runAsJob.mock.calls[0][2](controller.signal)).rejects.toBe(reason);
  expect(effects.solo).not.toHaveBeenCalled();
  expect(effects.team).not.toHaveBeenCalled();
});

it.each(['agent', 'agent-solo', 'team-agent'])('carries authority into running %s and refuses its stale result', async type => {
  await install(false);
  const cb = callbacks();
  const run = type === 'team-agent' ? effects.team : effects.solo;
  const observations: Array<string | undefined> = [];
  let returnedResult = false;
  run.mockImplementationOnce(async (_input, _dispatch, _ctx, options) => {
    observations.push(options.executionRefusal());
    await install(true);
    observations.push(options.executionRefusal());
    returnedResult = true;
    return { kind: 'agent', status: 'completed', task: 'fixture', summary: 'stale result' };
  });
  await dispatchIntent({ type, input: 'inspect fixture' }, 'fixture', cb as unknown as DispatchCallbacks);
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow(/replaced|restart/);
  expect(run).toHaveBeenCalledOnce();
  expect(returnedResult).toBe(true);
  expect(observations).toEqual([undefined, expect.stringMatching(/replaced|restart/)]);
  expect(cb.dispatch.mock.calls.some(([event]) => String(event.message).includes('Cesar resuming'))).toBe(false);
});

it.each([
  { type: 'agent', input: 'inspect fixture', handler: 'team', options: { shadowMode: true, engines: ['one', 'two'], foregroundEngineId: 'one', taskKind: 'edit' } },
  { type: 'agent', input: 'ask the team to inspect fixture', handler: 'team', options: { taskKind: 'edit' } },
  { type: 'agent-solo', input: 'inspect fixture', handler: 'solo', options: { maxTurns: 7 } },
  { type: 'team-agent', input: 'inspect fixture', handler: 'team', options: { engines: ['two', 'one'], taskKind: 'investigate', maxTurns: 7 } },
])('preserves enabled $type routing/options for $input', async ({ type, input, handler, options }) => {
  await install(false);
  const cb = callbacks(['one', 'two']);
  await dispatchIntent({ type, input, maxTurns: 7, engines: ['two', 'one'], taskKind: 'investigate' }, input, cb as unknown as DispatchCallbacks);
  await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  const run = handler === 'solo' ? effects.solo : effects.team;
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][3]).toMatchObject({ ...options, executionRefusal: expect.any(Function), parentSignal: expect.any(AbortSignal) });
  expect(run.mock.calls[0][3].executionRefusal()).toBeUndefined();
  if (type === 'agent' && input.includes('team')) expect(run.mock.calls[0][3]).not.toHaveProperty('shadowMode');
  expect(handler === 'solo' ? effects.team : effects.solo).not.toHaveBeenCalled();
});

it.each(['parent', 'host'].flatMap(source => ['solo', 'shadow', 'team'].map(mode => ({ source, mode }))))('cancels running $mode after $source revocation and waits for cleanup', async ({ source, mode }) => {
  await install(false);
  const cb = callbacks(mode === 'solo' ? [] : ['one', 'two']);
  const controller = new AbortController();
  let cleaned = false;
  let refusal: string | undefined;
  let releaseCleanup!: () => void;
  let markCleanupStarted!: () => void;
  const cleanupStarted = new Promise<void>(resolve => { markCleanupStarted = resolve; });
  const cleanupReleased = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const run = mode === 'solo' ? effects.solo : effects.team;
  run.mockImplementationOnce(async (_input, _dispatch, _ctx, options) => {
    const signal = options.parentSignal as AbortSignal;
    const cancelled = new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    if (source === 'parent') controller.abort(new Error('parent revoked'));
    else await install(true, false);
    await cancelled;
    refusal = options.executionRefusal();
    markCleanupStarted();
    await cleanupReleased;
    cleaned = true;
    return { kind: 'agent', status: 'cancelled', task: 'fixture', summary: 'cancelled' };
  });
  const input = mode === 'team' ? 'run agent ask the team to inspect fixture' : 'run agent inspect fixture';
  await dispatchIntent(detectIntent(input), input, cb as unknown as DispatchCallbacks);
  let settled = false;
  const pending = cb.runAsJob.mock.calls[0][2](controller.signal).then(
    () => { settled = true; return undefined; },
    (error: unknown) => { settled = true; return error; },
  );
  await cleanupStarted;
  const settledBeforeCleanup = settled;
  const activeLeases = await host.activeGenerationLeases();
  releaseCleanup();
  const error = await pending;
  expect(settledBeforeCleanup).toBe(false);
  expect(activeLeases.some(lease => lease.ownerId === 'agon.kernel.invocation')).toBe(true);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toMatch(source === 'parent' ? /parent revoked/ : /replaced|restart/);
  expect(cleaned).toBe(true);
  expect(refusal).toMatch(source === 'parent' ? /parent revoked/ : /replaced|restart/);
  expect(cb.dispatch.mock.calls.some(([event]) => String(event.message).includes('Cesar resuming'))).toBe(false);
  expect((await host.activeGenerationLeases()).some(lease => lease.ownerId === 'agon.kernel.invocation')).toBe(false);
});

it.each(['completed', 'failed', 'rejected'])('preserves healthy authority continuation for %s work', async status => {
  await install(false);
  const cb = callbacks();
  const failure = new Error('ordinary handler failure');
  if (status === 'rejected') effects.solo.mockRejectedValueOnce(failure);
  else effects.solo.mockResolvedValueOnce({ kind: 'agent', status, task: 'fixture', summary: status });
  const input = 'run agent inspect fixture';
  await dispatchIntent(detectIntent(input), input, cb as unknown as DispatchCallbacks);
  const pending = cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  if (status === 'rejected') await expect(pending).rejects.toBe(failure);
  else await pending;
  expect(effects.brain).toHaveBeenCalledOnce();
  expect(effects.brain.mock.calls[0][0]).toContain(status === 'completed' ? 'finished' : 'failed');
});
