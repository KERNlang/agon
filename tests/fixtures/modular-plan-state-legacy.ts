// Frozen state-transition oracle from ced1c014; imports adjusted for the fixture.
import type { CesarPlan, CesarPlanStep, CesarPlanState, CesarStepState, CesarStepResult } from '../../packages/core/src/cesar/plan.js';
import { hostNowIso } from '../../packages/core/src/blocks/host-runtime.js';

/**
 * Create a new CesarPlan in 'planning' state. Steps with dependsOn are marked 'blocked', others 'pending'.
 */
export function createCesarPlan(intent: string, steps: CesarPlanStep[]): CesarPlan {
  const id = `cplan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const initializedSteps = steps.map(s => Object.assign({}, s, {
    state: (s.dependsOn && s.dependsOn.length > 0 ? 'blocked' : 'pending') as CesarStepState,
  }));
  const totalEstimatedTokens = steps.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const totalEstimatedCostUsd = steps.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
  const now = new Date().toISOString();
  return {
    id,
    state: 'planning',
    intent,
    steps: initializedSteps,
    totalEstimatedTokens,
    totalEstimatedCostUsd,
    totalActualTokens: 0,
    totalActualCostUsd: 0,
    stepContext: {},
    createdAt: now,
    updatedAt: now,
    activeStepId: null,
    currentStepId: null,
  };
}

/**
 * Transition plan from 'awaiting_approval' to 'running', set approvedAt.
 */
export function approveCesarPlan(plan: CesarPlan): CesarPlan {
  return { ...plan, state: 'running' as CesarPlanState, approvedAt: hostNowIso(), updatedAt: hostNowIso() };
}

/**
 * Mark a step done/failed, unblock dependents, determine plan state.
 */
export function advanceCesarStep(plan: CesarPlan, stepId: string, result: CesarStepResult): CesarPlan {
  const stepIdx = plan.steps.findIndex(s => s.id === stepId);
  if (stepIdx === -1) return plan;

  const isSuccess = result.status === 'success';
  // 'paused' = the brain is awaiting user input on an already-approved step (NOT a
  // failure). Leave the step PENDING so /plan resume re-runs it; plan.state still
  // goes to 'paused' below (the !isSuccess branch) so the executor loop exits and
  // the REPL returns to idle for the user to respond.
  const isPaused = result.status === 'paused';
  const stepState: CesarStepState = isSuccess ? 'done' : isPaused ? 'pending' : 'failed';

  const now = new Date().toISOString();
  // Paused step is re-set to pending; do NOT attach a result (UI treats
  // step.result !== undefined as "has run") or a completedAt (agon-review).
  let newSteps = plan.steps.map((s, i) =>
    i === stepIdx ? { ...s, state: stepState, result: isPaused ? undefined : result, completedAt: isPaused ? undefined : now } : s,
  );

  // Unblock dependent steps if this step succeeded
  if (isSuccess) {
    newSteps = newSteps.map(s => {
      if (s.state !== 'blocked') return s;
      if (!s.dependsOn || s.dependsOn.length === 0) return s;
      const allDepsDone = s.dependsOn.every(depId => {
        const dep = newSteps.find(d => d.id === depId);
        return dep && dep.state === 'done';
      });
      return allDepsDone ? { ...s, state: 'pending' as CesarStepState } : s;
    });
  }

  // Accumulate actual costs
  const totalActualTokens = plan.totalActualTokens + result.actualTokens;
  const totalActualCostUsd = plan.totalActualCostUsd + result.actualCostUsd;

  // Determine plan state
  let newState: CesarPlanState = plan.state;
  let completedAt = plan.completedAt;

  if (!isSuccess) {
    newState = 'paused';
  } else {
    const allDone = newSteps.every(s => s.state === 'done' || s.state === 'skipped');
    if (allDone) {
      newState = 'done';
      completedAt = new Date().toISOString();
    }
  }

  return {
    ...plan,
    steps: newSteps,
    state: newState,
    totalActualTokens,
    totalActualCostUsd,
    completedAt,
    updatedAt: now,
    activeStepId: null,
    currentStepId: null,
  };
}

/**
 * Cancel the plan: mark all non-complete steps as cancelled.
 */
export function cancelCesarPlan(plan: CesarPlan): CesarPlan {
  const newSteps = plan.steps.map(s => {
    if (s.state === 'done' || s.state === 'failed') return s;
    return { ...s, state: 'cancelled' as CesarStepState };
  });
  return {
    ...plan,
    steps: newSteps,
    state: 'cancelled' as CesarPlanState,
    updatedAt: new Date().toISOString(),
    activeStepId: null,
    currentStepId: null,
  };
}

/**
 * Archive a plan when Cesar leaves plan mode via ExitPlanMode. Cancels it (same step handling as cancelCesarPlan) and records the exit reason + timestamp so the exit is auditable. The pending proposal is preserved on disk as a cancelled record rather than erased.
 */
export function exitCesarPlan(plan: CesarPlan, reason: string): CesarPlan {
  const cancelled = cancelCesarPlan(plan);
  return {
    ...cancelled,
    exitReason: reason && reason.trim() ? reason.trim() : 'no reason given',
    exitedAt: new Date().toISOString(),
  };
}
