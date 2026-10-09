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

    try {
      while (current.state === 'running') {
        if (signal?.aborted) break;

        const ready = getReadySteps(current);
        if (ready.length === 0) {
          const complete = current.steps.length > 0 && current.steps.every(step => step.state === 'done' || step.state === 'skipped');
          current = { ...current, state: complete ? 'done' : 'paused',
            completedAt: complete ? current.completedAt ?? new Date().toISOString() : undefined,
            activeStepId: null, currentStepId: null };
          callbacks.onPlanUpdate(current);
          break;
        }

        const parallelSteps = ready.filter((s) => s.parallel);
        const sequentialSteps = ready.filter((s) => !s.parallel);

        // Execute parallel steps concurrently
        if (parallelSteps.length > 0) {
          current = markStepsRunning(current, parallelSteps.map((s) => s.id));
          callbacks.onPlanUpdate(current);
          const results = await Promise.all(parallelSteps.map(async (step) => {
            // FU-3: per-task abort check. Without this the parallel batch
            // is uninterruptible — a Ctrl-C mid-batch waits for the slowest
            // task before propagating. Now each task short-circuits immediately.
            if (signal?.aborted) {
              return { stepId: step.id, result: cancelledBeforeStart(), executed: false };
            }
            callbacks.onStepStart(step.id);
            if (signal?.aborted) return { stepId: step.id, result: cancelledBeforeStart(), executed: false };
            const executor = executors[step.type];
            if (!executor) {
              return { stepId: step.id, result: { status: 'failure' as const, actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: `No executor for type: ${step.type}` } as CesarStepResult, executed: false };
            }
            try {
              const { result, contextExport } = await executor.execute(step, current.stepContext, signal);
              if (contextExport && step.exports && step.exports.length > 0) {
                let summary = contextExport;
                if (callbacks.summarizeStepOutput) {
                  try { summary = await callbacks.summarizeStepOutput(step.id, contextExport); } catch { /* summarizer unavailable — use raw context */ }
                }
                const exportUpdates: Record<string, string> = {};
                for (const key of step.exports) { exportUpdates[key] = summary; }
                current = { ...current, stepContext: { ...current.stepContext, ...exportUpdates } };
              }
              return { stepId: step.id, result, executed: true };
            } catch (err) {
              return { stepId: step.id, result: { status: 'failure' as const, actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: err instanceof Error ? err.message : String(err) } as CesarStepResult, executed: false };
            }
          }));

          for (const { stepId, result } of results) {
            current = advanceCesarStep(current, stepId, result);
          }
          // Checkpoint the entire completed batch before an observer can fail.
          for (const { stepId, result, executed } of results) {
            callbacks.onStepDone(stepId, result);
            const stepType = current.steps.find((s) => s.id === stepId)?.type ?? 'unknown';
            if (executed) recordCompletion(stepType, result);
          }
        }

        // Execute first sequential step
        if (sequentialSteps.length > 0 && current.state === 'running' && !signal?.aborted) {
          const step = sequentialSteps[0];
          current = markStepsRunning(current, [step.id]);
          callbacks.onPlanUpdate(current);
          callbacks.onStepStart(step.id);
          if (signal?.aborted) {
            const result = cancelledBeforeStart();
            current = advanceCesarStep(current, step.id, result);
            callbacks.onStepDone(step.id, result);
            continue;
          }
          const executor = executors[step.type];
          if (!executor) {
            const result: CesarStepResult = { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: `No executor for type: ${step.type}` };
            current = advanceCesarStep(current, step.id, result);
            callbacks.onStepDone(step.id, result);
            continue;
          }
          let result: CesarStepResult;
          let executed = false;
          try {
            const output = await executor.execute(step, current.stepContext, signal);
            result = output.result;
            const { contextExport } = output;
            if (contextExport && step.exports && step.exports.length > 0) {
              let summary = contextExport;
              if (callbacks.summarizeStepOutput) {
                try { summary = await callbacks.summarizeStepOutput(step.id, contextExport); } catch { /* summarizer unavailable — use raw context */ }
              }
              const exportUpdates: Record<string, string> = {};
              for (const key of step.exports) { exportUpdates[key] = summary; }
              current = { ...current, stepContext: { ...current.stepContext, ...exportUpdates } };
            }
            executed = true;
          } catch (err) {
            result = { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: err instanceof Error ? err.message : String(err) };
          }
          current = advanceCesarStep(current, step.id, result);
          callbacks.onStepDone(step.id, result);
          if (executed) recordCompletion(step.type, result);
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
