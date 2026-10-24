import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ approve: vi.fn(async () => true), resume: vi.fn(async () => {}), taskRoute: vi.fn(async () => false) }));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', () => ({ routeWithCesar: effects.taskRoute }));
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
vi.mock('../../packages/cli/src/blocks/plan-execution-effects.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../packages/cli/src/blocks/plan-execution-effects.js')>();
  return { ...original, createPlanExecutionSession: (cb: DispatchCallbacks) => ({
    ...original.createPlanExecutionSession(cb), approvePending: effects.approve, resume: effects.resume,
  }) };
});

const NOW = '2026-10-09T00:00:00.000Z';

describe.each([true, false])('natural Plan input with disabled=%s', disabled => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'agon-plan-natural-'));
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const desired = disabled
      ? planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.plan' }, NOW).nextState
      : full;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'plan-natural-test' });
    await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    await initializeProcessSurfaceAuthority(root);
  });
  afterAll(async () => {
    await disposeProcessSurfaceAuthority();
    // The host deliberately seals generation directories read-only.
    await chmod(join(root, 'generations', '0000000000000001'), 0o755);
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    effects.approve.mockReset().mockResolvedValue(true);
    effects.resume.mockReset().mockResolvedValue(undefined);
    effects.taskRoute.mockReset().mockResolvedValue(false);
  });

  it('checks the selected owner before starting a legacy-shaped Plan task', async () => {
    const dispatch = vi.fn();
    const setActivePlan = vi.fn();
    const cb = { dispatch, setActivePlan, ctx: { config: {}, cesar: {} } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type: 'plan-task', task: 'build parser' }, '/plan build parser', cb);
    expect(effects.taskRoute).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(setActivePlan).toHaveBeenCalledTimes(disabled ? 0 : 2);
    if (disabled) expect(cb.ctx.cesar).toEqual({});
    if (disabled) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  });

  it('checks the selected owner before dispatching a physical approval marker', async () => {
    const dispatch = vi.fn();
    let job: Promise<void> | undefined;
    const runAsJob = vi.fn((_type: string, _label: string, run: (signal: AbortSignal) => Promise<void>) => {
      job = run(new AbortController().signal);
    });
    const cb = { dispatch, runAsJob, ctx: { config: {}, cesar: {} } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type: 'approve', _modSurface: {
      publicId: 'approve', registryId: 'tuiSlashCommands:0003', kind: 'tui-action', value: {},
    } }, '/approve', cb);
    await job;
    expect(runAsJob).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(effects.approve).toHaveBeenCalledTimes(disabled ? 0 : 1);
    if (disabled) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  });

  it.each(['auto', 'unknown'])('checks Plan ownership before legacy %s enters autonomous mode', async type => {
    const dispatch = vi.fn();
    const cb = { dispatch, allImages: [], ctx: { config: {}, cesar: {}, autoModeQueued: false } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type, input: 'build parser', autoMode: true }, '/auto build parser', cb);
    expect(effects.taskRoute).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(cb.ctx.autoModeQueued).toBe(false);
    if (disabled) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  });

  it.each(['before lookup', 'after scheduling'])('reports stale physical authority %s without executing approval', async timing => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    let runJob: ((signal: AbortSignal) => Promise<void>) | undefined;
    const dispatch = vi.fn();
    const emit = vi.fn<(event: string, payload: unknown) => Promise<void>>(async () => {});
    const cb = { dispatch, eventBus: { emit }, ctx: { config: {}, cesar: {} },
      runAsJob: vi.fn((_type: string, _label: string, run: (signal: AbortSignal) => Promise<void>) => { runJob = run; }),
    } as unknown as DispatchCallbacks;
    try {
      if (timing === 'before lookup') await writeFile(pointer, '{}\n');
      await dispatchIntent({ type: 'approve', _modSurface: {
        publicId: 'approve', registryId: 'tuiSlashCommands:0003', kind: 'tui-action', value: {},
      } }, '/approve', cb);
      if (timing === 'after scheduling' && !disabled) {
        expect(runJob).toBeTypeOf('function');
        await writeFile(pointer, '{}\n');
        await runJob!(new AbortController().signal);
      }
      expect(effects.approve).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining(
        disabled && timing === 'after scheduling' ? 'unavailable' : 'restart Agon',
      ) }));
      expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(1);
    } finally {
      await writeFile(pointer, original);
    }
  });

  it.each(['unknown', 'auto'])('keeps ordinary %s input available without Plan', async type => {
    const cb = { dispatch: vi.fn(), allImages: [], ctx: { config: {}, cesar: {} } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type, input: 'hello' }, 'hello', cb);
    expect(effects.taskRoute).toHaveBeenCalledOnce();
    expect(cb.ctx.autoModeQueued).toBeUndefined();
  });

  if (disabled) it.each(['plan', 'plan-resume', 'plans', 'approve', 'retry', 'cancel'])('refuses disabled legacy %s without changing session state', async type => {
    const dispatch = vi.fn();
    const emit = vi.fn<(event: string, payload: unknown) => Promise<void>>(async () => {});
    const ctx = { config: {}, cesar: {} };
    const cb = { dispatch, eventBus: { emit }, ctx } as unknown as DispatchCallbacks;
    expect(await dispatchIntent({ type }, `/${type}`, cb)).toEqual({ handled: true, ranAsJob: false });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
    expect(ctx).toEqual({ config: {}, cesar: {} });
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.resume).not.toHaveBeenCalled();
    expect(effects.taskRoute).not.toHaveBeenCalled();
    expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(1);
  });

  it.each([false, true, undefined])('restores prior Auto state %s for every route outcome', async prior => {
    for (const outcome of [false, true, 'reject'] as const) {
      effects.taskRoute.mockClear();
      const cb = { dispatch: vi.fn(), allImages: [], ctx: { config: {}, cesar: {}, autoModeQueued: prior } } as unknown as DispatchCallbacks;
      const failure = new Error('route failed');
      effects.taskRoute.mockImplementationOnce(async () => {
        expect(cb.ctx.autoModeQueued).toBe(true);
        if (outcome === 'reject') throw failure;
        return outcome;
      });
      const operation = dispatchIntent({ type: 'auto', input: 'build parser', autoMode: true }, '/auto build parser', cb);
      if (!disabled && outcome === 'reject') await expect(operation).rejects.toBe(failure);
      else await expect(operation).resolves.toEqual({ handled: true, ranAsJob: !disabled && outcome === true });
      expect(cb.ctx.autoModeQueued).toBe(prior);
      expect(effects.taskRoute).toHaveBeenCalledTimes(disabled ? 0 : 1);
      effects.taskRoute.mockReset().mockResolvedValue(false);
    }
  });

  it.each([false, true])('guards dynamic skill effects only for explicit Auto=%s', async autoMode => {
    const handler = vi.fn(async () => ({ handled: true }));
    const cb = { dispatch: vi.fn(), dynamicSkills: [{ trigger: '/fixture', handler }],
      ctx: { config: {}, cesar: {} },
    } as unknown as DispatchCallbacks;
    await dispatchIntent({ type: 'unknown', input: '/fixture task', autoMode }, '/fixture task', cb);
    expect(handler).toHaveBeenCalledTimes(disabled && autoMode ? 0 : 1);
    expect(effects.taskRoute).not.toHaveBeenCalled();
  });

  it.each(['plan', 'plan-resume', 'plans', 'approve', 'retry', 'cancel', 'plan-task', 'auto', 'unknown'])('refuses legacy %s after a generation change', async type => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    try {
      await writeFile(pointer, '{}\n');
      const dispatch = vi.fn();
      const setActivePlan = vi.fn();
      const cb = { dispatch, setActivePlan, ctx: { config: {}, cesar: {} } } as unknown as DispatchCallbacks;
      const result = await dispatchIntent({ type, input: 'build parser', task: 'build parser', autoMode: type === 'auto' || type === 'unknown' }, `/${type}`, cb);
      expect(result).toEqual({ handled: true, ranAsJob: false });
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('restart Agon') }));
      expect(effects.taskRoute).not.toHaveBeenCalled();
      expect(effects.approve).not.toHaveBeenCalled();
      expect(effects.resume).not.toHaveBeenCalled();
      expect(setActivePlan).not.toHaveBeenCalled();
    } finally {
      await writeFile(pointer, original);
    }
  });

  it.each([
    ['awaiting_approval', 'go', 'approve'],
    ['paused', 'continue', 'resume'],
    ['running', 'resume', 'resume'],
  ] as const)('checks the active registry before %s / %s', async (state, input, action) => {
    const plan = { id: 'cplan-fixture', state, steps: [], intent: 'fixture', createdAt: NOW };
    const dispatch = vi.fn();
    const runAsJob = vi.fn();
    const emit = vi.fn(async (_event: string, _payload: unknown) => {});
    const cb = { dispatch, runAsJob, eventBus: { emit }, ctx: { activePlan: plan, cesar: {}, config: {} } } as unknown as DispatchCallbacks;
    const before = structuredClone(plan);
    const result = await dispatchIntent({ type: 'chat', input }, input, cb);
    expect(result).toEqual({ handled: true, ranAsJob: false });
    expect(effects[action]).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(effects[action === 'approve' ? 'resume' : 'approve']).not.toHaveBeenCalled();
    expect(runAsJob).not.toHaveBeenCalled();
    expect(plan).toStrictEqual(before);
    expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(1);
    if (disabled) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  });

  it('keeps historical status readable without executing a disabled plan', async () => {
    const dispatch = vi.fn();
    const emit = vi.fn(async (_event: string, _payload: unknown) => {});
    const cb = { dispatch, eventBus: { emit }, ctx: { activePlan: { id: 'cplan-history', state: 'paused', steps: [] }, cesar: {} } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type: 'chat', input: 'status' }, 'status', cb);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', message: expect.stringContaining('is paused') }));
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.resume).not.toHaveBeenCalled();
    expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(1);
  });

  it.each(['awaiting_approval', 'paused'] as const)('refuses %s actions after a generation change', async state => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    try {
      await writeFile(pointer, '{}\n');
      const dispatch = vi.fn();
      const emit = vi.fn(async (_event: string, _payload: unknown) => {});
      const cb = { dispatch, eventBus: { emit }, ctx: { activePlan: { id: 'cplan-stale', state, steps: [] }, cesar: {} } } as unknown as DispatchCallbacks;
      await dispatchIntent({ type: 'chat', input: 'go' }, 'go', cb);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('restart Agon') }));
      expect(effects.approve).not.toHaveBeenCalled();
      expect(effects.resume).not.toHaveBeenCalled();
      expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(1);
    } finally {
      await writeFile(pointer, original);
    }
  });

  if (!disabled) it.each(['approval-error', 'resume-error', 'resume-fallback', 'chat-fallback'] as const)(
    'preserves natural-input tail and fallthrough for %s', async outcome => {
      const failure = new Error('execution rejected');
      const emit = vi.fn(async (_event: string, _payload: unknown) => {});
      const proposedPlan = { id: 'proposal', state: 'awaiting_approval', steps: [] };
      const activePlan = outcome === 'chat-fallback' ? undefined : { id: 'paused', state: 'paused', steps: [] };
      const cb = { dispatch: vi.fn(), allImages: [], eventBus: { emit },
        ctx: { config: {}, activePlan, cesar: { proposedPlan } },
      } as unknown as DispatchCallbacks;
      effects.approve.mockImplementation(async () => {
        if (outcome === 'approval-error') throw failure;
        return false;
      });
      effects.resume.mockImplementation(async () => { if (outcome === 'resume-error') throw failure; });
      const operation = dispatchIntent({ type: 'chat', input: 'go' }, 'go', cb);
      const failed = outcome.endsWith('-error');
      if (failed) await expect(operation).rejects.toBe(failure);
      else await expect(operation).resolves.toEqual({ handled: true, ranAsJob: false });
      expect(effects.approve).toHaveBeenCalledOnce();
      expect(effects.resume).toHaveBeenCalledTimes(outcome === 'resume-error' || outcome === 'resume-fallback' ? 1 : 0);
      expect(effects.taskRoute).toHaveBeenCalledTimes(outcome === 'chat-fallback' ? 1 : 0);
      expect(emit.mock.calls.filter(([event]) => event === 'post:dispatch')).toHaveLength(failed ? 0 : 1);
    });
});
