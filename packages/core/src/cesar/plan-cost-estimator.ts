/** A20 Plan cost host binding (KL-011). Retire with the shared legacy host.
 * The physical Plan owner holds history and policy; core supplies current pricing. */
import { createPlanStepSanitizer, PlanCostEstimator as PhysicalPlanCostEstimator } from '@kernlang/agon-mod-plan';
import { estimateCost } from '../signals/token-tracker.js';
export type { CostEstimate } from '@kernlang/agon-mod-plan';
export class PlanCostEstimator extends PhysicalPlanCostEstimator {
  constructor() { super(estimateCost); }
}
export const planCostEstimator = new PlanCostEstimator();
export const sanitizePlanSteps = createPlanStepSanitizer(planCostEstimator);
