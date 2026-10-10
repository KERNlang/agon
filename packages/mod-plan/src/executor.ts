import type { CesarPlan, CesarPlanStep, CesarStepResult } from './execution-model.js';
import { advanceCesarStep } from './execution-state.js';

export interface PlanExecutionServices {
  /** Best-effort estimation history, not billing or required result storage. */
  recordStepCompletion(stepType: string, actualTokens: number, actualCostUsd: number): void;
  onEstimationError?(stepType: string, error: unknown): void;
}

export interface StepExecutor {
  execute: (step:CesarPlanStep, context:Record<string,string|undefined>, signal?:AbortSignal)=>Promise<{result:CesarStepResult,contextExport?:string}>;
}

export interface PlanExecutorCallbacks {
  /** Required storage boundary when supplied by a persistent host. Unlike UI
   * callbacks, failure must stop execution before another effect starts. */
  onCheckpoint?: (plan:CesarPlan)=>void;
  onStepStart: (stepId:string)=>void;
  onStepDone: (stepId:string, result:CesarStepResult)=>void;
  onPlanUpdate: (plan:CesarPlan)=>void;
  onBudgetWarning: (actual:number, estimated:number)=>void;
  summarizeStepOutput?: (stepId:string, output:string)=>Promise<string>;
}

export function getReadySteps(plan: CesarPlan): CesarPlanStep[] {
  return plan.steps.filter((s) => s.state === 'pending');
}

const cancelledBeforeStart = (): CesarStepResult => ({ status: 'failure', actualTokens: 0,
  actualCostUsd: 0, durationMs: 0, output: '', error: 'cancelled before start' });

export function createPlanExecutor(services: PlanExecutionServices) {
  const recordCompletion = (stepType: string, result: CesarStepResult) => {
    try { services.recordStepCompletion(stepType, result.actualTokens, result.actualCostUsd); }
    catch (error) {
      // A history sink cannot turn a completed workspace mutation into a
      // retryable failure or discard another completed parallel result.
      try { services.onEstimationError?.(stepType, error); } catch { /* reporting only */ }
    }
  };
  return async function executePlan(plan: CesarPlan, executors: Record<string,StepExecutor>, callbacks: PlanExecutorCallbacks, signal?: AbortSignal): Promise<CesarPlan> {
    let current = plan;
    const markStepsRunning = (target: CesarPlan, stepIds: string[]) => {
      if (stepIds.length === 0) return target;
      const selected = new Set(stepIds);
      const now = new Date().toISOString();
      const activeStepId = stepIds.length === 1 ? stepIds[0] : null;
      return {
        ...target,
        steps: target.steps.map((s) => selected.has(s.id) ? { ...s, state: 'running' as const, startedAt: s.startedAt ?? now } : s),
        updatedAt: now,
        activeStepId,
        currentStepId: activeStepId,
      };
    };

    const runStep = async (step: CesarPlanStep) => {
      let result = cancelledBeforeStart();
      let contextExport: string | undefined;
      let executed = false;
      let attempted = false;
      if (!signal?.aborted) {
        callbacks.onStepStart(step.id);
        if (!signal?.aborted) {
          const executor = executors[step.type];
          if (!executor) {
            result = { ...result, error: `No executor for type: ${step.type}` };
          } else {
            attempted = true;
            try {
              ({ result, contextExport } = await executor.execute(step, current.stepContext, signal));
              executed = true;
            } catch (error) {
              result = { ...result, error: error instanceof Error ? error.message : String(error) };
            }
          }
        }
      }
      const exportContext = (output: string) => {
        const updates = Object.fromEntries((step.exports ?? []).map(key => [key, output]));
        current = { ...current, stepContext: { ...current.stepContext, ...updates } };
      };
      if (contextExport && step.exports?.length) exportContext(contextExport);
      current = advanceCesarStep(current, step.id, result);
      // Save the raw outcome before optional work or slower siblings. A storage
      // failure must not become a synthetic backend failure.
      callbacks.onCheckpoint?.(current);
      if (contextExport && step.exports?.length && callbacks.summarizeStepOutput) {
        let summary = contextExport;
        try { summary = await callbacks.summarizeStepOutput(step.id, contextExport); }
        catch { /* Keep the raw export if summarization fails. */ }
        exportContext(summary);
        if (summary !== contextExport && !signal?.aborted) callbacks.onCheckpoint?.(current);
      }
      return { stepId: step.id, result, executed, attempted };
    };

    try {
      while (current.state === 'running') {
        if (signal?.aborted) break;

        const ready = getReadySteps(current);
        if (ready.length === 0) {
          const complete = current.steps.length > 0 && current.steps.every(step => step.state === 'done' || step.state === 'skipped');
          current = { ...current, state: complete ? 'done' : 'paused',
            completedAt: complete ? current.completedAt ?? new Date().toISOString() : undefined,
            activeStepId: null, currentStepId: null };
          callbacks.onCheckpoint?.(current);
          callbacks.onPlanUpdate(current);
          break;
        }

        const parallelSteps = ready.filter((s) => s.parallel);
        const sequentialSteps = ready.filter((s) => !s.parallel);

        // Execute parallel steps concurrently
        if (parallelSteps.length > 0) {
          current = markStepsRunning(current, parallelSteps.map((s) => s.id));
          callbacks.onCheckpoint?.(current);
          callbacks.onPlanUpdate(current);
          // Drain every started backend even if one checkpoint fails.
          const results = await Promise.allSettled(parallelSteps.map(runStep));
          const failure = results.find(item => item.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
          for (const item of results) {
            if (item.status !== 'fulfilled') continue;
            const { stepId, result, executed } = item.value;
            callbacks.onStepDone(stepId, result);
            const stepType = current.steps.find((s) => s.id === stepId)?.type ?? 'unknown';
            if (executed) recordCompletion(stepType, result);
          }
        }

        // Execute first sequential step
        if (sequentialSteps.length > 0 && current.state === 'running' && !signal?.aborted) {
          const step = sequentialSteps[0];
          current = markStepsRunning(current, [step.id]);
          callbacks.onCheckpoint?.(current);
          callbacks.onPlanUpdate(current);
          const { result, executed, attempted } = await runStep(step);
          callbacks.onStepDone(step.id, result);
          if (executed) recordCompletion(step.type, result);
          if (!attempted) continue;
        }

        // Budget check
        if (current.totalActualCostUsd > 0 && current.totalEstimatedCostUsd > 0) {
          const ratio = current.totalActualCostUsd / current.totalEstimatedCostUsd;
          const threshold = current.totalEstimatedCostUsd > 5 ? 1.25 : current.totalEstimatedCostUsd > 1 ? 1.5 : 2.0;
          if (ratio > threshold) {
            callbacks.onBudgetWarning(current.totalActualCostUsd, current.totalEstimatedCostUsd);
          }
        }

        callbacks.onPlanUpdate(current);
      }

      if (signal?.aborted && current.state === 'running') {
        current = {
          ...current,
          state: 'paused' as const,
          updatedAt: new Date().toISOString(),
          activeStepId: null,
          currentStepId: null,
        };
        callbacks.onCheckpoint?.(current);
        callbacks.onPlanUpdate(current);
      }

      return current;
    } catch (error) {
      // Preserve the scheduler's complete checkpoint, including exports, when
      // an observer fails before the normal loop-end update.
      try { callbacks.onPlanUpdate(current); } catch { /* retain original fault */ }
      throw error;
    }
  };
}
