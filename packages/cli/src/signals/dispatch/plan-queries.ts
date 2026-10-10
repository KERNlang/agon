import {
  listCesarPlans, selectPendingPlan, selectResumablePlan,
  shouldApprovePendingCesarPlanInput as shouldApproveSelection,
} from '@kernlang/agon-mod-plan';
import type { PlanSessionSnapshot } from '@kernlang/agon-mod-plan';
import type { HandlerContext } from '../../handlers/types.js';
import type { DispatchCallbacks } from '../dispatch.js';

export {
  isCesarPlanApprovalInput, isStrongCesarPlanApprovalInput,
  isCesarPlanResumeInput, isCesarPlanStatusInput, formatCesarPlanRuntimeStatus,
} from '@kernlang/agon-mod-plan';

/** A05 session-selection binding. Storage and CLI context stay in the host;
 * the physical Plan package owns precedence, discovery and input policy. */
function snapshot(ctx: HandlerContext): PlanSessionSnapshot {
  return { proposedPlan: ctx.cesar?.proposedPlan, activePlan: ctx.activePlan };
}

export function findPendingCesarPlan(ctx: HandlerContext) {
  return selectPendingPlan(snapshot(ctx), listCesarPlans);
}

export function findResumableCesarPlan(ctx: HandlerContext) {
  return selectResumablePlan(snapshot(ctx));
}

export function shouldApprovePendingCesarPlanInput(input: string, ctx: HandlerContext): boolean {
  return shouldApproveSelection(input, snapshot(ctx));
}

// A05-RESUME-POLICY compatibility exports: the Plan package owns the only
// implementation. Remove this seam when dispatch.ts callers use its public API.
export { buildResumePromptContext, skipCompletedSteps } from '@kernlang/agon-mod-plan';

/**
 * Ask a keyboard-choice question in the composer instead of falling back to a blank free-text field.
 */
export function askChoiceQuestion(cb: DispatchCallbacks, prompt: string, choices: any[], defaultChoiceKey?: string): Promise<string> {
  return new Promise<string>((resolve) => {
    cb.dispatch({ type: 'question', prompt, choices, defaultChoiceKey, resolve } as any);
  });
}
