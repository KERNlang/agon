import { beforeEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ execute: vi.fn(), save: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), executePlan: effects.execute, saveCesarPlan: effects.save,
  loadConfig: () => ({ cesarEngine: 'unrelated-config-engine' }),
  resolveWorkingDir: () => '/fixture', gitChangedFiles: () => [],
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
import { executeApprovedPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';
import { requestPlanFallback, revokePlanFallback, takePlanFallback } from '../../packages/cli/src/signals/plan-fallback.js';

beforeEach(() => vi.clearAllMocks());

function plan() {
  return { id: 'fixture-plan', intent: 'fixture', state: 'running', selfReview: false,
    steps: [{ id: 's1', type: 'self', engine: 'a', state: 'pending', description: 'fixture step' }],
    stepContext: {}, totalActualCostUsd: 0, totalActualTokens: 0 } as any;
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
