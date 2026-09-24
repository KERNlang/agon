/** Compatibility adapter A20-PLAN-SCHEDULER (KL-011).
 * The physical Plan package is the only scheduler owner. Retire this adapter
 * once callers inject transition/cost services directly through Plan activation. */
import { createPlanExecutor, advanceCesarStep } from '@kernlang/agon-mod-plan';
import { planCostEstimator } from './plan-cost-estimator.js';
export { getReadySteps } from '@kernlang/agon-mod-plan';
export type { StepExecutor, PlanExecutorCallbacks } from '@kernlang/agon-mod-plan';

export const executePlan = createPlanExecutor({
  advance: advanceCesarStep,
  recordStepCompletion: (type, tokens, cost) => planCostEstimator.recordStepCompletion(type, tokens, cost),
});
