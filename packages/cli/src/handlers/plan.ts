import { listPlans } from '@kernlang/agon-core';
import { showWorktreePlan, listWorktreePlans, approveWorktreePlan, retryWorktreePlan, cancelWorktreePlan } from '@kernlang/agon-mod-plan';
import type { Dispatch, HandlerContext } from './types.js';
import { worktreePlanHost } from '../blocks/worktree-plan-effects.js';

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
