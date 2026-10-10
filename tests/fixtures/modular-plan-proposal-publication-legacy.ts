// Frozen before proposal-publication extraction. Keep the workflow body independent.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sanitizePlanSteps } from '@kernlang/agon-core';
import { createCesarPlan, cesarPlanMarkdownPath, formatCesarPlanMarkdown, saveCesarPlan, cancelCesarPlan } from '@kernlang/agon-mod-plan';
import type { CesarPlan } from '@kernlang/agon-mod-plan';
import type { Dispatch, HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { isAgenticAutoMode } from '../../packages/cli/src/cesar/task-controller.js';

export async function handleProposePlan(args: Record<string,unknown>, dispatch: Dispatch, ctx: HandlerContext): Promise<CesarPlan> {
  // Validate LLM-controlled steps at the boundary (core: sanitizePlanSteps).
  // Cesar occasionally emits malformed step objects with no `type`/`description`
  // (phantom entries), or even a non-array `steps`. Those are unexecutable —
  // `plan-executor` returns "No executor for type: undefined" — and worse, they
  // corrupt the plan markdown ("### Step 4: undefined") and crash
  // PlanExecutionView at `s.description.slice()`. The validator drops them,
  // applies the estimator (the only source of truth for cost — Cesar can't
  // self-report to slip past the auto-approve ceiling), and reports the count.
  const { steps, dropped } = sanitizePlanSteps(args.steps);
  // Don't drop silently: the approved plan would differ from what Cesar
  // proposed with no signal. Surface it so the divergence is auditable.
  if (dropped > 0 && dispatch) {
    dispatch({ type: 'info', message: `Dropped ${dropped} malformed plan step${dropped === 1 ? '' : 's'} from the proposal.` } as any);
  }

  let plan = createCesarPlan(typeof args.intent === 'string' ? args.intent : '', steps);
  plan = {
    ...plan,
    // Gemini fix (f1): planningCost is no longer accepted from the LLM.
    // Cost trust model is estimator-only — Cesar cannot self-report cost.
    state: 'awaiting_approval',
    autoApprove: isAgenticAutoMode(ctx) || args.autoApprove === true ? true : undefined,
    selfReview: typeof args.selfReview === 'boolean' ? args.selfReview : undefined,
  };

  const filePath = cesarPlanMarkdownPath(plan.id);
  plan = { ...plan, planFilePath: filePath };
  const markdown = formatCesarPlanMarkdown(plan);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, markdown);
  saveCesarPlan(plan);

  // Supersede AFTER the replacement is safely built + persisted, so a
  // malformed/failed proposal above can never destroy the user's existing
  // approvable plan (codex review). Retire any prior pending proposal on
  // disk — id-guarded so we never cancel the plan we just saved — and clear
  // the stale in-memory proposedPlan ref so no error path observes a ghost
  // awaiting_approval plan (zai review). activePlan is owned by the caller's
  // setActivePlan, which assigns this new plan immediately after we return.
  for (const prior of [ctx.cesar?.proposedPlan, ctx.activePlan]) {
    const p = prior as CesarPlan | undefined;
    if (p && p.state === 'awaiting_approval' && p.id !== plan.id) {
      try { saveCesarPlan(cancelCesarPlan(p)); } catch { /* best-effort supersede cleanup */ }
    }
  }
  if (ctx.cesar?.proposedPlan && (ctx.cesar.proposedPlan as CesarPlan).state === 'awaiting_approval' && (ctx.cesar.proposedPlan as CesarPlan).id !== plan.id) {
    ctx.cesar.proposedPlan = undefined;
  }

  dispatch({ type: 'plan-proposal', plan, markdown, planFilePath: filePath });
  return plan;
}
