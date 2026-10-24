// Frozen callback policy before physical extraction; blank-line spaces removed.
// Source: 5a0e9b8c, plan-execution.ts buildPlanCallbacks (without its final newline).
// Source SHA-256: 8b423f49a28a51ea96c26006bb3491d5f07be191076994703fe795bbd35b3471
import { writeFileSync } from 'node:fs';
import { saveCesarPlan, formatCesarPlanMarkdown } from '@kernlang/agon-core';
import type { CesarPlan, CesarStepResult } from '@kernlang/agon-core';
import { todosFromPlanSteps } from '../../packages/cli/src/signals/todos.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
export function buildLegacyPlanCallbacks(initialPlan: CesarPlan, cb: DispatchCallbacks): any {
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
