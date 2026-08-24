/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-worktree. */
import {
  approvePlan as approveModularPlan,
  cancelPlan as cancelModularPlan,
  failPlan as failModularPlan,
  startPlan as startModularPlan,
  type Plan,
  type WorktreePlanRuntime,
} from "@kernlang/agon-support-worktree";

import { PlanStateError } from "../models/errors.js";

const compatibilityRuntime: WorktreePlanRuntime = Object.freeze<WorktreePlanRuntime>({
  createStateError: (expected: string | string[], actual: string) => new PlanStateError(expected, actual),
});

export function approvePlan(plan: Plan): Plan {
  return approveModularPlan(plan, compatibilityRuntime);
}

export function startPlan(plan: Plan): Plan {
  return startModularPlan(plan, compatibilityRuntime);
}

export function cancelPlan(plan: Plan): Plan {
  return cancelModularPlan(plan, compatibilityRuntime);
}

export function failPlan(plan: Plan, error?: string): Plan {
  return failModularPlan(plan, error, compatibilityRuntime);
}

export * from "@kernlang/agon-support-worktree";
