import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { assertProcessPlanStepAvailable, disposeProcessSurfaceAuthority, guardProcessEngineAdapter, initializeProcessSurfaceAuthority, processSurfaceCatalog, withProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { SurfaceGeneration } from '@kernlang/agon-kernel';
import type { CesarPlanStep } from '@kernlang/agon-mod-plan';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { DispatchOptions, EngineAdapter, EngineDefinition } from '@kernlang/agon-core';
import { tracker, setSessionRoot, _resetSessionRootForTests } from '@kernlang/agon-core';

const effects = vi.hoisted(() => ({ brainstorm: vi.fn(), brain: vi.fn(), delegate: vi.fn(), other: vi.fn(), verify: vi.fn() }));
vi.mock('../../packages/cli/src/cesar/brain.js', () => ({ handleCesarBrain: effects.brain }));
vi.mock('@kernlang/agon-core', async original => {
  const core = await original<typeof import('@kernlang/agon-core')>();
  return { ...core, spawnWithTimeout: effects.verify.mockImplementation(core.spawnWithTimeout) };
});
vi.mock('@kernlang/agon-forge', async original => ({
  ...await original<Record<string, unknown>>(), runBrainstorm: effects.brainstorm,
  runDelegate: effects.delegate, runForge: effects.other, runTribunal: effects.other, runCampfire: effects.other,
}));
vi.mock('../../packages/cli/src/handlers/agent.js', async original => ({
  ...await original<Record<string, unknown>>(), runAgentMode: effects.other, runAgentTeam: effects.other,
}));
vi.mock('../../packages/cli/src/handlers/review.js', async original => ({
  ...await original<Record<string, unknown>>(), runReviewCore: effects.other,
  resolveReviewTarget: () => ({ diff: 'fixture diff', label: 'fixture' }),
  selectReviewEngine: () => 'fixture',
}));
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

const NOW = '2026-10-10T00:00:00.000Z';
let root: string;
let host: DurableModHost;
beforeEach(async () => {
  vi.clearAllMocks();
  effects.verify.mockImplementation((await vi.importActual<typeof import('@kernlang/agon-core')>('@kernlang/agon-core')).spawnWithTimeout);
  effects.brainstorm.mockResolvedValue({ winner: 'fixture', response: 'answer' });
  effects.brain.mockReset().mockResolvedValue({ terminalState: 'completed', responded: true });
  effects.delegate.mockResolvedValue({ response: 'answer' });
  root = await mkdtemp(join(tmpdir(), 'agon-step-admission-'));
  await writeFile(join(root, 'empty.patch'), '');
  effects.other.mockResolvedValue({ winner: 'fixture', patches: { fixture: join(root, 'empty.patch') }, summary: 'review', status: 'completed' });
  vi.stubEnv('AGON_HOME', join(root, 'execution-home'));
  host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'step-admission-test' });
});
afterEach(async () => {
  _resetSessionRootForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await disposeProcessSurfaceAuthority();
  vi.unstubAllEnvs();
  const generations = await readdir(join(root, 'generations')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const generation of generations) await chmod(join(root, 'generations', generation), 0o755);
  await rm(root, { recursive: true, force: true });
});
async function install(disabled?: string) {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, NOW);
  const desired = disabled ? planDesiredStateChange(catalog, full, { kind: 'disable', id: disabled }, NOW).nextState : full;
  await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
}
function context(): HandlerContext { return { config: {}, adapter: {} } as HandlerContext; }
function step(type: string): CesarPlanStep {
  return { id: 'step', type, description: 'fixture', state: 'pending', estimatedTokens: 0, estimatedCostUsd: 0 };
}

it.each(['failed', 'timed_out', 'cancelled', 'superseded'])('rejects a live self-step brain outcome of %s', async terminalState => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  effects.brain.mockResolvedValue({ terminalState, decisionReason: 'fixture stop' });
  effects.verify.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: '', stderr: '' });
  const result = await buildStepExecutors(context(), vi.fn()).self.execute({ ...step('self'), verifyCmd: 'must-not-run' }, {});
  expect(result.result.status).toBe('failure');
  expect(result.result.error).toContain(terminalState);
  expect(result).not.toHaveProperty('contextExport');
  expect(effects.brain).toHaveBeenCalledOnce();
  expect(effects.verify).not.toHaveBeenCalled();
});

it('binds a live self-step brain to the Plan signal and generation', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  const ctx = context();
  effects.brain.mockImplementationOnce(async (_prompt, _emit, boundContext, images, signal, assertAvailable) => {
    expect(boundContext).toBe(ctx);
    expect(images).toEqual([]);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(() => assertAvailable()).not.toThrow();
    await install('agon.plan');
    expect(() => assertAvailable()).toThrow(/restart/);
    return { terminalState: 'completed' };
  });
  const result = await buildStepExecutors(ctx, vi.fn()).self.execute({ ...step('self'), verifyCmd: 'must-not-run' }, {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringMatching(/restart/) });
  expect(effects.brain).toHaveBeenCalledOnce();
  expect(effects.verify).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('contextExport');
});

it.each(['agent', 'team-agent'].flatMap(type =>
  ['missing', 'failed', 'cancelled', 'budget_exceeded', 'no-winner', 'completed'].map(status => ({ type, status })),
))('keeps the real Agent outcome in Plan: $type / $status', async ({ type, status }) => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const stats = tracker.getStats();
  vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ ...stats, totalTokens: 10, meteredCostUsd: 1 })
    .mockReturnValue({ ...stats, totalTokens: 17, meteredCostUsd: 1.25 });
  effects.other.mockImplementationOnce(async (_task, dispatch) => {
    dispatch({ type: 'info', message: `observed ${status}` });
    return status === 'missing' ? null : { status, summary: `backend ${status}` };
  });
  const result = await buildStepExecutors(context())[type].execute(step(type), {});
  expect(effects.other).toHaveBeenCalledOnce();
  expect(result.result).toMatchObject({
    status: status === 'completed' ? 'success' : 'failure',
    actualTokens: 7, actualCostUsd: 0.25, output: `observed ${status}`,
  });
  if (status === 'completed') expect(result.contextExport).toBe('observed completed');
  else {
    expect(result).not.toHaveProperty('contextExport');
    expect(result.result.error).toBeTruthy();
  }
});

it.each(['agent', 'team-agent'].flatMap(type =>
  ['agon.agent', 'agon.plan', 'healthy'].map(owner => ({ type, owner })),
))('passes live Plan authority into a running $type: $owner', async ({ type, owner }) => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  let received = false;
  let initial: string | undefined;
  let after: string | undefined;
  effects.other.mockImplementationOnce(async (_task, _dispatch, _ctx, options) => {
    received = typeof options.executionRefusal === 'function';
    if (!received) return null;
    initial = options.executionRefusal();
    if (owner !== 'healthy') await install(owner);
    after = options.executionRefusal();
    return { status: 'completed' };
  });
  const result = await buildStepExecutors(context())[type].execute(step('self'), {});
  expect(received).toBe(true);
  expect(initial).toBeUndefined();
  if (owner === 'healthy') {
    expect(after).toBeUndefined();
    expect(result.result.status).toBe('success');
  } else {
    expect(after).toEqual(expect.stringMatching(/restart|unavailable/));
    expect(result.result.status).toBe('failure');
  }
});

it('refuses disabled Plan before creating output storage', async () => {
  await install('agon.plan');
  await initializeProcessSurfaceAuthority(root);
  expect(() => buildStepExecutors(context())).toThrow('unavailable');
  expect(existsSync(join(root, 'execution-home', 'runs'))).toBe(false);
});

it.each(['generation', 'enabled-generation', 'host', 'disposal'] as const)('refuses a cached executor after its %s changes', async transition => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  if (transition === 'generation') await install('agon.plan');
  else if (transition === 'enabled-generation') await install('agon.review');
  else if (transition === 'disposal') await disposeProcessSurfaceAuthority();
  else { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
  await expect(executors.brainstorm.execute(step('brainstorm'), {})).rejects.toThrow(/restart|disposed|replaced/);
  expect(effects.brainstorm).not.toHaveBeenCalled();
});

it.each([
  ['forge', 'agon.forge'], ['teamforge', 'agon.team-forge'], ['brainstorm', 'agon.brainstorm'],
  ['tribunal', 'agon.tribunal'], ['campfire', 'agon.campfire'], ['delegate', 'agon.agent'],
  ['pipeline', 'agon.pipeline-delivery'], ['review', 'agon.review'],
  ['agent', 'agon.agent'], ['team-agent', 'agon.agent'],
])('refuses disabled %s using its executor owner, not the supplied type', async (type, owner) => {
  await install(owner);
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  await expect(executors[type].execute(step('self'), {})).rejects.toThrow('unavailable');
  expect(effects.brainstorm).not.toHaveBeenCalled();
  expect(effects.delegate).not.toHaveBeenCalled();
  expect(effects.other).not.toHaveBeenCalled();
});

it('does not delegate a self step through a disabled Agent owner', async () => {
  await install('agon.agent');
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).self.execute(step('self'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('unavailable') });
  expect(effects.delegate).not.toHaveBeenCalled();
});

it('preserves enabled brainstorming and self delegation', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  expect((await executors.brainstorm.execute(step('unknown-caller-type'), {})).result.status).toBe('success');
  expect((await executors.self.execute(step('self'), {})).result.status).toBe('success');
  expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.delegate).toHaveBeenCalledOnce();
});

it('accepts all enabled step keys and rejects an unknown key', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  for (const key of Object.keys(buildStepExecutors(context()))) {
    expect(() => assertProcessPlanStepAvailable(key), key).not.toThrow();
  }
  expect(() => assertProcessPlanStepAvailable('unknown-step')).toThrow('unavailable');
});

it('rejects a catalog collision across owners', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([
    entry, { ...entry, owner: { ...entry.owner, id: 'different.owner' } },
  ]);
  expect(() => assertProcessPlanStepAvailable('self')).toThrow('ambiguous owners');
});

it('accepts same-owner duplicate declarations and alias-only lookup', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  const aliasEntry = { ...entry, publicId: 'renamed-self', aliases: ['self'] };
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([aliasEntry, aliasEntry]);
  expect(() => assertProcessPlanStepAvailable('self')).not.toThrow();
});

it('rejects an alias collision across owners', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([
    entry, { ...entry, publicId: 'other-step', aliases: ['self'], owner: { ...entry.owner, id: 'different.owner' } },
  ]);
  expect(() => assertProcessPlanStepAvailable('self')).toThrow('ambiguous owners');
});

it.each(['brainstorm', 'forge', 'tribunal'])('refuses a disabled nested %s phase', async phase => {
  await install('agon.' + phase);
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('unavailable') });
  if (phase === 'brainstorm') expect(effects.brainstorm).not.toHaveBeenCalled();
  else expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.other).toHaveBeenCalledTimes(phase === 'tribunal' ? 1 : 0);
});

it.each(['brainstorm', 'forge', 'tribunal'])('refuses continuation after authority changes during %s', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const revoke = async () => {
    await install('agon.plan');
    return { winner: 'fixture', summary: 'review', response: 'answer' };
  };
  if (phase === 'brainstorm') effects.brainstorm.mockImplementationOnce(revoke);
  else if (phase === 'forge') effects.other.mockImplementationOnce(revoke);
  else effects.other.mockResolvedValueOnce({ winner: 'fixture', patches: { fixture: join(root, 'empty.patch') } }).mockImplementationOnce(revoke);
  const dispatch = vi.fn();
  const result = await buildStepExecutors(context(), dispatch).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('restart') });
  expect(effects.other).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : phase === 'forge' ? 1 : 2);
  expect(result.contextExport).toBeUndefined();
  const events = dispatch.mock.calls.map(([event]) => event);
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-completed', phaseId: phase }));
  const terminal = events.filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'failed' });
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-run-conformance-failed' }));
  const next = phase === 'brainstorm' ? 'forge' : phase === 'forge' ? 'tribunal' : null;
  if (next) expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-started', phaseId: next }));
});

it('preserves the enabled three-phase workflow', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result.status).toBe('success');
  expect(result.contextExport).toContain('Tribunal: review');
  expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.other).toHaveBeenCalledTimes(2);
});

it('does not start a cancelled step', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  controller.abort(new Error('cancel fixture'));
  await expect(buildStepExecutors(context()).brainstorm.execute(step('brainstorm'), {}, controller.signal)).rejects.toThrow('cancel fixture');
  expect(effects.brainstorm).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'])('stops after cancellation during %s', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  const cancel = async () => {
    controller.abort(new Error('cancel fixture'));
    return { winner: 'fixture', summary: 'review', response: 'answer' };
  };
  if (phase === 'brainstorm') effects.brainstorm.mockImplementationOnce(cancel);
  else if (phase === 'forge') effects.other.mockImplementationOnce(cancel);
  else effects.other.mockResolvedValueOnce({ winner: 'fixture', patches: { fixture: join(root, 'empty.patch') } }).mockImplementationOnce(cancel);
  const dispatch = vi.fn();
  const result = await buildStepExecutors(context(), dispatch).pipeline.execute(step('pipeline'), {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'cancel fixture' });
  expect(effects.other).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : phase === 'forge' ? 1 : 2);
  expect(result.contextExport).toBeUndefined();
  const events = dispatch.mock.calls.map(([event]) => event);
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-completed', phaseId: phase }));
  const terminal = events.filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'cancelled' });
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-run-conformance-failed' }));
  const next = phase === 'brainstorm' ? 'forge' : phase === 'forge' ? 'tribunal' : null;
  if (next) expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-started', phaseId: next }));
});

it('refuses a nested continuation after host replacement', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  effects.brainstorm.mockImplementationOnce(async () => {
    await disposeProcessSurfaceAuthority();
    await initializeProcessSurfaceAuthority(root);
    return { winner: 'fixture', response: 'stale answer' };
  });
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('disposed or replaced') });
  expect(effects.other).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'])('honors cancellation from the %s start event', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const dispatch = vi.fn(event => {
    if (event.type === 'workflow-phase-started' && event.phaseId === phase) controller.abort(new Error('event cancellation'));
  });
  const ctx = context();
  ctx.activeEngines = () => ['fixture'];
  const result = await buildStepExecutors(ctx, dispatch).pipeline.execute(step('pipeline'), {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'event cancellation' });
  expect(effects.brainstorm).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : 1);
  expect(effects.other).toHaveBeenCalledTimes(phase === 'tribunal' ? 1 : 0);
  for (const interval of intervals.mock.results) expect(clear).toHaveBeenCalledWith(interval.value);
  const terminal = dispatch.mock.calls.map(([event]) => event).filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'cancelled' });
});

it.each(['brainstorm', 'tribunal', 'campfire', 'delegate', 'self', 'forge', 'teamforge'])('blocks a late provider dispatch inside %s', async type => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 0, timedOut: false }));
  const ctx = context();
  ctx.adapter = { dispatch } as EngineAdapter;
  const run = async (...args: any[]) => {
    const adapter = type === 'forge' || type === 'teamforge' ? args[2] : args[0].adapter;
    await install('agon.plan');
    await adapter.dispatch({ signal: args[0].signal } as DispatchOptions);
    return { winner: 'fixture', response: 'answer', summary: 'review', rounds: [] };
  };
  if (type === 'brainstorm') effects.brainstorm.mockImplementationOnce(run);
  else if (type === 'delegate' || type === 'self') effects.delegate.mockImplementationOnce(run);
  else effects.other.mockImplementationOnce(run);
  const result = await buildStepExecutors(ctx)[type].execute(step(type), {});
  expect(dispatch).not.toHaveBeenCalled();
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('restart') });
  expect(ctx.adapter.dispatch).toBe(dispatch);
});

it.each(['dispatch', 'dispatchAgent', 'dispatchStream', 'dispatchAgentStream', 'isAvailable', 'getVersion'] as const)('preserves and guards adapter %s', async method => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const calls: { receiver: unknown; options: unknown }[] = [];
  const value = { exitCode: 0, stdout: 'fixture', stderr: '', durationMs: 1, timedOut: false, diff: '', diffLines: 0, filesChanged: 0 };
  const call = async function(this: unknown, options: unknown) { calls.push({ receiver: this, options }); return value; };
  const stream = async function*(this: unknown, options: unknown) { calls.push({ receiver: this, options }); yield 'chunk'; return value; };
  const adapter: EngineAdapter = { dispatch: call, dispatchAgent: call, dispatchStream: stream, dispatchAgentStream: stream,
    isAvailable: async function(options) { calls.push({ receiver: this, options }); return true; },
    getVersion: async function(options) { calls.push({ receiver: this, options }); return 'fixture-version'; } };
  const guarded = guardProcessEngineAdapter(adapter, () => assertProcessPlanStepAvailable('brainstorm'));
  const options = {} as DispatchOptions & EngineDefinition;
  const streaming = method === 'dispatchStream' || method === 'dispatchAgentStream';
  if (streaming) {
    const iterator = guarded[method]!(options);
    expect(await iterator.next()).toEqual({ done: false, value: 'chunk' });
    expect(await iterator.next()).toEqual({ done: true, value });
  } else {
    expect(await guarded[method]!(options)).toBe(method === 'isAvailable' ? true : method === 'getVersion' ? 'fixture-version' : value);
  }
  expect(calls).toEqual([{ receiver: adapter, options }]);
  const deferred = streaming ? guarded[method]!(options) : undefined;
  await install('agon.plan');
  if (deferred) await expect(deferred.next()).rejects.toThrow('restart');
  else await expect(guarded[method]!(options)).rejects.toThrow('restart');
  expect(calls).toHaveLength(1);
});

it('retains absent optional adapter methods and the bootstrap adapter identity', async () => {
  const adapter = { dispatch: vi.fn(), isAvailable: vi.fn(), getVersion: vi.fn() };
  expect(guardProcessEngineAdapter(adapter, () => {})).toBe(adapter);
  await install();
  await initializeProcessSurfaceAuthority(root);
  const guarded = guardProcessEngineAdapter(adapter, () => {});
  for (const key of ['dispatchAgent', 'dispatchStream', 'dispatchAgentStream']) expect(guarded).not.toHaveProperty(key);
});

it('cancels an outstanding cooperative backend after generation revocation', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let observedSignal: AbortSignal | undefined;
  effects.brainstorm.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    observedSignal = signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    entered();
  }));
  const parent = new AbortController();
  const pending = buildStepExecutors(context()).brainstorm.execute(step('brainstorm'), {}, parent.signal);
  await started;
  await install('agon.plan');
  const result = await pending;
  expect(observedSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('restart') });
});

it.each(['agent', 'team-agent'])('revokes the retained %s callback and cleans up its monitor', async type => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let observedSignal: AbortSignal | undefined;
  let refusal: (() => string | undefined) | undefined;
  const parent = new AbortController();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const add = vi.spyOn(parent.signal, 'addEventListener');
  const remove = vi.spyOn(parent.signal, 'removeEventListener');
  effects.other.mockImplementationOnce((_task, _dispatch, _ctx, options) => new Promise((_resolve, reject) => {
    observedSignal = options.parentSignal;
    refusal = options.executionRefusal;
    observedSignal!.addEventListener('abort', () => reject(observedSignal!.reason), { once: true });
    entered();
  }));
  const pending = buildStepExecutors(context())[type].execute(step(type), {}, parent.signal);
  await started;
  expect(refusal).toEqual(expect.any(Function));
  expect(refusal!()).toBeUndefined();
  await install('agon.agent');
  const result = await pending;
  expect(observedSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  expect(refusal!()).toMatch(/restart|unavailable/);
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringMatching(/restart|unavailable/) });
  expect(result).not.toHaveProperty('contextExport');
  expect(intervals).toHaveBeenCalledOnce();
  expect(clear).toHaveBeenCalledWith(intervals.mock.results[0].value);
  expect(add).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
});

it.each([false, true])('rejects a captured adapter after disposal (restart=%s)', async restart => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const adapter = { dispatch: vi.fn(), isAvailable: vi.fn(), getVersion: vi.fn() };
  const guarded = guardProcessEngineAdapter(adapter, () => {});
  await disposeProcessSurfaceAuthority();
  if (restart) await initializeProcessSurfaceAuthority(root);
  await expect(guarded.dispatch({} as DispatchOptions)).rejects.toThrow('disposed or replaced');
  expect(adapter.dispatch).not.toHaveBeenCalled();
});

it.each(['return', 'throw'] as const)('preserves stream cleanup on consumer %s', async exit => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const cleanup = vi.fn();
  const value = { exitCode: 0, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  const adapter: EngineAdapter = { dispatch: vi.fn(), isAvailable: vi.fn(), getVersion: vi.fn(),
    dispatchStream: async function*() { try { yield 'chunk'; return value; } finally { cleanup(); } } };
  const stream = guardProcessEngineAdapter(adapter, () => {}).dispatchStream!({} as DispatchOptions);
  expect(await stream.next()).toEqual({ done: false, value: 'chunk' });
  if (exit === 'return') expect(await stream.return(value)).toEqual({ done: true, value });
  else await expect(stream.throw(new Error('consumer stopped'))).rejects.toThrow('consumer stopped');
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each(['success', 'rejection', 'parent cancellation'])('removes monitor resources after %s', async outcome => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const parent = new AbortController();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const add = vi.spyOn(parent.signal, 'addEventListener');
  const remove = vi.spyOn(parent.signal, 'removeEventListener');
  const pending = withProcessSurfaceAuthority(parent.signal, () => {}, async signal => {
    if (outcome === 'rejection') throw new Error('backend rejected');
    if (outcome === 'parent cancellation') {
      parent.abort(new Error('parent cancelled'));
      signal!.throwIfAborted();
    }
    return 'done';
  });
  if (outcome === 'success') await expect(pending).resolves.toBe('done');
  else await expect(pending).rejects.toThrow(outcome === 'rejection' ? 'backend rejected' : 'parent cancelled');
  expect(intervals).toHaveBeenCalledOnce();
  expect(clear).toHaveBeenCalledWith(intervals.mock.results[0].value);
  expect(add).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
});

it.each(['brainstorm', 'forge', 'tribunal'])('blocks late provider dispatch inside nested %s', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const ctx = context();
  const dispatch = vi.fn();
  ctx.adapter = { dispatch } as EngineAdapter;
  const run = async (...args: any[]) => {
    const adapter = phase === 'forge' ? args[2] : args[0].adapter;
    await install('agon.plan');
    await adapter.dispatch({ signal: args[0].signal } as DispatchOptions);
    return { winner: 'fixture', response: 'answer', summary: 'review' };
  };
  if (phase === 'brainstorm') effects.brainstorm.mockImplementationOnce(run);
  else if (phase === 'forge') effects.other.mockImplementationOnce(run);
  else effects.other.mockResolvedValueOnce({ winner: 'fixture', patches: { fixture: join(root, 'empty.patch') } }).mockImplementationOnce(run);
  const result = await buildStepExecutors(ctx).pipeline.execute(step('pipeline'), {});
  expect(dispatch).not.toHaveBeenCalled();
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('restart') });
});

it.each(['brainstorm', 'tribunal', 'campfire', 'delegate'].flatMap(type =>
  ['generation', 'replacement', 'cancellation'].map(fault => ({ type, fault }))))('does not publish stale panel output: $type / $fault', async ({ type, fault }) => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  // Keep the monitor pending so only the post-return check can refuse output.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const stats = tracker.getStats();
  vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ ...stats, totalTokens: 10, meteredCostUsd: 1 })
    .mockReturnValue({ ...stats, totalTokens: 17, meteredCostUsd: 1.25 });
  const controller = new AbortController();
  const run = async () => {
    if (fault === 'generation') await install('agon.plan');
    else if (fault === 'replacement') { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
    else controller.abort(new Error('cancelled fixture'));
    return { winner: 'fixture', response: 'stale output', summary: 'stale output', rounds: [{ engineId: 'fixture', content: 'stale output' }] };
  };
  if (type === 'brainstorm') effects.brainstorm.mockImplementationOnce(run);
  else if (type === 'delegate') effects.delegate.mockImplementationOnce(run);
  else effects.other.mockImplementationOnce(run);
  const output = await buildStepExecutors(context())[type].execute(step(type), {}, controller.signal);
  expect(output.result).toMatchObject({ status: 'failure', output: '', actualTokens: 7, actualCostUsd: 0.25 });
  expect(output.result.error).toMatch(fault === 'generation' ? /restart/ : fault === 'replacement' ? /disposed or replaced/ : /cancelled fixture/);
  expect(output).not.toHaveProperty('contextExport');
});

it.each(['brainstorm', 'tribunal', 'campfire', 'delegate'])('preserves healthy %s output formatting', async type => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const text = 'x'.repeat(650);
  const value = { winner: 'fixture', response: text, summary: text, rounds: [{ engineId: 'speaker', content: text }] };
  if (type === 'brainstorm') effects.brainstorm.mockResolvedValueOnce(value);
  else if (type === 'delegate') effects.delegate.mockResolvedValueOnce(value);
  else effects.other.mockResolvedValueOnce(value);
  const output = await buildStepExecutors(context())[type].execute(step(type), {});
  expect(output.result.status).toBe('success');
  expect(output.result.output).toBe(type === 'brainstorm' ? `Winner: fixture\n${text}` : type === 'campfire' ? `speaker: ${text.slice(0, 200)}` : text);
  expect(output.contextExport).toBe(type === 'delegate' ? text.slice(0, 500) : type === 'campfire' ? `speaker: ${text.slice(0, 200)}` : text);
});

it.each(['forge', 'teamforge'].flatMap(type =>
  ['generation', 'replacement', 'cancellation'].flatMap(fault =>
    ['winner', 'already-satisfied'].map(result => ({ type, fault, result })))))('refuses stale Forge results before patch access: $type / $fault / $result', async ({ type, fault, result }) => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const stats = tracker.getStats();
  vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ ...stats, totalTokens: 10, meteredCostUsd: 1 })
    .mockReturnValue({ ...stats, totalTokens: 17, meteredCostUsd: 1.25 });
  const controller = new AbortController();
  const patchAccess = vi.fn(() => ({}));
  effects.other.mockImplementationOnce(async () => {
    if (fault === 'generation') await install('agon.plan');
    else if (fault === 'replacement') { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
    else controller.abort(new Error('cancelled fixture'));
    return { winner: result === 'winner' ? 'fixture' : null,
      alreadySatisfied: result === 'already-satisfied', results: {}, get patches() { return patchAccess(); } };
  });
  const output = await buildStepExecutors(context())[type].execute(step(type), {}, controller.signal);
  expect(patchAccess).not.toHaveBeenCalled();
  expect(output.result).toMatchObject({ status: 'failure', output: '', actualTokens: 7, actualCostUsd: 0.25 });
  expect(output.result.error).toMatch(fault === 'generation' ? /restart/ : fault === 'replacement' ? /disposed or replaced/ : /cancelled fixture/);
  expect(output).not.toHaveProperty('contextExport');
});

it.each(['forge', 'teamforge'].flatMap(type =>
  ['healthy', 'generation', 'cancellation'].map(fault => ({ type, fault }))))('applies a real patch only with current authority: $type / $fault', async ({ type, fault }) => {
  const workspace = await mkdtemp(join(root, 'patch-workspace-'));
  execFileSync('git', ['init', '-q', workspace]);
  await writeFile(join(workspace, 'result.txt'), 'before\n');
  const patch = join(root, 'winner.patch');
  await writeFile(patch, 'diff --git a/result.txt b/result.txt\n--- a/result.txt\n+++ b/result.txt\n@@ -1 +1 @@\n-before\n+after\n');
  setSessionRoot(workspace);
  await install();
  await initializeProcessSurfaceAuthority(root);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const controller = new AbortController();
  effects.other.mockImplementationOnce(async () => {
    if (fault === 'generation') await install('agon.plan');
    if (fault === 'cancellation') controller.abort(new Error('cancelled fixture'));
    return { winner: 'fixture', patches: { fixture: patch } };
  });
  const output = await buildStepExecutors(context())[type].execute(step(type), {}, controller.signal);
  expect(output.result.status).toBe(fault === 'healthy' ? 'success' : 'failure');
  expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe(fault === 'healthy' ? 'after\n' : 'before\n');
});

it.each(['self', 'review', 'agent', 'team-agent'].flatMap(type =>
  ['healthy', 'generation', 'replacement', 'cancellation'].map(fault => ({ type, fault }))))('publishes step output only with current authority: $type / $fault', async ({ type, fault }) => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const stats = tracker.getStats();
  vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ ...stats, totalTokens: 10, meteredCostUsd: 1 })
    .mockReturnValue({ ...stats, totalTokens: 17, meteredCostUsd: 1.25 });
  const controller = new AbortController();
  const run = vi.fn(async () => {
    if (fault === 'generation') await install('agon.plan');
    else if (fault === 'replacement') { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
    else if (fault === 'cancellation') controller.abort(new Error('cancelled fixture'));
    return { response: 'fixture output', blocking: false, parseFailed: false,
      ...(['agent', 'team-agent'].includes(type) ? { status: 'completed' } : {}) };
  });
  if (type === 'self') effects.delegate.mockImplementationOnce(run);
  else effects.other.mockImplementationOnce(run);
  const verificationMarker = join(root, 'verified');
  const selectedStep = { ...step(type), ...(type === 'self' ? { verifyCmd: `touch '${verificationMarker}'` } : {}) };
  const output = await buildStepExecutors(context())[type].execute(selectedStep, {}, controller.signal);
  expect(run).toHaveBeenCalledOnce();
  if (type === 'self') expect(existsSync(verificationMarker)).toBe(fault === 'healthy');
  expect(output.result).toMatchObject({ status: fault === 'healthy' ? 'success' : 'failure', actualTokens: 7, actualCostUsd: 0.25 });
  if (fault === 'healthy') expect(output).toHaveProperty('contextExport');
  else {
    expect(output).not.toHaveProperty('contextExport');
    expect(output.result.error).toMatch(fault === 'generation' ? /restart/ : fault === 'replacement' ? /disposed or replaced/ : /cancelled fixture/);
  }
});

it.each(['generation', 'replacement', 'cancellation'])('rejects self completion after authority changes during verification: %s', async fault => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const stats = tracker.getStats();
  vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ ...stats, totalTokens: 10, meteredCostUsd: 1 })
    .mockReturnValue({ ...stats, totalTokens: 17, meteredCostUsd: 1.25 });
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  effects.verify.mockImplementationOnce(async () => {
    entered();
    await finish;
    return { exitCode: 0, timedOut: false, stdout: 'verified', stderr: '' };
  });
  const controller = new AbortController();
  const pending = buildStepExecutors(context()).self.execute({ ...step('self'), verifyCmd: 'fixture command' }, {}, controller.signal);
  await started;
  try {
    if (fault === 'generation') await install('agon.plan');
    else if (fault === 'replacement') { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
    else controller.abort(new Error('cancelled fixture'));
  } finally { release(); }
  const output = await pending;
  expect(effects.verify).toHaveBeenCalledOnce();
  expect(output.result).toMatchObject({ status: 'failure', actualTokens: 7, actualCostUsd: 0.25 });
  expect(output).not.toHaveProperty('contextExport');
  expect(output.result.error).toMatch(fault === 'generation' ? /restart/ : fault === 'replacement' ? /disposed or replaced/ : /cancelled fixture/);
});
