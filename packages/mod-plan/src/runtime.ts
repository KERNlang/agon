import { createPlanExecutor } from './executor.js';
import type { PlanExecutionServices, StepExecutor } from './executor.js';
import { createPlanStepSanitizer } from './step-validation.js';
import type { PlanStepEstimator } from './step-validation.js';
import type { Dispose, ModServices } from '@kernlang/agon-mod-api';
import { PlanCostEstimator } from './cost-estimator.js';
import type { PlanCostPricing } from './cost-estimator.js';

export type PlanRuntime = ReturnType<typeof createPlanRuntime<PlanCostEstimator>>;

export interface PlanRuntimeHost {
  estimateCost: PlanCostPricing;
  assertAvailable?(): void;
  onEstimationError?: PlanExecutionServices['onEstimationError'];
  bind(runtime: PlanRuntime): Dispose;
}

export interface PlanRuntimeModServices extends ModServices {
  readonly planRuntime?: PlanRuntimeHost;
}

/** Bind history to one activation. Disposal revokes retained execution handles. */
export function bindPlanRuntime(host: PlanRuntimeHost): Dispose {
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error('Plan runtime was disposed; restart the invocation');
    host.assertAvailable?.();
  };
  const runtime = createPlanRuntime(new PlanCostEstimator(host.estimateCost), host.onEstimationError);
  const bound: PlanRuntime = Object.freeze({
    estimator: runtime.estimator,
    sanitizePlanSteps: (...args) => { assertActive(); return runtime.sanitizePlanSteps(...args); },
    executePlan: async (plan, executors, callbacks, signal) => {
      assertActive();
      const guarded = Object.fromEntries(Object.entries(executors).map(([type, executor]) => [type, {
        execute: (...args: Parameters<StepExecutor['execute']>) => {
          assertActive();
          return executor.execute(...args);
        },
      }]));
      return runtime.executePlan(plan, guarded, callbacks, signal);
    },
  });
  let unbind: Dispose;
  try { unbind = host.bind(bound); }
  catch (error) { active = false; throw error; }
  return async () => { active = false; await unbind(); };
}

/** One host-owned estimator connects execution history to proposal estimates. */
export function createPlanRuntime<Estimator extends PlanStepEstimator & PlanExecutionServices>(
  estimator: Estimator,
  onEstimationError?: PlanExecutionServices['onEstimationError'],
) {
  return Object.freeze({
    estimator,
    sanitizePlanSteps: createPlanStepSanitizer(estimator),
    executePlan: createPlanExecutor({
      recordStepCompletion: (type, tokens, cost) => estimator.recordStepCompletion(type, tokens, cost),
      onEstimationError,
    }),
  });
}
