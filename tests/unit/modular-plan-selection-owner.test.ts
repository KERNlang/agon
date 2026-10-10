import { beforeEach, expect, it, vi } from 'vitest';
import type { CesarPlan } from '@kernlang/agon-mod-plan';
import * as physical from '@kernlang/agon-mod-plan';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const effects = vi.hoisted(() => ({
  list: vi.fn(), pending: vi.fn(), resumable: vi.fn(), approval: vi.fn(),
}));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  listCesarPlans: () => { throw new Error('legacy core Plan store must not run'); },
}));
vi.mock('@kernlang/agon-mod-plan', async original => {
  const actual = await original<typeof import('@kernlang/agon-mod-plan')>();
  return {
    ...actual, listCesarPlans: effects.list,
    selectPendingPlan: effects.pending.mockImplementation(actual.selectPendingPlan),
    selectResumablePlan: effects.resumable.mockImplementation(actual.selectResumablePlan),
    shouldApprovePendingCesarPlanInput: effects.approval.mockImplementation(actual.shouldApprovePendingCesarPlanInput),
  };
});
import { findPendingCesarPlan, findResumableCesarPlan, shouldApprovePendingCesarPlanInput,
  formatCesarPlanRuntimeStatus } from '../../packages/cli/src/signals/dispatch/plan-queries.js';

beforeEach(() => { vi.clearAllMocks(); effects.list.mockReturnValue([]); });
function plan(id: string, state: CesarPlan['state'], createdAt = '2026-01-01T00:00:00.000Z'): CesarPlan {
  return { id, state, intent: id, steps: [], stepContext: {}, createdAt, totalActualTokens: 0,
    totalActualCostUsd: 0, totalEstimatedTokens: 0, totalEstimatedCostUsd: 0 };
}
const context = (proposedPlan?: CesarPlan, activePlan?: CesarPlan) => ({
  cesar: { proposedPlan }, activePlan,
}) as unknown as HandlerContext;

it('owns selection in the physical Plan package, not the CLI binding', () => {
  expect(physical).toHaveProperty('selectPendingPlan');
  expect(physical).toHaveProperty('selectResumablePlan');
  expect(formatCesarPlanRuntimeStatus).toBe(physical.formatCesarPlanRuntimeStatus);
});

it('selects the live proposal before active or saved plans without reading storage', () => {
  const proposal = plan('proposal', 'awaiting_approval');
  expect(findPendingCesarPlan(context(proposal, plan('active', 'awaiting_approval')))).toBe(proposal);
  expect(effects.pending).toHaveBeenCalledOnce();
  expect(effects.pending).toHaveBeenCalledWith(expect.objectContaining({ proposedPlan: proposal }), effects.list);
  expect(effects.list).not.toHaveBeenCalled();
});

it('selects the active pending plan when the proposal is not pending', () => {
  const active = plan('active', 'awaiting_approval');
  expect(findPendingCesarPlan(context(plan('finished', 'done'), active))).toBe(active);
  expect(effects.list).not.toHaveBeenCalled();
});

it('uses the newest saved pending plan only when no live pending plan exists', () => {
  const older = plan('older', 'awaiting_approval');
  const newer = plan('newer', 'awaiting_approval', '2026-02-01T00:00:00.000Z');
  const finished = plan('finished', 'done', '2026-03-01T00:00:00.000Z');
  const saved = [older, finished, newer];
  effects.list.mockReturnValue(saved);
  expect(findPendingCesarPlan(context())).toBe(newer);
  expect(saved).toEqual([older, finished, newer]);
  expect(effects.list).toHaveBeenCalledOnce();
});

it('does not turn storage failure into a different selected plan', () => {
  effects.list.mockImplementation(() => { throw new Error('store unavailable'); });
  expect(() => findPendingCesarPlan(context())).toThrow('store unavailable');
});

it.each(['paused', 'running'] as const)('resumes only the active %s plan', state => {
  const active = plan('active', state);
  expect(findResumableCesarPlan(context(plan('proposal', state), active))).toBe(active);
  expect(findResumableCesarPlan(context(plan('proposal', state)))).toBeNull();
  expect(effects.resumable).toHaveBeenCalledTimes(2);
  expect(effects.list).not.toHaveBeenCalled();
});

it('never discovers a saved plan from natural approval or resume lookup', () => {
  effects.list.mockReturnValue([plan('saved', 'awaiting_approval')]);
  expect(shouldApprovePendingCesarPlanInput('go', context())).toBe(false);
  expect(findResumableCesarPlan(context())).toBeNull();
  expect(effects.list).not.toHaveBeenCalled();
});

it.each([['go!', true], [' OK GO ', true], ['/approve', false], ['', false], ['maybe', false]])(
  'preserves live-session approval parsing for %j', (input, expected) => {
    expect(shouldApprovePendingCesarPlanInput(input as string, context(plan('proposal', 'awaiting_approval')))).toBe(expected);
    expect(effects.approval).toHaveBeenCalledOnce();
    expect(effects.approval).toHaveBeenCalledWith(input, expect.objectContaining({
      proposedPlan: expect.objectContaining({ id: 'proposal' }),
    }));
    expect(effects.list).not.toHaveBeenCalled();
  });

it('preserves historical status text without selecting or executing work', () => {
  const active = { ...plan('cplan-example-id', 'paused'), steps: [
    { id: 'done', type: 'self' as const, description: 'finished', state: 'done' as const, estimatedTokens: 0, estimatedCostUsd: 0 },
    { id: 'next', type: 'self' as const, description: 'next step', state: 'pending' as const, estimatedTokens: 0, estimatedCostUsd: 0 },
  ] };
  expect(formatCesarPlanRuntimeStatus(active)).toBe('Plan cplan-exampl is paused: 1/2 steps done.\nNext: next step\nUse /plan resume or say "go" to continue it.');
  expect(effects.list).not.toHaveBeenCalled();
});
