import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CesarPlan } from '@kernlang/agon-mod-plan';

const effects = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn(), changed: vi.fn(), choice: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), executePlan: effects.execute,
  resolveWorkingDir: () => '/fixture',
}));
vi.mock('@kernlang/agon-mod-plan', async original => ({
  ...await original<Record<string, unknown>>(), saveCesarPlan: effects.save,
}));
vi.mock('@kernlang/agon-support-worktree', async original => ({
  ...await original<Record<string, unknown>>(), inspectWorkingTree: () => ({ ok: true, dirtyTree: (effects.changed() ?? []).length > 0 }),
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
vi.mock('../../packages/cli/src/signals/dispatch/plan-queries.js', async original => ({
  ...await original<Record<string, unknown>>(), askChoiceQuestion: effects.choice,
}));
import { executeApprovedPlan, approvePendingCesarPlan, resumeCesarPlan, handleProposedCesarPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';

beforeEach(() => { vi.resetAllMocks(); effects.choice.mockResolvedValue('1'); });
const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function plan(type: 'self' | 'forge'): CesarPlan {
  return { id: 'fixture', intent: 'intent', state: 'running',
    steps: [{ id: 's1', type, description: 'step', state: 'pending', estimatedTokens: 1, estimatedCostUsd: 1 }],
    stepContext: {}, createdAt: '2026-01-01T00:00:00Z', totalEstimatedTokens: 1,
    totalEstimatedCostUsd: 1, totalActualTokens: 0, totalActualCostUsd: 0 };
}

it('does not publish or execute approval when required storage fails', async () => {
  const pending = { ...plan('self'), state: 'awaiting_approval' as const };
  effects.save.mockImplementation(() => { throw new Error('disk full'); });
  const dispatch = vi.fn();
  const active = vi.fn();
  const cesar = { proposedPlan: pending };
  await expect(approvePendingCesarPlan({ dispatch, setActivePlan: active,
    ctx: { config: {}, cesar, setActiveAbort: vi.fn() } } as any)).resolves.toBe(true);
  expect(cesar.proposedPlan).toBe(pending);
  expect(effects.execute).not.toHaveBeenCalled();
  expect(active).not.toHaveBeenCalled();
  expect(dispatch.mock.calls.some(([event]) => event.type === 'success')).toBe(false);
});

it('does not create a paused recovery record after a transient initial refusal', async () => {
  const pending = { ...plan('self'), state: 'awaiting_approval' as const };
  effects.save.mockImplementationOnce(() => { throw new Error('EBUSY'); });
  const cesar = { proposedPlan: pending };
  const active = vi.fn();
  await approvePendingCesarPlan({ dispatch: vi.fn(), setActivePlan: active,
    ctx: { config: {}, cesar, setActiveAbort: vi.fn() } } as any);
  expect(effects.save).toHaveBeenCalledTimes(1);
  expect(effects.execute).not.toHaveBeenCalled();
  expect(active).not.toHaveBeenCalled();
  expect(cesar.proposedPlan).toBe(pending);
});

it.each(['resume', 'auto'] as const)('keeps %s entry fail-closed on storage failure', async entry => {
  const pending = { ...plan('self'), state: 'awaiting_approval' as const, autoApprove: true, selfReview: false };
  effects.save.mockImplementation(() => { throw new Error('disk full'); });
  const cb = { dispatch: vi.fn(), setActivePlan: vi.fn(), ctx: { config: { cesarAutoApproveMode: 'always' },
    cesar: { proposedPlan: pending }, setActiveAbort: vi.fn() } };
  if (entry === 'resume') await resumeCesarPlan({ ...pending, state: 'paused' }, cb as any);
  else await handleProposedCesarPlan(pending, cb as any);
  expect(effects.execute).not.toHaveBeenCalled();
  expect(cb.setActivePlan).not.toHaveBeenCalled();
  expect(cb.ctx.cesar.proposedPlan).toBe(pending);
  expect(cb.dispatch.mock.calls.some(([event]) => event.type === 'success')).toBe(false);
});

it.each(['manual', 'resume', 'auto'] as const)('persists %s approval once before execution', async entry => {
  const pending = { ...plan('self'), state: 'awaiting_approval' as const, autoApprove: true, selfReview: false };
  let initialSaveCount = 0;
  let initialState: unknown;
  effects.execute.mockImplementationOnce(async value => {
    initialSaveCount = effects.save.mock.calls.length;
    initialState = effects.save.mock.calls[0]?.[0].state;
    return { ...value, state: 'done' };
  });
  const cb = { dispatch: vi.fn(), setActivePlan: vi.fn(), ctx: { config: { cesarAutoApproveMode: 'always' },
    cesar: { proposedPlan: pending }, setActiveAbort: vi.fn() } };
  if (entry === 'manual') await approvePendingCesarPlan(cb as any);
  else if (entry === 'resume') await resumeCesarPlan({ ...pending, state: 'paused' }, cb as any);
  else await handleProposedCesarPlan(pending, cb as any);
  expect(effects.execute).toHaveBeenCalledOnce();
  expect(initialSaveCount).toBe(1);
  expect(initialState).toBe('running');
  expect(cb.ctx.cesar.proposedPlan).toBeUndefined();
  expect(effects.save.mock.calls.at(-1)![0].state).toBe('done');
});

it.each(['review', 'forge pause', 'review exception'])('retains the final persisted %s state after all callback drains', async scenario => {
  vi.useFakeTimers();
  effects.changed.mockReturnValue(scenario === 'forge pause' ? [] : ['file.txt']);
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    const done = { ...value, state: 'done', steps: value.steps.map((step: object) => ({ ...step, state: 'done' })) };
    callbacks.onPlanUpdate(done);
    return done;
  }).mockImplementationOnce(async (value, _executors, callbacks) => {
    // Exercise the real debounced writer, not a flush spy with no state.
    callbacks.onPlanUpdate(value);
    if (scenario === 'review exception') throw new Error('review crashed');
    const reviewed = { ...value, state: 'done', steps: value.steps.map((step: object) => ({ ...step, state: 'done',
      result: { status: 'success', output: 'verified', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } })) };
    callbacks.onPlanUpdate(reviewed);
    return reviewed;
  });
  const active = vi.fn();
  const root = mkdtempSync(join(tmpdir(), 'plan-phase-receipt-'));
  roots.push(root);
  const value = { ...plan(scenario === 'forge pause' ? 'forge' : 'self'), planFilePath: join(root, 'plan.md') };
  await executeApprovedPlan(value, {
    dispatch: vi.fn(), setActivePlan: active, ctx: { config: {}, setActiveAbort: vi.fn() },
  } as any);
  const last = effects.save.mock.calls.at(-1)![0];
  expect(last.state).toBe(scenario === 'review' ? 'done' : 'paused');
  expect(last.reviewCyclesUsed).toBe(scenario === 'forge pause' ? undefined : 1);
  expect(last.steps).toHaveLength(scenario === 'forge pause' ? 1 : 2);
  expect(last).toEqual(active.mock.calls.at(-1)![0]);
  expect(readFileSync(value.planFilePath, 'utf8')).toContain(`- Status: ${last.state}`);
  const savedCount = effects.save.mock.calls.length;
  await vi.runAllTimersAsync();
  expect(effects.save).toHaveBeenCalledTimes(savedCount);
});

it('does not consume a different proposal when an approved plan becomes durable', async () => {
  const other = { ...plan('self'), id: 'other', state: 'awaiting_approval' as const };
  const cesar = { proposedPlan: other };
  effects.execute.mockImplementationOnce(async value => ({ ...value, state: 'done' }));
  await executeApprovedPlan({ ...plan('self'), selfReview: false }, {
    dispatch: vi.fn(), setActivePlan: vi.fn(), ctx: { config: {}, cesar, setActiveAbort: vi.fn() },
  } as any);
  expect(effects.execute).toHaveBeenCalledOnce();
  expect(effects.save.mock.calls[0][0].state).toBe('running');
  expect(cesar.proposedPlan).toBe(other);
});

it('clears its abort controller when callback construction throws', async () => {
  const setActiveAbort = vi.fn();
  const dispatch = vi.fn(event => { if (event.type === 'todos-set') throw new Error('UI failed'); });
  await expect(executeApprovedPlan(plan('self'), { dispatch, setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort } } as any)).resolves.toBeUndefined();
  expect(setActiveAbort.mock.calls.at(-1)![0]).toBeNull();
  expect(setActiveAbort.mock.calls.at(-1)![1]).toBe(setActiveAbort.mock.calls[0][0]);
  expect(effects.execute).not.toHaveBeenCalled();
});

it('drains a non-terminal callback before persisting an unreported terminal return', async () => {
  vi.useFakeTimers();
  effects.changed.mockReturnValue([]);
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    callbacks.onPlanUpdate({ ...value, totalActualCostUsd: 5 });
    return { ...value, state: 'done', totalActualCostUsd: 6 };
  });
  await executeApprovedPlan(plan('self'), { dispatch: vi.fn(), setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: vi.fn() } } as any);
  const saves = effects.save.mock.calls.length;
  await vi.runAllTimersAsync();
  expect(effects.save).toHaveBeenCalledTimes(saves);
  expect(effects.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', totalActualCostUsd: 6 });
});

it('publishes a final done transcript row after the verification probe finds no changes', async () => {
  effects.changed.mockReturnValue([]);
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    const done = { ...value, state: 'done', steps: value.steps.map((step: object) => ({ ...step, state: 'done' })) };
    callbacks.onPlanUpdate(done);
    return done;
  });
  const dispatch = vi.fn();
  await executeApprovedPlan(plan('self'), { dispatch, setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: vi.fn() } } as any);
  const rows = dispatch.mock.calls.filter(([event]) => event.type === 'plan-execution');
  expect(rows.at(-1)![0].plan.state).toBe('done');
  expect(effects.save.mock.calls.at(-1)![0].state).toBe('done');
});

it('releases only its own controller after another run takes the slot', async () => {
  let current: AbortController | null = null;
  const newer = new AbortController();
  const setActiveAbort = (value: AbortController | null, expected?: AbortController) => {
    if (expected && current !== expected) return;
    current = value;
  };
  effects.changed.mockReturnValue([]);
  effects.execute.mockImplementationOnce(async value => {
    current = newer;
    return { ...value, state: 'done' };
  });
  await executeApprovedPlan({ ...plan('self'), selfReview: false }, { dispatch: vi.fn(),
    setActivePlan: vi.fn(), ctx: { config: {}, setActiveAbort } } as any);
  expect(current).toBe(newer);
});

it('pauses and terminates the visible step when execution throws after step start', async () => {
  effects.changed.mockReturnValue([]);
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    callbacks.onPlanUpdate({ ...value, totalActualCostUsd: 3 });
    callbacks.onStepStart('s1');
    throw new Error('step transport failed');
  });
  const dispatch = vi.fn();
  const active = vi.fn();
  await executeApprovedPlan(plan('self'), { dispatch, setActivePlan: active,
    ctx: { config: {}, setActiveAbort: vi.fn() } } as any);
  expect(active.mock.calls.at(-1)![0]).toMatchObject({ state: 'paused', totalActualCostUsd: 3,
    steps: [{ id: 's1', state: 'failed', result: { error: 'step transport failed' } }] });
  expect(effects.save.mock.calls.at(-1)![0]).toEqual(active.mock.calls.at(-1)![0]);
  expect(dispatch).toHaveBeenCalledWith({ type: 'spinner-stop' });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'todos-update', id: 's1', state: 'failed' }));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'plan-execution', plan: expect.objectContaining({ state: 'paused' }) }));
});

it.each(['return', 'throw'])('clears the visible running step after cancellation and %s', async outcome => {
  effects.changed.mockReturnValue([]);
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    callbacks.onStepStart('s1');
    callbacks.onPlanUpdate({ ...value, state: 'cancelled' });
    if (outcome === 'throw') throw new Error('cancelled transport');
    return { ...value, state: 'done' };
  });
  const dispatch = vi.fn();
  await executeApprovedPlan(plan('self'), { dispatch, setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: vi.fn() } } as any);
  expect(dispatch).toHaveBeenCalledWith({ type: 'spinner-stop' });
  expect(dispatch.mock.calls.some(([event]) => event.type === 'success')).toBe(false);
  const todoUpdates = dispatch.mock.calls.filter(([event]) => event.type === 'todos-set');
  expect(todoUpdates.at(-1)![0].todos).toEqual([expect.objectContaining({ id: 's1', state: 'cancelled' })]);
  expect(effects.save.mock.calls.at(-1)![0].state).toBe('cancelled');
});
