import type { CesarPlan, AgonConfig } from '@kernlang/agon-core';
import { planCostEstimator } from '@kernlang/agon-core';
import { evaluatePlanAutoApproval, evaluateAgenticPlanAutoApproval } from '@kernlang/agon-mod-plan';
import type { AutoApproveDecision } from '@kernlang/agon-mod-plan';
import { evaluateTaskAction } from './task-execution-lease.js';
import type { TaskExecutionLease } from './task-execution-lease.js';

export { MUTATING_STEP_TYPES } from '@kernlang/agon-mod-plan';
export type { AutoApproveDecision } from '@kernlang/agon-mod-plan';

const effects = { estimateReviewCostUsd: () => planCostEstimator.estimate('review', []).costUsd };

/** A05 approval binding. Plan owns the decision; the host owns estimates and leases. */
export function applyAutoApprovePolicy(plan: CesarPlan, config: AgonConfig): AutoApproveDecision {
  return evaluatePlanAutoApproval(plan, config, effects);
}

export function applyAgenticAutoApprovePolicy(plan: CesarPlan, config: AgonConfig, lease: TaskExecutionLease | undefined): AutoApproveDecision {
  return evaluateAgenticPlanAutoApproval(plan, config, effects,
    lease ? (action, text) => evaluateTaskAction(lease, action, text) : undefined);
}
