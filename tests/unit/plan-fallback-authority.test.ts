import { beforeEach, expect, it, vi } from 'vitest';
import { createCesarPlan } from '@kernlang/agon-mod-plan';
const effects = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), executePlan: effects.execute,
  loadConfig: () => ({ cesarEngine: 'unrelated-config-engine' }),
  resolveWorkingDir: () => '/fixture',
}));
vi.mock('@kernlang/agon-mod-plan', async original => ({
  ...await original<Record<string, unknown>>(), saveCesarPlan: effects.save,
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
import { executeApprovedPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';
import { requestPlanFallback, revokePlanFallback, takePlanFallback } from '../../packages/cli/src/signals/plan-fallback.js';

beforeEach(() => vi.resetAllMocks());

function plan() {
  return { ...createCesarPlan('fixture', [{ id: 's1', type: 'self', engine: 'a', description: 'fixture step', estimatedTokens: 1, estimatedCostUsd: 0 }]),
    id: 'fixture-plan', state: 'running', selfReview: false } as any;
}

it.each(['user cancellation', 'timeout text', 'cancelled plan'])('does not authorize another execution from %s', async scenario => {
  let controller!: AbortController;
  effects.execute.mockImplementationOnce(async p => {
    if (scenario !== 'timeout text') controller.abort();
    return { ...p, state: scenario === 'cancelled plan' ? 'cancelled' : 'paused',
      steps: [{ ...p.steps[0], state: 'failed', result: { error: scenario === 'timeout text' ? 'timeout' : 'cancelled' } }] };
  }).mockImplementation(async p => ({ ...p, state: 'paused' }));
  await executeApprovedPlan(plan(), { dispatch: vi.fn(), setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: (c: AbortController) => { if (c) controller = c; } } } as any);
  expect(effects.execute).toHaveBeenCalledTimes(1);
});

it.each(['approved', 'wrong plan', 'wrong step', 'foreign run', 'revoked', 'spent', 'semantic failure', 'cancelled'])(
  'binds retry authority to the run, plan and step: %s', async scenario => {
    let controller!: AbortController;
    const initial = plan();
    if (scenario === 'spent') initial.fallbackRetriesUsed = { s1: 1 };
    effects.execute.mockImplementationOnce(async p => {
      const target = scenario === 'foreign run' ? new AbortController() : controller;
      expect(requestPlanFallback(target, scenario === 'wrong plan' ? 'other' : p.id,
        scenario === 'wrong step' ? 'other' : 's1', 'authorized-engine')).toBe(true);
      if (scenario === 'revoked') revokePlanFallback(target.signal);
      return { ...p, state: scenario === 'cancelled' ? 'cancelled' : 'paused',
        steps: [{ ...p.steps[0], state: 'failed', result: { error: scenario === 'semantic failure' ? 'invalid schema' : 'cancelled' } }] };
    }).mockImplementation(async p => ({ ...p, state: 'paused' }));
    await executeApprovedPlan(initial, { dispatch: vi.fn(), setActivePlan: vi.fn(),
      ctx: { config: {}, setActiveAbort: (c: AbortController) => { if (c) controller = c; } } } as any);
    expect(effects.execute).toHaveBeenCalledTimes(scenario === 'approved' ? 2 : 1);
    if (scenario === 'approved') {
      const retry = effects.execute.mock.calls[1]![0];
      expect(retry.steps[0]).toMatchObject({ engine: 'authorized-engine', state: 'pending' });
      expect(retry.fallbackRetriesUsed).toEqual({ s1: 1 });
      expect(effects.execute.mock.calls[1]![3].aborted).toBe(false);
    }
  });

it('consumes a request once and refuses an already aborted controller', () => {
  const controller = new AbortController();
  expect(requestPlanFallback(controller, 'p', 's', 'b')).toBe(true);
  expect(requestPlanFallback(controller, 'p', 's', 'c')).toBe(false);
  expect(takePlanFallback(controller.signal, 'p')).toEqual({ planId: 'p', stepId: 's', engine: 'b' });
  expect(takePlanFallback(controller.signal, 'p')).toBeUndefined();
});

it('retains a real fallback grant when its interrupted executor throws', async () => {
  let controller!: AbortController;
  effects.execute.mockImplementationOnce(async (value, _executors, callbacks) => {
    callbacks.onStepStart('s1');
    expect(requestPlanFallback(controller, value.id, 's1', 'replacement')).toBe(true);
    throw new Error('cancelled transport');
  }).mockImplementationOnce(async value => ({ ...value, state: 'paused' }));
  await executeApprovedPlan(plan(), { dispatch: vi.fn(), setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: (value: AbortController) => { if (value) controller = value; } } } as any);
  expect(effects.execute).toHaveBeenCalledTimes(2);
  expect(effects.execute.mock.calls[1]![0]).toMatchObject({ fallbackRetriesUsed: { s1: 1 },
    steps: [{ id: 's1', engine: 'replacement', state: 'pending' }] });
  expect(effects.execute.mock.calls[1]![3].aborted).toBe(false);
});
