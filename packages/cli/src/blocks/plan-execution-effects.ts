import { writeFileSync } from 'node:fs';
import { resolveWorkingDir, saveCesarPlan, formatCesarPlanMarkdown, appendMessage } from '@kernlang/agon-core';
import { inspectWorkingTree } from '@kernlang/agon-support-worktree';
import { createPlanExecutionSession as createSession, listCesarPlans } from '@kernlang/agon-mod-plan';
import { buildStepExecutors } from '../handlers/plan-mode.js';
import { isAgenticAutoMode } from '../cesar/task-controller.js';
import { evaluateTaskAction } from '../cesar/task-execution-lease.js';
import { todosFromPlanSteps } from '../signals/todos.js';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { askChoiceQuestion } from '../signals/dispatch/plan-queries.js';
import { hostConsoleWarn } from '../lib/kern-host.js';
import { takePlanFallback } from '../signals/plan-fallback.js';
import { assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, processPlanRuntime } from '../surface-authority-runtime.js';

/** Bind raw CLI state and effects; the physical Plan owner selects workflows. */
export function createPlanExecutionSession(cb: DispatchCallbacks) {
  return createSession({
    assertAvailable: () => assertProcessSurfaceAvailable('tui', '/plan'),
    captureAuthority: captureProcessSurfaceAuthority,
    snapshot: () => ({ proposedPlan: cb.ctx.cesar?.proposedPlan, activePlan: cb.ctx.activePlan }),
    listSaved: listCesarPlans,
    approval: () => {
      const agentic = isAgenticAutoMode(cb.ctx);
      const lease = agentic ? cb.ctx.cesar?.taskExecutionLease : undefined;
      return { config: cb.ctx.config, agentic,
        evaluateAction: lease ? (action, text) => evaluateTaskAction(lease, action, text) : undefined };
    },
    approvalEffects: { estimateReviewCostUsd: () => processPlanRuntime().estimator.estimate('review', []).costUsd },
    choose: (prompt, choices, defaultKey) => askChoiceQuestion(cb, prompt, choices, defaultKey),
    callbacks: {
      dispatch: event => cb.dispatch(event),
      setActivePlan: plan => cb.setActivePlan(plan),
      todos: todosFromPlanSteps, save: saveCesarPlan,
      writeMarkdown: (path, markdown) => writeFileSync(path, markdown),
      warn: (message, error) => console.warn(message, error),
    },
    rejection: {
      clearProposal: id => {
        if (cb.ctx.cesar?.proposedPlan?.id === id) cb.ctx.cesar.proposedPlan = undefined;
      },
      setActive: plan => cb.setActivePlan(plan), persist: saveCesarPlan,
      writeMarkdown: plan => writeFileSync(plan.planFilePath!, formatCesarPlanMarkdown(plan)),
      cancelled: plan => cb.dispatch({ type: 'plan-cancelled', plan }),
      notify: message => cb.dispatch({ type: 'success', message }),
      recordRejection: content => {
        if (cb.ctx.chatSession) appendMessage(cb.ctx.chatSession, {
          role: 'user', content, timestamp: new Date().toISOString(),
        });
      },
      warn: hostConsoleWarn,
    },
    coordinator: {
      createExecutors: () => buildStepExecutors(cb.ctx, cb.dispatch),
      executePlan: (...args) => processPlanRuntime().executePlan(...args),
      setActivePlan: plan => cb.setActivePlan(plan),
      reportVerifiedPlan: plan => {
        cb.dispatch({ type: 'plan-execution', plan });
        cb.dispatch({ type: 'spinner-stop' } as any);
        cb.dispatch({ type: 'todos-set', todos: todosFromPlanSteps(plan.steps) } as any);
      },
      setAbort: controller => cb.ctx.setActiveAbort?.(controller),
      releaseAbort: controller => cb.ctx.setActiveAbort?.(null, controller),
      save: saveCesarPlan,
      clearProposal: id => {
        if (cb.ctx.cesar?.proposedPlan?.id === id) cb.ctx.cesar.proposedPlan = undefined;
      },
      writeMarkdown: plan => {
        if (plan.planFilePath) writeFileSync(plan.planFilePath, formatCesarPlanMarkdown(plan));
      },
      hasWorkingTreeChanges: () => {
        const state = inspectWorkingTree(resolveWorkingDir());
        if (!state.ok) throw new Error(state.error);
        return state.dirtyTree;
      },
      estimateReview: () => processPlanRuntime().estimator.estimate('review', []), takeFallback: takePlanFallback,
      notify: (type, message) => cb.dispatch({ type, message }),
      warn: (message, error) => hostConsoleWarn(`${message} ${error instanceof Error ? error.message : String(error)}`),
    },
  });
}
