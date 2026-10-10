
import { writeFileSync } from 'node:fs';

import { resolveWorkingDir } from '@kernlang/agon-core';
import { inspectWorkingTree } from '@kernlang/agon-support-worktree';

import { approveCesarPlan, saveCesarPlan, executePlan, formatCesarPlanMarkdown, planCostEstimator, appendMessage } from '@kernlang/agon-core';
import { rejectPlanProposal, activatePlanProposal } from '@kernlang/agon-mod-plan';

import type { CesarPlan, CesarStepResult, StepExecutor } from '@kernlang/agon-core';

import { buildStepExecutors } from '../../handlers/plan-mode.js';

import { applyAutoApprovePolicy, applyAgenticAutoApprovePolicy } from '../../cesar/auto-approve-policy.js';

import { isAgenticAutoMode } from '../../cesar/task-controller.js';

import { todosFromPlanSteps } from '../todos.js';

import type { DispatchCallbacks } from '../dispatch.js';

import { findPendingCesarPlan, askChoiceQuestion } from './plan-queries.js';
import { runPlanResumeApproval, createPlanCoordinator } from '@kernlang/agon-mod-plan';

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
export function buildPlanCallbacks(initialPlan: CesarPlan, cb: DispatchCallbacks): any {
  let currentPlan = initialPlan;
  let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let executionStartCommitted = false;
  const DEBOUNCE_MS = 300;
  const stepTypeLabels: Record<string, string> = {
    self: '\u2699 Cesar',
    forge: '\u2694 Forge',
    teamforge: '\u2694\u2694 Team Forge',
    brainstorm: '\u26a1 Brainstorm',
    campfire: '\u2500 Campfire',
    tribunal: '\u2696 Tribunal',
    delegate: '\u27a4 Delegate',
    pipeline: '\u2192 Pipeline',
    review: '\u2713 Review',
    agent: '\u2699 Agent',
    'team-agent': '\u2699\u2699 Team Agent',
  };
  
  const markStepRunning = (plan: CesarPlan, stepId: string): CesarPlan => ({
    ...plan,
    steps: plan.steps.map((s: any) => s.id === stepId ? { ...s, state: 'running' as any, startedAt: s.startedAt ?? new Date().toISOString() } : s),
    updatedAt: new Date().toISOString(),
    activeStepId: stepId,
    currentStepId: stepId,
  } as CesarPlan);
  
  const buildPlanStepToolInput = (stepId: string) => {
    const step = currentPlan.steps.find((s: any) => s.id === stepId);
    const idx = step ? currentPlan.steps.indexOf(step) + 1 : 0;
    return {
      planId: currentPlan.id,
      stepId,
      step: idx,
      totalSteps: currentPlan.steps.length,
      type: step?.type ?? 'unknown',
      engine: step?.engine ?? null,
      engines: step?.engines ?? [],
      description: step?.description ?? stepId,
      state: step?.state ?? 'pending',
    };
  };
  
  const planStepEngineId = (step: any) => step?.engine ?? step?.engines?.[0] ?? 'cesar';
  
  const flushPersist = () => {
    if (pendingWriteTimer) {
      clearTimeout(pendingWriteTimer);
      pendingWriteTimer = null;
    }
    try { saveCesarPlan(currentPlan); } catch (err) { console.warn('[plan] saveCesarPlan failed:', (err as Error).message ?? err); }
    if (currentPlan.planFilePath) {
      try {
        writeFileSync(currentPlan.planFilePath, formatCesarPlanMarkdown(currentPlan));
      } catch (err) { console.warn('[plan] failed to write plan file:', (err as Error).message ?? err); }
    }
  };
  
  cb.dispatch({ type: 'todos-set', todos: todosFromPlanSteps(initialPlan.steps) } as any);
  
  return {
    onStepStart: (stepId: string) => {
      currentPlan = markStepRunning(currentPlan, stepId);
      cb.setActivePlan(currentPlan);
      const step = currentPlan.steps.find((s: any) => s.id === stepId);
      const typeLabel = step ? (stepTypeLabels[step.type] ?? step.type) : '';
      const stepEngines = step?.engines?.length ? ` \u2192 ${step.engines.join(', ')}` : (step?.engine ? ` \u2192 ${step.engine}` : '');
      const idx = step ? currentPlan.steps.indexOf(step) + 1 : 0;
      const msg = `Step ${idx}/${currentPlan.steps.length}: ${typeLabel}${stepEngines} \u2014 ${step?.description ?? stepId}`;
      cb.dispatch({ type: 'spinner-start', message: msg, color: 214, engineId: planStepEngineId(step) } as any);
      cb.dispatch({
        type: 'tool-call',
        engineId: 'cesar',
        tool: 'PlanStep',
        input: JSON.stringify(buildPlanStepToolInput(stepId)),
        status: 'running',
      } as any);
      cb.dispatch({ type: 'info', message: msg });
      cb.dispatch({ type: 'todos-update', id: stepId, state: 'running' } as any);
    },
    onStepDone: (stepId: string, result: CesarStepResult) => {
      const step = currentPlan.steps.find((s: any) => s.id === stepId);
      // 'paused' = brain awaiting user input on an approved step \u2014 a deliberate
      // pause-to-idle, NOT a failure. Render it neutrally (no red \u2717) and leave the
      // todo pending so /plan resume re-runs the step.
      const isPausedResult = result.status === 'paused';
      const icon = result.status === 'success' ? '\u2713' : isPausedResult ? '\u23f8' : '\u2717';
      const msgType = result.status === 'success' ? 'success' : isPausedResult ? 'warning' : 'error';
      cb.dispatch({ type: 'spinner-stop' } as any);
      cb.dispatch({
        type: 'tool-call',
        engineId: 'cesar',
        tool: 'PlanStep',
        input: JSON.stringify(buildPlanStepToolInput(stepId)),
        status: result.status === 'success' || isPausedResult ? 'done' : 'error',
        output: result.output ? result.output.slice(0, 4000) : '',
        error: isPausedResult ? undefined : result.error,
      } as any);
      cb.dispatch({ type: msgType, message: `${icon} ${step?.description ?? stepId} \u2014 ${result.status}${result.error ? ': ' + result.error : ''} (${(result.durationMs / 1000).toFixed(1)}s, $${result.actualCostUsd.toFixed(4)})` });
      cb.dispatch({ type: 'todos-update', id: stepId, state: result.status === 'success' ? 'done' : isPausedResult ? 'pending' : 'failed', note: result.error ? result.error.slice(0, 80) : undefined } as any);
    },
    onPlanUpdate: (updated: CesarPlan) => {
      const previousState = currentPlan.state;
      currentPlan = updated;
      cb.setActivePlan(updated);
      // Terminal states flush immediately so disk reflects the final
      // state without waiting on the debounce window.
      const isTerminal = updated.state === 'done' || updated.state === 'paused' || updated.state === 'cancelled';
      const shouldCommitExecutionRow = !executionStartCommitted || isTerminal || previousState !== updated.state;
      if (shouldCommitExecutionRow) {
        executionStartCommitted = true;
        cb.dispatch({ type: 'plan-execution', plan: updated });
      }
      if (isTerminal) {
        cb.dispatch({ type: 'spinner-stop' } as any);
        cb.dispatch({ type: 'todos-set', todos: todosFromPlanSteps(updated.steps) } as any);
        flushPersist();
        return;
      }
      if (pendingWriteTimer) clearTimeout(pendingWriteTimer);
      pendingWriteTimer = setTimeout(flushPersist, DEBOUNCE_MS);
    },
    onBudgetWarning: (actual: number, estimated: number) => {
      cb.dispatch({ type: 'warning', message: `Budget warning: $${actual.toFixed(2)} actual vs $${estimated.toFixed(2)} estimated` });
    },
    summarizeStepOutput: async (stepId: string, output: string) => {
      if (output.length <= 500) return output;
      return output.slice(0, 500) + `\n\n[... truncated from ${output.length} chars. Full output in step ${stepId}]`;
    },
    // FU-3: exposed so executeApprovedPlan can drain pending writes
    // before the helper exits (otherwise the final state could be lost
    // if the caller exits within the 300ms debounce window).
    flush: flushPersist,
  };
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

export async function finalizePlanWithReviewGate(finalPlan: CesarPlan, executors: Record<string, StepExecutor>, abortSignal: AbortSignal, cb: DispatchCallbacks): Promise<CesarPlan> {
  return planCoordinator(cb).finalizePlanWithReviewGate(finalPlan, executors, abortSignal);
}

export { failedPlanStepIsFallbackRetryable, preparePlanFallbackRetry } from '@kernlang/agon-mod-plan';
