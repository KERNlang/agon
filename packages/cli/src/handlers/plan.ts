
import { loadPlan, listPlans, approvePlan, startPlan, cancelPlan, resetStepForRetry, savePlan } from '@kernlang/agon-core';

import type { Plan } from '@kernlang/agon-core';

import type { Dispatch, HandlerContext } from './types.js';
import { isExplicitApproval } from '../lib/explicit-approval.js';

export async function handlePlanShow(dispatch: Dispatch, ctx: HandlerContext, planId?: string): Promise<void> {
  let plan: Plan | null = null;
  
  if (planId) {
    plan = loadPlan(planId);
    if (!plan) {
      dispatch({ type: 'warning', message: `Plan not found: ${planId}` });
      return;
    }
  } else if (ctx.currentPlan) {
    plan = ctx.currentPlan;
  } else {
    const recent = listPlans(1);
    if (recent.length > 0) {
      plan = recent[0];
    } else {
      dispatch({ type: 'info', message: 'No plans yet. Run /forge or build to create one.' });
      return;
    }
  }
  
  dispatch({ type: 'plan', plan });
  
  // If draft, prompt for approval inline
  if (plan.state === 'draft') {
    if (ctx.currentPlan !== plan) ctx.setCurrentPlan(plan);
    const answer = (await ctx.askQuestion('Approve plan? Type y or yes to approve.')).trim();
    if (ctx.currentPlan !== plan || plan.state !== 'draft') {
      dispatch({ type: 'info', message: 'Plan changed while approval was pending. Show the current plan before approving.' });
      return;
    }
    // The question host also returns an empty answer when a permission prompt
    // dismisses this question. Absence of an answer cannot authorize execution.
    if (!answer) {
      dispatch({ type: 'info', message: 'Plan remains draft. Use /approve to approve it explicitly.' });
      return;
    }
    if (!isExplicitApproval(answer)) {
      const cancelled = cancelPlan(plan);
      ctx.setCurrentPlan(cancelled);
      savePlan(cancelled);
      dispatch({ type: 'success', message: 'Plan cancelled.' });
    } else {
      const approved = approvePlan(plan);
      ctx.setCurrentPlan(approved);
      savePlan(approved);
      dispatch({ type: 'success', message: 'Plan approved.' });
  
      if (approved.action.type === 'forge') {
        const { handleForge } = await import('./forge.js');
        await handleForge(approved.action.task, approved.action.fitnessCmd ?? null, dispatch, ctx, approved, approved.action.hardened);
      } else {
        dispatch({ type: 'info', message: 'Run the build again to execute.' });
      }
    }
  }
}

export function handlePlansList(dispatch: Dispatch): void {
  const plans = listPlans(20);
  dispatch({ type: 'plan-list', plans: plans });
}

export async function handleApprove(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  if (!ctx.currentPlan) {
    dispatch({ type: 'warning', message: 'No active plan to approve.' });
    return;
  }
  if (ctx.currentPlan.state !== 'draft') {
    dispatch({ type: 'warning', message: `Plan is ${ctx.currentPlan.state}, not draft.` });
    return;
  }
  
  let plan = approvePlan(ctx.currentPlan);
  ctx.setCurrentPlan(plan);
  savePlan(plan);
  dispatch({ type: 'success', message: 'Plan approved.' });
  
  if (plan.action.type === 'forge') {
    const { handleForge } = await import('./forge.js');
    await handleForge(plan.action.task, plan.action.fitnessCmd ?? null, dispatch, ctx, plan, plan.action.hardened);
  } else {
    dispatch({ type: 'info', message: 'Run the build again to execute.' });
  }
}

export async function handleRetry(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  if (!ctx.currentPlan) {
    dispatch({ type: 'warning', message: 'No active plan to retry.' });
    return;
  }
  if (ctx.currentPlan.state !== 'paused' && ctx.currentPlan.state !== 'failed') {
    dispatch({ type: 'warning', message: `Plan is ${ctx.currentPlan.state} — only paused/failed plans can be retried.` });
    return;
  }
  
  const failedStep = ctx.currentPlan.steps.find((s: any) => s.result.state === 'failed');
  if (!failedStep) {
    dispatch({ type: 'info', message: 'No failed step found. Re-run the command to restart.' });
    return;
  }
  
  dispatch({ type: 'info', message: `Retrying from: ${failedStep.label}` });
  let plan = resetStepForRetry(ctx.currentPlan, failedStep.id);
  ctx.setCurrentPlan(plan);
  savePlan(plan);
  
  if (plan.action.type === 'forge') {
    plan = startPlan(plan);
    ctx.setCurrentPlan(plan);
    savePlan(plan);
    const { handleForge } = await import('./forge.js');
    await handleForge(plan.action.task, plan.action.fitnessCmd ?? null, dispatch, ctx, plan, plan.action.hardened);
  } else {
    dispatch({ type: 'info', message: 'Plan reset to approved. Run the build again to execute.' });
  }
}

export function handleCancel(dispatch: Dispatch, ctx: HandlerContext): void {
  if (!ctx.currentPlan) {
    dispatch({ type: 'warning', message: 'No active plan to cancel.' });
    return;
  }
  if (ctx.currentPlan.state === 'completed' || ctx.currentPlan.state === 'cancelled') {
    dispatch({ type: 'warning', message: `Plan already ${ctx.currentPlan.state}.` });
    return;
  }
  const plan = cancelPlan(ctx.currentPlan);
  ctx.setCurrentPlan(plan);
  savePlan(plan);
  dispatch({ type: 'success', message: 'Plan cancelled.' });
}
