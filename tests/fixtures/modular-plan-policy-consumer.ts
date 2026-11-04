/** Compile-only consumer of the installed public Plan package. */
import {
  evaluatePlanAutoApproval,
  evaluateAgenticPlanAutoApproval,
  selectPendingPlan,
  selectResumablePlan,
  shouldApprovePendingCesarPlanInput,
} from '@kernlang/agon-mod-plan';
import type {
  AutoApproveDecision,
  CesarPlan,
  PlanActionEvaluator,
  PlanApprovalConfig,
  PlanApprovalEffects,
  PlanSessionSnapshot,
} from '@kernlang/agon-mod-plan';

export function consumePlanPolicy(
  plan: CesarPlan,
  snapshot: PlanSessionSnapshot,
  saved: readonly CesarPlan[],
  config: PlanApprovalConfig,
  effects: PlanApprovalEffects,
  evaluateAction?: PlanActionEvaluator,
): { normal: AutoApproveDecision; agentic: AutoApproveDecision; pending: CesarPlan | null; resumable: CesarPlan | null; approve: boolean } {
  return {
    normal: evaluatePlanAutoApproval(plan, config, effects),
    agentic: evaluateAgenticPlanAutoApproval(plan, config, effects, evaluateAction),
    pending: selectPendingPlan(snapshot, () => saved),
    resumable: selectResumablePlan(snapshot),
    approve: shouldApprovePendingCesarPlanInput('go', snapshot),
  };
}
