import type { CesarPlan, CesarPlanStep } from './execution-model.js';

export interface ResumePromptContext {
  doneCount: number;
  failedCount: number;
  remainingCount: number;
  failedStep: CesarPlanStep | null;
  remainingCostUsd: number;
  remainingTokens: number;
}

/** Summarize the existing plan without selecting, loading or changing it. */
export function buildResumePromptContext(plan: CesarPlan): ResumePromptContext {
  const steps = plan.steps ?? [];
  const doneCount = steps.filter(s => s.state === 'done' || (s.state === 'skipped' && s.result?.status === 'success')).length;
  const failedSteps = steps.filter(s => s.state === 'failed');
  const remainingSteps = steps.filter(s => s.state !== 'done' && s.state !== 'skipped');
  return {
    doneCount,
    failedCount: failedSteps.length,
    remainingCount: remainingSteps.length,
    failedStep: failedSteps[0] ?? null,
    remainingCostUsd: remainingSteps.reduce((sum, s) => sum + (s.estimatedCostUsd ?? 0), 0),
    remainingTokens: remainingSteps.reduce((sum, s) => sum + (s.estimatedTokens ?? 0), 0),
  };
}

/** Preserve completed work, dependency blocks and exhausted review failures. */
export function skipCompletedSteps(plan: CesarPlan): CesarPlan {
  const applied = plan.steps.find(step => step.state === 'failed' && step.result?.artifact?.status === 'applied');
  if (applied) {
    throw new Error(`Cannot resume: step '${applied.id}' applied a patch before failing. Saved evidence is unchanged. Inspect the workspace before choosing an explicit restart; restarting can repeat completed work.`);
  }
  const interrupted = findUnknownPlanOutcome(plan);
  if (interrupted) {
    throw new Error(`Cannot resume: step '${interrupted.id}' has an outcome that is unknown. Saved plan unchanged. Inspect its effects before choosing an explicit restart; restarting can repeat completed work.`);
  }
  const incomplete = plan.steps.find(step => step.state === 'done' && !step.result);
  if (incomplete) {
    throw new Error(`Cannot resume: completed step '${incomplete.id}' is missing its result. Saved plan unchanged. Inspect the workspace and saved plan before choosing an explicit restart.`);
  }
  const cyclesUsedAtResume = plan.reviewCyclesUsed ?? 0;
  const steps = plan.steps.map((step): CesarPlanStep => {
    if (step.state === 'done' || step.state === 'skipped') return { ...step, state: 'skipped' };
    if (step.state === 'failed' && step.type === 'review' && cyclesUsedAtResume >= 2) return step;
    if (step.state === 'failed') return { ...step, state: 'pending', result: undefined };
    if (step.state === 'blocked') return step;
    return { ...step, state: 'pending' };
  });
  return { ...plan, steps };
}

/** Locate started work without a known result before offering any retry. */
export function findUnknownPlanOutcome(plan: CesarPlan): CesarPlanStep | undefined {
  return plan.steps.find(step => !step.result && (step.state === 'running'
    || (step.state === 'cancelled' && !!step.startedAt)));
}

/** Prepare an already-approved choice without mutating the saved plan. */
export function prepareCesarPlanResume(plan: CesarPlan, mode: 'resume' | 'restart'): CesarPlan {
  if (mode === 'resume') return { ...skipCompletedSteps(plan), state: 'running' };
  const steps = plan.steps.map((step): CesarPlanStep => ({
    ...step,
    state: step.dependsOn && step.dependsOn.length > 0 ? 'blocked' : 'pending',
    result: undefined,
  }));
  return { ...plan, steps, state: 'running', totalActualTokens: 0, totalActualCostUsd: 0 };
}
