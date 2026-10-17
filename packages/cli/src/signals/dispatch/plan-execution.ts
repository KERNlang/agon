import type { CesarPlan } from '@kernlang/agon-mod-plan';
import type { DispatchCallbacks } from '../dispatch.js';
import { createPlanExecutionSession } from '../../blocks/plan-execution-effects.js';

/** Compatibility entry points delegate to the physical Plan session owner. */
export async function resumeCesarPlan(plan: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  await createPlanExecutionSession(cb).resume(plan);
}

export async function approvePendingCesarPlan(cb: DispatchCallbacks): Promise<boolean> {
  return createPlanExecutionSession(cb).approvePending();
}

export function cancelPendingCesarPlan(cb: DispatchCallbacks): boolean {
  return createPlanExecutionSession(cb).cancelPending();
}

export async function handleProposedCesarPlan(proposed: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  await createPlanExecutionSession(cb).propose(proposed);
}

export function buildPlanCallbacks(initialPlan: CesarPlan, cb: DispatchCallbacks) {
  return createPlanExecutionSession(cb).callbacks(initialPlan);
}

export async function executeApprovedPlan(approved: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  await createPlanExecutionSession(cb).execute(approved);
}
