import { existsSync, readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createPlanRuntime } from '../../packages/mod-plan/src/runtime.js';
import { PlanCostEstimator } from '../../packages/mod-plan/src/cost-estimator.js';
import { createCesarPlan, approveCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { executePlan as executeCore, sanitizePlanSteps as sanitizeCore, planCostEstimator as coreEstimator } from '../../packages/core/src/cesar/plan-cost-estimator.js';

it('connects Core execution and sanitization to its exported estimator', async () => {
  coreEstimator.reset();
  try {
    const plan = approveCesarPlan(createCesarPlan('Core history', ['a', 'b'].map(id => ({
      id, type: 'self', description: id, estimatedTokens: 1, estimatedCostUsd: 1,
    }))));
    await executeCore(plan, { self: { execute: async () => ({ result: {
      status: 'success', actualTokens: 10, actualCostUsd: 0.3, durationMs: 1, output: 'done',
    } }) } }, { onStepStart() {}, onStepDone() {}, onPlanUpdate() {}, onBudgetWarning() {} });
    expect(coreEstimator.estimate('self', [])).toEqual({ tokens: 10, costUsd: 0.3 });
    expect(sanitizeCore([{ type: 'self' }]).steps[0]).toMatchObject({ estimatedTokens: 10, estimatedCostUsd: 0.3 });
  } finally { coreEstimator.reset(); }
});

it('shares completed-step estimates with proposal validation', async () => {
  const estimator = new PlanCostEstimator((_, tokens) => tokens / 1000);
  const runtime = createPlanRuntime(estimator);
  expect(runtime.estimator).toBe(estimator);
  const plan = approveCesarPlan(createCesarPlan('learn', ['a', 'b'].map(id => ({ id, type: 'self', description: id, estimatedTokens: 0, estimatedCostUsd: 0 }))));
  const result = await runtime.executePlan(plan, { self: { execute: async step => ({ result: { status: 'success', actualTokens: step.id === 'a' ? 10 : 30,
    actualCostUsd: step.id === 'a' ? 1 : 3, durationMs: 1, output: '' } }) } },
  { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() });
  expect(result.state).toBe('done');
  expect(runtime.sanitizePlanSteps([{ id: 'next', type: 'self', description: 'next' }]).steps[0]).toMatchObject({ estimatedTokens: 20, estimatedCostUsd: 2 });
});

it('keeps independently created runtime histories separate', () => {
  const one = createPlanRuntime(new PlanCostEstimator(() => 1));
  const two = createPlanRuntime(new PlanCostEstimator(() => 2));
  one.estimator.recordStepCompletion('self', 5, 3);
  one.estimator.recordStepCompletion('self', 5, 3);
  expect(one.estimator.estimate('self', [])).toEqual({ tokens: 5, costUsd: 3 });
  expect(two.estimator.estimate('self', [])).toEqual({ tokens: 2000, costUsd: 2 });
});

it('reports estimation failures without losing the completed step', async () => {
  const estimator = new PlanCostEstimator(() => 1);
  const error = new Error('history unavailable');
  vi.spyOn(estimator, 'recordStepCompletion').mockImplementation(() => { throw error; });
  const report = vi.fn();
  const runtime = createPlanRuntime(estimator, report);
  const plan = approveCesarPlan(createCesarPlan('report', [{ id: 'a', type: 'self', description: 'a', estimatedTokens: 0, estimatedCostUsd: 0 }]));
  const result = await runtime.executePlan(plan, { self: { execute: async () => ({ result: {
    status: 'success', actualTokens: 10, actualCostUsd: 1, durationMs: 1, output: 'completed',
  } }) } }, { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() });
  expect(result.state).toBe('done');
  expect(result.steps[0].result?.output).toBe('completed');
  expect(report).toHaveBeenCalledExactlyOnceWith('self', error);
});

it('removes the legacy scheduler and sanitizer facades without removing root exports', () => {
  for (const file of ['plan-executor', 'plan-validation']) {
    expect(existsSync(new URL('../../packages/core/src/cesar/' + file + '.ts', import.meta.url))).toBe(false);
  }
  const root = readFileSync(new URL('../../packages/core/src/index.ts', import.meta.url), 'utf8');
  expect(root).toContain('sanitizePlanSteps');
  expect(root).toContain('executePlan');
  expect(root).not.toContain("from './cesar/plan-executor.js'");
  expect(root).not.toContain("from './cesar/plan-validation.js'");
});
