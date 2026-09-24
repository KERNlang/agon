import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import type { CesarPlan } from '@kernlang/agon-core';

const effects = vi.hoisted(() => ({
  approve: vi.fn((plan) => ({ ...plan, state: 'approved' })),
  cancel: vi.fn((plan) => ({ ...plan, state: 'cancelled' })),
  save: vi.fn(), saveCesar: vi.fn(),
  execute: vi.fn(async (plan) => ({ ...plan, state: 'paused' })),
}));
vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  approvePlan: effects.approve, cancelPlan: effects.cancel, savePlan: effects.save,
  saveCesarPlan: effects.saveCesar, executePlan: effects.execute,
  loadConfig: () => ({}), resolveWorkingDir: () => '/fixture', gitChangedFiles: () => [],
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
import { handlePlanShow } from '../../packages/cli/src/handlers/plan.js';
import { resumeCesarPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';

beforeEach(() => vi.clearAllMocks());

describe('plan approval refuses unrecognized answers', () => {
  it.each(['no', 'NO', 'not yet', 'cancel', 'maybe'])('draft approval refuses %s', async answer => {
    const plan = { id: 'fixture', state: 'draft', action: { type: 'build' } };
    const setCurrentPlan = vi.fn();
    await handlePlanShow(vi.fn(), { currentPlan: plan, askQuestion: async () => answer, setCurrentPlan } as unknown as HandlerContext);
    expect(effects.approve).not.toHaveBeenCalled();
    expect(setCurrentPlan).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
    expect(effects.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
  });

  it.each(['', 'y', ' YES '])('draft approval preserves affirmative/default %j', async answer => {
    const plan = { id: 'fixture', state: 'draft', action: { type: 'build' } };
    await handlePlanShow(vi.fn(), { currentPlan: plan, askQuestion: async () => answer, setCurrentPlan: vi.fn() } as unknown as HandlerContext);
    expect(effects.approve).toHaveBeenCalledOnce();
    expect(effects.cancel).not.toHaveBeenCalled();
  });

  it.each(['no', 'n', 'not yet', 'maybe', '3', 'cancel', ''])('resume refuses %j without persisting or executing', async answer => {
    const plan = { id: 'fixture', intent: 'fixture', state: 'paused', steps: [], totalActualCostUsd: 0 } as unknown as CesarPlan;
    const setActivePlan = vi.fn();
    const dispatch = vi.fn((event) => { if (event.type === 'question') event.resolve(answer); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan, ctx: { config: {} } } as unknown as DispatchCallbacks);
    expect(setActivePlan).not.toHaveBeenCalled();
    expect(effects.saveCesar).not.toHaveBeenCalled();
    expect(effects.execute).not.toHaveBeenCalled();
    expect(plan.state).toBe('paused');
  });

  it.each(['1', 'resume', '2', 'restart'])('resume accepts explicit choice %s', async answer => {
    const plan = { id: 'fixture', intent: 'fixture', state: 'paused', steps: [], totalActualCostUsd: 0 } as unknown as CesarPlan;
    const dispatch = vi.fn((event) => { if (event.type === 'question') event.resolve(answer); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks);
    expect(effects.execute).toHaveBeenCalledOnce();
  });
});
