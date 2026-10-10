import { createPlanExecutor } from './executor.js';
import type { PlanExecutionServices } from './executor.js';
import { createPlanStepSanitizer } from './step-validation.js';
import type { PlanStepEstimator } from './step-validation.js';

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
