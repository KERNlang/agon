import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { createCesarPlan } from '@kernlang/agon-mod-plan';
import { createPlan } from '@kernlang/agon-support-worktree';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ save: vi.fn(), execute: vi.fn(), executors: vi.fn(() => ({})),
  legacySave: vi.fn(), forge: vi.fn(async () => null) }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), saveCesarPlan: effects.save, executePlan: effects.execute,
  savePlan: effects.legacySave,
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: effects.executors }));
vi.mock('../../packages/cli/src/handlers/forge.js', () => ({ handleForge: effects.forge }));
import { executeApprovedPlan, resumeCesarPlan, handleProposedCesarPlan, approvePendingCesarPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';
import { dispatchSessionInfoIntent } from '../../packages/cli/src/signals/dispatch/intent-session.js';

const NOW = '2026-10-09T00:00:00.000Z';
let root: string;
let host: DurableModHost;
beforeEach(async () => {
  vi.clearAllMocks();
  effects.execute.mockImplementation(async plan => ({ ...plan, state: 'done' }));
  root = await mkdtemp(join(tmpdir(), 'agon-plan-entry-'));
  host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'entry-test' });
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
  } else expect(cb.setActivePlan).not.toHaveBeenCalled();
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
