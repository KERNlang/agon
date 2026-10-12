
import { writeFileSync } from 'node:fs';

import { resolveWorkingDir } from '@kernlang/agon-core';
import { inspectWorkingTree } from '@kernlang/agon-support-worktree';

import { approveCesarPlan, saveCesarPlan, executePlan, formatCesarPlanMarkdown, planCostEstimator, appendMessage } from '@kernlang/agon-core';
import { rejectPlanProposal, activatePlanProposal } from '@kernlang/agon-mod-plan';

import type { CesarPlan } from '@kernlang/agon-core';

import { buildStepExecutors } from '../../handlers/plan-mode.js';

import { applyAutoApprovePolicy, applyAgenticAutoApprovePolicy } from '../../cesar/auto-approve-policy.js';

import { isAgenticAutoMode } from '../../cesar/task-controller.js';

import { todosFromPlanSteps } from '../todos.js';

import type { DispatchCallbacks } from '../dispatch.js';

import { findPendingCesarPlan, askChoiceQuestion } from './plan-queries.js';
import { runPlanResumeApproval, createPlanCoordinator, createPlanCallbacks } from '@kernlang/agon-mod-plan';

import { hostConsoleWarn } from '../../lib/kern-host.js';
import { takePlanFallback } from '../plan-fallback.js';
import { assertProcessSurfaceAvailable, captureProcessSurfaceAuthority } from '../../surface-authority-runtime.js';

/** Compatibility entry points must not bypass the selected Plan owner. */
function planExecutionAvailable(cb: DispatchCallbacks, assertCurrent?: () => void): boolean {
  try {
    assertCurrent?.();
    assertProcessSurfaceAvailable('tui', '/plan');
    return true;
  } catch (error) {
    cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Resume a paused or stale-running Cesar plan through the shared executor path. Shows a resume prompt with context before executing.
 */
export async function resumeCesarPlan(plan: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  if (!planExecutionAvailable(cb)) return;
  let assertCurrent: () => void;
  try { assertCurrent = captureProcessSurfaceAuthority(); }
  catch (error) {
    cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    return;
  }
  await runPlanResumeApproval(plan, {
    available: () => planExecutionAvailable(cb, assertCurrent),
    notify: (type, message) => cb.dispatch({ type, message }),
    choose: (prompt, choices, defaultKey) => askChoiceQuestion(cb, prompt, choices, defaultKey),
    execute: value => executeApprovedPlan(value, cb),
  });
}

/**
 * Approve and execute the pending CesarPlan, if one exists. Backs /approve and natural approval aliases like go.
 */
export async function approvePendingCesarPlan(cb: DispatchCallbacks): Promise<boolean> {
  const pending = findPendingCesarPlan(cb.ctx);
  if (!pending) {
    return false;
  }
  const approved = approveCesarPlan(pending);
  await executeApprovedPlan(approved, cb);
  return true;
}

/**
 * Reject the pending CesarPlan, if one exists. This is the Cesar half of /cancel, mirroring approvePendingCesarPlan for /approve: BOTH real reject routes land here — typing /cancel, and the pinned PlanApprovalPrompt's '3. Reject' row (app-keyboard.kern planControl submits '/cancel'). Without it, /cancel fell straight through to the legacy plan-runner handleCancel, which only knows ctx.currentPlan, so rejecting a Cesar proposal answered 'No active plan to cancel.' and left the approval prompt pinned forever. Returns false when there is no Cesar proposal so the caller still falls through to the legacy runner. Dispatches plan-cancelled (releases the pinned prompt), persists the cancelled record + markdown so the on-disk plan stops reading awaiting_approval, and appends a rejection note to the chat session so Cesar's next turn knows the plan was refused instead of silently re-proposing it.
 */
export function cancelPendingCesarPlan(cb: DispatchCallbacks): boolean {
  return rejectPlanProposal(findPendingCesarPlan(cb.ctx), {
    clearProposal: id => {
      if (cb.ctx.cesar?.proposedPlan?.id === id) cb.ctx.cesar.proposedPlan = undefined;
    },
    setActive: plan => cb.setActivePlan(plan),
    persist: saveCesarPlan,
    writeMarkdown: plan => writeFileSync(plan.planFilePath!, formatCesarPlanMarkdown(plan)),
    cancelled: plan => cb.dispatch({ type: 'plan-cancelled', plan }),
    notify: message => cb.dispatch({ type: 'success', message }),
    recordRejection: content => {
      if (cb.ctx.chatSession) appendMessage(cb.ctx.chatSession, {
        role: 'user', content, timestamp: new Date().toISOString(),
      });
    },
    warn: hostConsoleWarn,
  });
}

/**
 * Activate a proposed Cesar plan. Auto-approved plans execute immediately; manual approval is intentionally non-blocking so the REPL returns to idle and accepts go, yes, or /approve through the normal composer.
 */
export async function handleProposedCesarPlan(proposed: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  await activatePlanProposal(proposed, {
    policy: plan => {
      if (!planExecutionAvailable(cb)) return { approve: false,
        reason: 'Plan is unavailable in the selected modular generation', adjustedCostUsd: plan.totalEstimatedCostUsd };
      return isAgenticAutoMode(cb.ctx)
        ? applyAgenticAutoApprovePolicy(plan, cb.ctx.config, cb.ctx.cesar?.taskExecutionLease)
        : applyAutoApprovePolicy(plan, cb.ctx.config);
    },
    notify: (type, message) => cb.dispatch({ type, message }),
    execute: plan => executePlanInvocation(plan, cb),
    setActive: plan => cb.setActivePlan(plan),
    clearProposal: id => {
      if (cb.ctx.cesar?.proposedPlan?.id === id) cb.ctx.cesar.proposedPlan = undefined;
    },
  });
}

/**
 * Build executor callbacks. Holds a closure on the latest plan reference (mutated via onPlanUpdate) so step lookups always see appended steps like the auto-review cycle (tribunal fix #10). FU-3: persistence is debounced 300ms to avoid the sync-write storm Doppelganger flagged — onPlanUpdate fires once per step in a hot loop, but the disk write happens at most ~3x/sec. Terminal states (done/paused/cancelled) flush immediately so the .md/.json on disk reflect the final state. Callers should invoke .flush() before exit to drain any pending write.
 */
export function buildPlanCallbacks(initialPlan: CesarPlan, cb: DispatchCallbacks) {
  return createPlanCallbacks(initialPlan, {
    dispatch: event => cb.dispatch(event),
    setActivePlan: plan => cb.setActivePlan(plan),
    todos: todosFromPlanSteps,
    save: saveCesarPlan,
    writeMarkdown: (path, markdown) => writeFileSync(path, markdown),
    warn: (message, error) => console.warn(message, error),
  });
}

/** Temporary CLI effect adapter; the Plan package owns execution control. */
function planCoordinator(cb: DispatchCallbacks) {
  return createPlanCoordinator({
    createExecutors: () => buildStepExecutors(cb.ctx, cb.dispatch),
    executePlan,
    callbacks: plan => buildPlanCallbacks(plan, cb),
    setActivePlan: plan => cb.setActivePlan(plan),
    reportVerifiedPlan: plan => {
      cb.dispatch({ type: 'plan-execution', plan });
      cb.dispatch({ type: 'spinner-stop' } as any);
      cb.dispatch({ type: 'todos-set', todos: todosFromPlanSteps(plan.steps) } as any);
    },
    setAbort: controller => cb.ctx.setActiveAbort?.(controller),
    releaseAbort: controller => cb.ctx.setActiveAbort?.(null, controller),
    save: plan => {
      saveCesarPlan(plan);
      // Do not consume the pending proposal until execution state is durable.
      if (plan.state === 'running' && cb.ctx.cesar?.proposedPlan?.id === plan.id) cb.ctx.cesar.proposedPlan = undefined;
    },
    writeMarkdown: plan => {
      if (plan.planFilePath) writeFileSync(plan.planFilePath, formatCesarPlanMarkdown(plan));
    },
    hasWorkingTreeChanges: () => {
      const state = inspectWorkingTree(resolveWorkingDir());
      if (!state.ok) throw new Error(state.error);
      return state.dirtyTree;
    },
    estimateReview: () => planCostEstimator.estimate('review', []),
    takeFallback: takePlanFallback,
    notify: (type, message) => cb.dispatch({ type, message }),
    warn: (message, error) => hostConsoleWarn(`${message} ${error instanceof Error ? error.message : String(error)}`),
  });
}

/** Return whether authority accepted the invocation, not whether its work succeeded. */
async function executePlanInvocation(approved: CesarPlan, cb: DispatchCallbacks): Promise<boolean> {
  if (!planExecutionAvailable(cb)) return false;
  await planCoordinator(cb).executeApprovedPlan(approved);
  return true;
}

/** Preserve the existing public result while sharing the guarded invocation. */
export async function executeApprovedPlan(approved: CesarPlan, cb: DispatchCallbacks): Promise<void> {
  await executePlanInvocation(approved, cb);
}
