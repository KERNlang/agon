import { loadPlan, listPlans, savePlan, PlanStateError } from '@kernlang/agon-core';
import { showWorktreePlan, listWorktreePlans, approveWorktreePlan, retryWorktreePlan, cancelWorktreePlan } from '@kernlang/agon-mod-plan';
import type { WorktreePlanHost } from '@kernlang/agon-mod-plan';
import type { Dispatch, HandlerContext } from './types.js';

/** Bind terminal and persistence effects to the physical Plan workflow. */
function worktreePlanHost(dispatch: Dispatch, ctx: HandlerContext): WorktreePlanHost {
  return {
    current: () => ctx.currentPlan,
    setCurrent: plan => ctx.setCurrentPlan(plan),
    load: loadPlan, list: listPlans, save: savePlan, emit: dispatch,
    ask: question => ctx.askQuestion(question),
    stateRuntime: { createStateError: (expected, actual) => new PlanStateError(expected, actual) },
    forge: async plan => {
      const { handleForge } = await import('./forge.js');
      await handleForge(plan.action.task, plan.action.fitnessCmd ?? null, dispatch, ctx, plan, plan.action.hardened);
    },
  };
}

export async function handlePlanShow(dispatch: Dispatch, ctx: HandlerContext, planId?: string): Promise<void> {
  await showWorktreePlan(worktreePlanHost(dispatch, ctx), planId);
}

export function handlePlansList(dispatch: Dispatch): void {
  listWorktreePlans({ list: listPlans, emit: dispatch });
}

export async function handleApprove(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  await approveWorktreePlan(worktreePlanHost(dispatch, ctx));
}

export async function handleRetry(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  await retryWorktreePlan(worktreePlanHost(dispatch, ctx));
}

export function handleCancel(dispatch: Dispatch, ctx: HandlerContext): void {
  cancelWorktreePlan(worktreePlanHost(dispatch, ctx));
}
