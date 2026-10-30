import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { approveCesarPlan, createCesarPlan } from '@kernlang/agon-mod-plan';
import { createPlan } from '@kernlang/agon-support-worktree';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ save: vi.fn(), execute: vi.fn(), executors: vi.fn(() => ({})),
  legacySave: vi.fn(), forge: vi.fn(async () => null) }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), saveCesarPlan: effects.save,
  savePlan: effects.legacySave,
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: effects.executors }));
vi.mock('../../packages/cli/src/handlers/forge.js', () => ({ handleForge: effects.forge }));
import { executeApprovedPlan, resumeCesarPlan, handleProposedCesarPlan, approvePendingCesarPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';
import { dispatchSessionInfoIntent, runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { createPlanExecutionSession } from '../../packages/cli/src/blocks/plan-execution-effects.js';
import { createTaskExecutionLease } from '../../packages/cli/src/cesar/task-execution-lease.js';
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import { planSessionHost } from '@kernlang/agon-mod-plan';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';

const NOW = '2026-10-09T00:00:00.000Z';
const realPlanRuntime = authority.processPlanRuntime;
let root: string;
let host: DurableModHost;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(authority, 'processPlanRuntime').mockImplementation(() => ({
    ...realPlanRuntime(), executePlan: effects.execute,
  }));
  effects.execute.mockImplementation(async plan => ({ ...plan, state: 'done' }));
  root = await mkdtemp(join(tmpdir(), 'agon-plan-entry-'));
  host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'entry-test' });
});
afterEach(async () => {
  await disposeProcessSurfaceAuthority();
  vi.restoreAllMocks();
  const generations = await readdir(join(root, 'generations')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const generation of generations) await chmod(join(root, 'generations', generation), 0o755);
  await rm(root, { recursive: true, force: true });
});
async function install(disabled: boolean, id = 'agon.plan') {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, NOW);
  const desired = disabled ? planDesiredStateChange(catalog, full, { kind: 'disable', id }, NOW).nextState : full;
  await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
}
function callbacks(dispatch = vi.fn()): DispatchCallbacks {
  return { dispatch, setActivePlan: vi.fn(), ctx: { config: {}, cesar: {}, setActiveAbort: vi.fn() } } as unknown as DispatchCallbacks;
}
function proposal() {
  return { ...createCesarPlan('fixture', []), state: 'awaiting_approval' as const, selfReview: false, autoApprove: true };
}

it('binds Plan history to the selected generation and rejects stale captured execution', async () => {
  expect(() => realPlanRuntime()).toThrow(/not active/);
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const runtime = realPlanRuntime();
  expect(realPlanRuntime()).toBe(runtime);
  runtime.estimator.recordStepCompletion('self', 8, 0.2);
  runtime.estimator.recordStepCompletion('self', 12, 0.4);
  expect(realPlanRuntime().sanitizePlanSteps([{ type: 'self' }]).steps[0].estimatedTokens).toBe(10);
  await install(false);
  expect(() => realPlanRuntime()).toThrow(/generation changed/);
  const empty = { ...approveCesarPlan(createCesarPlan('stale handle', [])), selfReview: false };
  const callbacks = { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() };
  await expect(runtime.executePlan(empty, {}, callbacks)).rejects.toThrow(/generation changed/);
  await disposeProcessSurfaceAuthority();
  await initializeProcessSurfaceAuthority(root);
  const replacement = realPlanRuntime();
  expect(replacement).not.toBe(runtime);
  expect(replacement.estimator.estimate('self', []).tokens).toBe(2000);
  await expect(runtime.executePlan(empty, {}, callbacks)).rejects.toThrow(/disposed/);
});

it('does not expose Plan runtime when Plan is disabled', async () => {
  await install(true);
  await initializeProcessSurfaceAuthority(root);
  expect(() => realPlanRuntime()).toThrow();
});

it('binds Plan with an injected service decorator, without selecting it during decoration', async () => {
  await install(false);
  const decorated: string[] = [];
  await initializeProcessSurfaceAuthority(root, (manifest, services) => {
    decorated.push(manifest.id);
    expect(() => realPlanRuntime()).toThrow(expect.objectContaining({ code: 'MOD_SURFACE_UNAVAILABLE' }));
    return services;
  });
  expect(decorated).toContain('agon.plan');
  expect(realPlanRuntime().estimator.estimate('self', []).tokens).toBe(2000);
});

it('keeps Plan unavailable in kernel safe mode without loading host effects', async () => {
  const decorate = vi.fn((_manifest, services) => services);
  vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
  try {
    await initializeProcessSurfaceAuthority(root, decorate);
    expect(decorate).not.toHaveBeenCalled();
    expect(() => realPlanRuntime()).toThrow();
  } finally { vi.unstubAllEnvs(); }
});

async function physicalResume(cb: DispatchCallbacks) {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (value: unknown) => {
    if (method === 'intent') intents.push(value as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod({ planSession: planSessionHost } as ModServices)).activate(registrar);
  const command = '/plan resume';
  const contribution = intents.find(entry => entry.parse(command) !== undefined)!;
  await runPhysicalTuiContribution({ payload: contribution }, contribution.parse(command)!, command, cb, new AbortController().signal);
}

it('reads replacement proposal state when an existing execution session is invoked', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const cb = callbacks();
  const previous = proposal();
  const replacement = proposal();
  cb.ctx.cesar!.proposedPlan = previous;
  const session = createPlanExecutionSession(cb);
  cb.ctx.cesar!.proposedPlan = replacement;
  expect(await session.approvePending()).toBe(true);
  expect(effects.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: replacement.id }),
    expect.anything(), expect.anything(), expect.any(AbortSignal));
  expect(previous.state).toBe('awaiting_approval');
});

it.each(['approvePending', 'cancelPending'] as const)('propagates live selection failures through real %s composition', async method => {
  const cb = callbacks();
  const session = createPlanExecutionSession(cb);
  const failure = new Error('session read failed');
  Object.defineProperty(cb.ctx, 'cesar', { get() { throw failure; } });
  await expect(Promise.resolve().then(() => session[method]())).rejects.toBe(failure);
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
});

it('reads current approval config, AUTO mode and lease on every proposal', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const cb = callbacks();
  cb.ctx.config = { ...cb.ctx.config, cesarAutoApproveMode: 'off' };
  const session = createPlanExecutionSession(cb);
  cb.ctx.config = { ...cb.ctx.config, cesarAutoApproveMode: 'always' };
  cb.ctx.autoModeQueued = true;
  const plan = { ...proposal(), steps: [{ id: 's', type: 'self' as const, description: 'build parser',
    estimatedTokens: 0, estimatedCostUsd: 0, state: 'pending' as const }] };
  await session.propose(plan);
  expect(effects.execute).not.toHaveBeenCalled();
  cb.ctx.cesar!.taskExecutionLease = createTaskExecutionLease('build parser', true, root, undefined, 'agentic');
  await session.propose(plan);
  expect(effects.execute).toHaveBeenCalledOnce();
  cb.ctx.cesar!.taskExecutionLease = undefined;
  await session.propose(plan);
  expect(effects.execute).toHaveBeenCalledOnce();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('task lease unavailable') }));
});

it.each(['1', '2'])('blocks physical resume choice %s after generation changes during its prompt', async choice => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  let answer!: (value: string) => void;
  let prompted!: () => void;
  const prompt = new Promise<void>(resolve => { prompted = resolve; });
  const cb = callbacks(vi.fn(event => {
    if (event.type === 'question') { answer = event.resolve; prompted(); }
  }));
  cb.ctx.activePlan = { ...proposal(), state: 'paused' };
  const pending = physicalResume(cb);
  await prompt;
  await install(true);
  answer(choice);
  await pending;
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('restart Agon') }));
});

it.each((['approve', 'retry', 'plan'] as const).flatMap(type => [true, false].map(disabled => ({ type, disabled }))))('checks Forge through worktree Plan $type (disabled=$disabled)', async ({ type, disabled }) => {
  await install(disabled, 'agon.forge');
  await initializeProcessSurfaceAuthority(root);
  const plan = createPlan({ type: 'forge', task: 'fixture' },
    { id: 'fixture', path: root, headSha: 'abc', branch: 'fixture', dirty: false },
    [{ id: 'build', kind: 'dispatch', label: 'Build', effects: ['write'] }]);
  if (type === 'retry') {
    plan.state = 'paused';
    plan.steps[0].result.state = 'failed';
  }
  const cb = callbacks();
  cb.ctx.currentPlan = plan;
  cb.ctx.setCurrentPlan = next => { cb.ctx.currentPlan = next; };
  cb.ctx.askQuestion = async () => 'yes';
  await dispatchSessionInfoIntent({ type }, `/${type}`, cb);
  if (!disabled) {
    expect(effects.forge).toHaveBeenCalledOnce();
    expect(effects.legacySave).toHaveBeenCalledTimes(type === 'retry' ? 2 : 1);
    expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    return;
  }
  expect(effects.forge).not.toHaveBeenCalled();
  expect(effects.legacySave).not.toHaveBeenCalled();
  expect(cb.ctx.currentPlan).toBe(plan);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
});

it('permits cancelling a worktree plan even when its Forge action is disabled', async () => {
  await install(true, 'agon.forge');
  await initializeProcessSurfaceAuthority(root);
  const plan = createPlan({ type: 'forge', task: 'fixture' },
    { id: 'fixture', path: root, headSha: 'abc', branch: 'fixture', dirty: false }, []);
  const cb = callbacks();
  cb.ctx.currentPlan = plan;
  cb.ctx.setCurrentPlan = next => { cb.ctx.currentPlan = next; };
  await dispatchSessionInfoIntent({ type: 'cancel' }, '/cancel', cb);
  expect(effects.forge).not.toHaveBeenCalled();
  expect(effects.legacySave).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
});

it('does not enter Forge after host disposal during the execution handoff', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const plan = createPlan({ type: 'forge', task: 'fixture' },
    { id: 'fixture', path: root, headSha: 'abc', branch: 'fixture', dirty: false }, []);
  let disposal: Promise<void> | undefined;
  const cb = callbacks(vi.fn(event => {
    if (event.type === 'success') disposal = disposeProcessSurfaceAuthority();
  }));
  cb.ctx.currentPlan = plan;
  cb.ctx.setCurrentPlan = next => { cb.ctx.currentPlan = next; };
  try {
    await dispatchSessionInfoIntent({ type: 'approve' }, '/approve', cb);
    expect(effects.forge).not.toHaveBeenCalled();
    expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('replaced') }));
  } finally {
    await disposal;
  }
});

it.each(['disable', 'replace'] as const)('refuses worktree draft approval after host %s while asking', async change => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const plan = createPlan({ type: 'build', task: 'fixture' },
    { id: 'fixture', path: root, headSha: 'abc', branch: 'fixture', dirty: false }, []);
  const cb = callbacks();
  cb.ctx.currentPlan = plan;
  cb.ctx.setCurrentPlan = next => { cb.ctx.currentPlan = next; };
  cb.ctx.askQuestion = async () => {
    if (change === 'disable') await install(true);
    else {
      await disposeProcessSurfaceAuthority();
      await initializeProcessSurfaceAuthority(root);
    }
    return 'yes';
  };
  await dispatchSessionInfoIntent({ type: 'plan' }, '/plan', cb);
  expect(effects.legacySave).not.toHaveBeenCalled();
  expect(effects.forge).not.toHaveBeenCalled();
  expect(cb.ctx.currentPlan).toBe(plan);
  expect(plan.state).toBe('draft');
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringMatching(/restart|replaced/) }));
});

it.each(['direct', 'approve', 'automatic', 'resume'] as const)('blocks disabled Plan at the %s entry', async route => {
  await install(true);
  await initializeProcessSurfaceAuthority(root);
  const cb = callbacks(vi.fn(event => { if (event.type === 'question') event.resolve('1'); }));
  const value = proposal();
  cb.ctx.cesar!.proposedPlan = value;
  if (route === 'direct') await executeApprovedPlan(value, cb);
  if (route === 'approve') expect(await approvePendingCesarPlan(cb)).toBe(true);
  if (route === 'automatic') await handleProposedCesarPlan(value, cb);
  if (route === 'resume') await resumeCesarPlan({ ...value, state: 'paused' }, cb);
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  expect(effects.executors).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'question' }));
  if (route === 'automatic') {
    expect(cb.setActivePlan).toHaveBeenCalledExactlyOnceWith(value);
    expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Plan auto-approved') }));
    expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('awaiting approval') }));
  } else {
    expect(cb.setActivePlan).not.toHaveBeenCalled();
    expect(cb.ctx.cesar!.proposedPlan).toBe(value);
  }
  expect(value.state).toBe('awaiting_approval');
});

it.each(['1', '2'])('blocks resume choice %s after the generation changes while asking', async choice => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  let answer: ((value: string) => void) | undefined;
  const cb = callbacks(vi.fn(event => { if (event.type === 'question') answer = event.resolve; }));
  const pending = resumeCesarPlan({ ...proposal(), state: 'paused' }, cb);
  expect(answer).toBeTypeOf('function');
  await install(true);
  answer!(choice);
  await pending;
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  expect(effects.executors).not.toHaveBeenCalled();
  expect(cb.setActivePlan).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('restart Agon') }));
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^(Resuming plan:|Restarting plan from step 1:)/) }));
});

it.each(['direct', 'approve', 'automatic', 'resume'] as const)('preserves the enabled %s entry', async route => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const cb = callbacks(vi.fn(event => { if (event.type === 'question') event.resolve('1'); }));
  const value = proposal();
  cb.ctx.cesar!.proposedPlan = value;
  if (route === 'direct') await executeApprovedPlan(value, cb);
  if (route === 'approve') expect(await approvePendingCesarPlan(cb)).toBe(true);
  if (route === 'automatic') await handleProposedCesarPlan(value, cb);
  if (route === 'resume') await resumeCesarPlan({ ...value, state: 'paused' }, cb);
  expect(effects.execute).toHaveBeenCalledOnce();
  expect(effects.executors).toHaveBeenCalledOnce();
  expect(effects.save).toHaveBeenCalled();
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});

it('does not carry a pending resume approval across host disposal and reinitialization', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  let answer: ((value: string) => void) | undefined;
  const cb = callbacks(vi.fn(event => { if (event.type === 'question') answer = event.resolve; }));
  const pending = resumeCesarPlan({ ...proposal(), state: 'paused' }, cb);
  expect(answer).toBeTypeOf('function');
  await disposeProcessSurfaceAuthority();
  await initializeProcessSurfaceAuthority(root);
  answer!('1');
  await pending;
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  expect(effects.executors).not.toHaveBeenCalled();
  expect(cb.setActivePlan).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('replaced') }));
});

it('refuses a fresh execution entry after host disposal', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  await disposeProcessSurfaceAuthority();
  const cb = callbacks();
  expect(await executeApprovedPlan({ ...proposal(), state: 'running' }, cb)).toBeUndefined();
  expect(effects.save).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  expect(effects.executors).not.toHaveBeenCalled();
});

it('retains a refused automatic proposal for subsequent manual approval', async () => {
  await install(true);
  await initializeProcessSurfaceAuthority(root);
  const cb = callbacks();
  cb.setActivePlan = vi.fn(value => { cb.ctx.activePlan = value; });
  const value = proposal();
  cb.ctx.cesar!.proposedPlan = value;
  await handleProposedCesarPlan(value, cb);
  expect(cb.ctx.cesar!.proposedPlan).toBeUndefined();
  expect(cb.ctx.activePlan).toBe(value);
  expect(await approvePendingCesarPlan(cb)).toBe(true);
  expect(cb.ctx.activePlan).toBe(value);
  expect(effects.execute).not.toHaveBeenCalled();
  await disposeProcessSurfaceAuthority();
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  expect(await approvePendingCesarPlan(cb)).toBe(true);
  expect(effects.execute).toHaveBeenCalledOnce();
});

it.each(['direct', 'automatic'] as const)('does not confuse accepted %s execution failure with authority refusal', async route => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  effects.execute.mockRejectedValue(new Error('executor failed'));
  const cb = callbacks();
  const value = proposal();
  if (route === 'direct') expect(await executeApprovedPlan({ ...value, state: 'running' }, cb)).toBeUndefined();
  else await handleProposedCesarPlan(value, cb);
  expect(effects.execute).toHaveBeenCalledOnce();
  expect(cb.setActivePlan).not.toHaveBeenCalledWith(value);
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Plan awaiting approval.') }));
});

it('reports a capture-time authority failure without rejecting the resume handler', async () => {
  await install(false);
  await initializeProcessSurfaceAuthority(root);
  const capture = vi.spyOn(authority, 'captureProcessSurfaceAuthority').mockImplementation(() => { throw new Error('capture generation changed'); });
  const cb = callbacks();
  try {
    await expect(resumeCesarPlan({ ...proposal(), state: 'paused' }, cb)).resolves.toBeUndefined();
    expect(cb.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: 'capture generation changed' });
    expect(effects.save).not.toHaveBeenCalled();
    expect(effects.execute).not.toHaveBeenCalled();
  } finally { capture.mockRestore(); }
});
