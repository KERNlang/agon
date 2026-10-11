import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import type { CesarPlan } from '@kernlang/agon-core';
import { createCesarPlan } from '@kernlang/agon-mod-plan';

const effects = vi.hoisted(() => ({
  approve: vi.fn((plan) => ({ ...plan, state: 'approved' })),
  cancel: vi.fn((plan) => ({ ...plan, state: 'cancelled' })),
  save: vi.fn(), saveCesar: vi.fn(),
  load: vi.fn(),
  execute: vi.fn(async (plan) => ({ ...plan, state: 'paused' })),
}));
vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  approvePlan: effects.approve, cancelPlan: effects.cancel, savePlan: effects.save,
  loadPlan: effects.load,
  saveCesarPlan: effects.saveCesar, executePlan: effects.execute,
  loadConfig: () => ({}), resolveWorkingDir: () => '/fixture', gitChangedFiles: () => [],
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
import { handlePlanShow, handleApprove } from '../../packages/cli/src/handlers/plan.js';
import { resumeCesarPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';

beforeEach(() => vi.clearAllMocks());

describe('plan approval refuses unrecognized answers', () => {
  it('keeps /approve bound to the disk draft shown before dismissal', async () => {
    const oldDraft = { id: 'old', state: 'draft', action: { type: 'build' } };
    const shownDraft = { id: 'shown', state: 'draft', action: { type: 'build' } };
    effects.load.mockReturnValue(shownDraft);
    const ctx = {
      currentPlan: oldDraft, askQuestion: async () => '',
      setCurrentPlan: (plan: typeof oldDraft) => { ctx.currentPlan = plan; },
    };
    await handlePlanShow(vi.fn(), ctx as unknown as HandlerContext, 'shown');
    expect(effects.approve).not.toHaveBeenCalled();
    await handleApprove(vi.fn(), ctx as unknown as HandlerContext);
    expect(effects.approve).toHaveBeenCalledWith(shownDraft);
    expect(effects.approve).not.toHaveBeenCalledWith(oldDraft);
  });
  it.each([
    ['', 'replacement'], ['y', 'replacement'], ['n', 'replacement'],
    ['', 'cancelled'], ['y', 'cancelled'], ['n', 'cancelled'],
  ])('does not overwrite %s / %s state while a draft question is open', async (answer, change) => {
    const draft = { id: 'shown', state: 'draft', action: { type: 'build' } };
    const newer = { ...draft, id: change === 'replacement' ? 'newer' : draft.id,
      state: change === 'cancelled' ? 'cancelled' : 'draft' };
    let resolveQuestion!: (answer: string) => void;
    const question = new Promise<string>(resolve => { resolveQuestion = resolve; });
    const ctx = { currentPlan: draft, askQuestion: () => question,
      setCurrentPlan: vi.fn((plan: typeof draft) => { ctx.currentPlan = plan; }) };
    const pending = handlePlanShow(vi.fn(), ctx as unknown as HandlerContext);
    ctx.currentPlan = newer;
    resolveQuestion(answer);
    await pending;
    expect(ctx.currentPlan).toBe(newer);
    expect(ctx.setCurrentPlan).not.toHaveBeenCalled();
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.cancel).not.toHaveBeenCalled();
    expect(effects.save).not.toHaveBeenCalled();
  });
  it.each(['no', 'NO', 'not yet', 'cancel', 'maybe'])('draft approval refuses %s', async answer => {
    const plan = { id: 'fixture', state: 'draft', action: { type: 'build' } };
    const setCurrentPlan = vi.fn();
    await handlePlanShow(vi.fn(), { currentPlan: plan, askQuestion: async () => answer, setCurrentPlan } as unknown as HandlerContext);
    expect(effects.approve).not.toHaveBeenCalled();
    expect(setCurrentPlan).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
    expect(effects.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
  });

  it.each(['', '   '])('dismissed draft approval preserves the draft for %j', async answer => {
    const plan = { id: 'fixture', state: 'draft', action: { type: 'build' } };
    const setCurrentPlan = vi.fn();
    await handlePlanShow(vi.fn(), { currentPlan: plan, askQuestion: async () => answer, setCurrentPlan } as unknown as HandlerContext);
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.cancel).not.toHaveBeenCalled();
    expect(effects.save).not.toHaveBeenCalled();
    expect(setCurrentPlan).not.toHaveBeenCalled();
    expect(plan.state).toBe('draft');
  });

  it.each(['y', ' YES '])('draft approval preserves explicit affirmative %j', async answer => {
    const plan = { id: 'fixture', state: 'draft', action: { type: 'build' } };
    await handlePlanShow(vi.fn(), { currentPlan: plan, askQuestion: async () => answer, setCurrentPlan: vi.fn() } as unknown as HandlerContext);
    expect(effects.approve).toHaveBeenCalledOnce();
    expect(effects.cancel).not.toHaveBeenCalled();
  });

  it.each(['no', 'n', 'not yet', 'maybe', '3', 'cancel', ''])('resume refuses %j without persisting or executing', async answer => {
    const plan: CesarPlan = { ...createCesarPlan('fixture', []), id: 'fixture', state: 'paused' };
    const setActivePlan = vi.fn();
    const dispatch = vi.fn((event) => { if (event.type === 'question') event.resolve(answer); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan, ctx: { config: {} } } as unknown as DispatchCallbacks);
    expect(setActivePlan).not.toHaveBeenCalled();
    expect(effects.saveCesar).not.toHaveBeenCalled();
    expect(effects.execute).not.toHaveBeenCalled();
    expect(plan.state).toBe('paused');
  });

  it.each(['1', 'resume', '2', 'restart'])('resume accepts explicit choice %s', async answer => {
    const plan: CesarPlan = { ...createCesarPlan('fixture', []), id: 'fixture', state: 'paused' };
    const dispatch = vi.fn((event) => { if (event.type === 'question') event.resolve(answer); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks);
    expect(effects.execute).toHaveBeenCalledOnce();
  });

  it.each(['resume', 'restart'])('preserves the raw %s plan passed to execution', async answer => {
    const plan: CesarPlan = {
      id: 'fixture', intent: 'fixture', state: 'paused',
      steps: [
        { id: 'done', description: 'done', type: 'self', state: 'done', estimatedTokens: 10, estimatedCostUsd: 1,
          result: { status: 'success', output: 'retained context', actualTokens: 17, actualCostUsd: 4, durationMs: 1 } },
        { id: 'review', description: 'review', type: 'review', state: 'failed', estimatedTokens: 20, estimatedCostUsd: 2 },
        { id: 'blocked', description: 'blocked', type: 'self', state: 'blocked', dependsOn: ['review'], estimatedTokens: 30, estimatedCostUsd: 3 },
      ],
      totalEstimatedTokens: 60, totalEstimatedCostUsd: 6,
      totalActualTokens: 17, totalActualCostUsd: 4, reviewCyclesUsed: 2,
      stepContext: { done: 'retained context' }, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const snapshot = structuredClone(plan);
    const dispatch = vi.fn(event => { if (event.type === 'question') event.resolve(answer); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks);
    const expected: CesarPlan = answer === 'restart' ? {
      ...snapshot, state: 'running', totalActualTokens: 0, totalActualCostUsd: 0,
      steps: [
        { ...snapshot.steps[0], state: 'pending', result: undefined },
        { ...snapshot.steps[1], state: 'pending', result: undefined },
        { ...snapshot.steps[2], state: 'blocked', result: undefined },
      ],
    } : {
      ...snapshot, state: 'running', steps: [
        { ...snapshot.steps[0], state: 'skipped' }, snapshot.steps[1], snapshot.steps[2],
      ],
    };
    expect(effects.saveCesar.mock.calls[0][0]).toStrictEqual(expected);
    expect(effects.execute.mock.calls[0][0]).toStrictEqual(expected);
    expect(plan).toStrictEqual(snapshot);
  });

  it.each(['running', 'done'] as const)('refuses ordinary resume with a %s step missing its result', async state => {
    const plan: CesarPlan = {
      id: 'fixture', intent: 'uncertain effects', state: 'paused',
      steps: [{ id: 'uncertain', type: 'self', description: 'uncertain', state, estimatedTokens: 1, estimatedCostUsd: 0 }],
      totalEstimatedTokens: 1, totalEstimatedCostUsd: 0, totalActualTokens: 0, totalActualCostUsd: 0,
      stepContext: {}, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const before = structuredClone(plan);
    const dispatch = vi.fn(event => { if (event.type === 'question') event.resolve('resume'); });
    await resumeCesarPlan(plan, { dispatch, setActivePlan: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks);
    expect(effects.execute).not.toHaveBeenCalled();
    expect(effects.saveCesar).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('uncertain') }));
    expect(plan).toStrictEqual(before);
  });
});
