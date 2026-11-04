/** A20 Plan host binding (KL-011). Retire with the shared legacy host.
 * Plan owns runtime composition and history. Core supplies pricing and warnings. */
import { createPlanRuntime, PlanCostEstimator as PhysicalPlanCostEstimator } from '@kernlang/agon-mod-plan';
import { estimateCost } from '../signals/token-tracker.js';
export type { CostEstimate } from '@kernlang/agon-mod-plan';
export class PlanCostEstimator extends PhysicalPlanCostEstimator {
  constructor() { super(estimateCost); }
}
export const planCostEstimator = new PlanCostEstimator();
export const { sanitizePlanSteps, executePlan } = createPlanRuntime(planCostEstimator,
  (type, error) => console.warn(`[plan] estimation history update failed (${type}):`, error));
