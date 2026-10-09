import type { CesarPlan, CesarPlanStep } from './execution-model.js';
import type { PlanExecutorCallbacks, StepExecutor } from './executor.js';
import { advanceCesarStep, cancelCesarPlan } from './execution-state.js';

const MUTATING = new Set(['forge', 'teamforge', 'pipeline', 'agent', 'team-agent', 'delegate', 'self']);
const FORGE_LIKE = new Set(['forge', 'teamforge', 'pipeline']);
const ran = (step: CesarPlanStep) => step.state === 'done' || step.state === 'failed'
  || (step.state === 'skipped' && step.result?.status === 'success');

function verificationPolicy(plan: CesarPlan) {
  if (plan.state !== 'done') return { inspectForge: false, appendReview: false };
  const lastMutation = plan.steps.reduce((last, step, index) => MUTATING.has(step.type) && ran(step) ? index : last, -1);
  const newMutation = plan.steps.some(step => MUTATING.has(step.type) && step.state === 'done');
  const cycles = plan.reviewCyclesUsed ?? 0;
  const reviewSatisfied = cycles > 0 && plan.steps.some((step, index) => index > lastMutation
    && step.type === 'review' && step.selfReviewCycle === cycles && step.result?.status === 'success'
    && (step.state === 'done' || (step.state === 'skipped' && !newMutation)));
  if (reviewSatisfied) return { inspectForge: false, appendReview: false };
  return { inspectForge: plan.steps.some(step => FORGE_LIKE.has(step.type) && ran(step)),
    appendReview: (plan.selfReview ?? true) && lastMutation >= 0 && cycles < 2 };
}

/** A crash before verification must leave a resumable record, not false success. */
function verificationCheckpoint(plan: CesarPlan): CesarPlan {
  const policy = verificationPolicy(plan);
  return policy.inspectForge || policy.appendReview ? { ...plan, state: 'paused', completedAt: undefined } : plan;
}

/** Host effects and run-scoped fallback authorization. Retry preparation,
 * review budgeting and execution order belong to this physical Plan package. */
export interface PlanCoordinatorHost {
  createExecutors(): Record<string, StepExecutor>;
  executePlan(plan: CesarPlan, executors: Record<string, StepExecutor>, callbacks: PlanExecutorCallbacks, signal: AbortSignal): Promise<CesarPlan>;
  callbacks(plan: CesarPlan): PlanExecutorCallbacks & { flush(): void };
  setActivePlan(plan: CesarPlan): void;
  reportVerifiedPlan?(plan: CesarPlan): void;
  setAbort(controller: AbortController): void;
  releaseAbort(controller: AbortController): void;
  save(plan: CesarPlan): void;
  writeMarkdown(plan: CesarPlan): void;
  hasWorkingTreeChanges(): boolean;
  estimateReview(): { tokens: number; costUsd: number };
  takeFallback(signal: AbortSignal, planId: string): { engine: string; stepId?: string } | undefined;
  notify(level: 'info' | 'warning' | 'error' | 'success', message: string): void;
  warn(message: string, error: unknown): void;
}

/**
 * Return true when a failed plan step looks like it was interrupted by stall/fallback handling rather than a semantic task failure.
 */
export function failedPlanStepIsFallbackRetryable(step: CesarPlanStep | null | undefined): boolean {
  if (!step || step.state !== 'failed') {
    return false;
  }
  const text = `${String(step.result?.error ?? '')}\n${String(step.result?.output ?? '')}`.toLowerCase();
  if (!text.trim()) {
    return false;
  }
  return /\b(cancelled|canceled|aborted|abort|stalled|timeout|timed out|no response|econnreset|socket hang up)\b/.test(text);
}

/**
 * Reset one retryable failed plan step and bind it to the fallback engine. The caller runs executePlan again with a fresh abort controller.
 */
export function preparePlanFallbackRetry(plan: CesarPlan, fallbackEngine: string, stepId?: string): CesarPlan|null {
  const engine = String(fallbackEngine ?? '').trim();
  if (!engine || !Array.isArray(plan.steps)) return null;
  const failedIndex = plan.steps.findIndex(step => (!stepId || step.id === stepId) && failedPlanStepIsFallbackRetryable(step));
  if (failedIndex < 0) return null;
  const failedStep = plan.steps[failedIndex];
  const retriesUsed = plan.fallbackRetriesUsed ?? {};
  const used = Number(retriesUsed[failedStep.id] ?? 0);
  if (!Number.isSafeInteger(used) || used < 0 || used >= 1) return null;

  const currentEngines = [...new Set([failedStep.engine, ...(Array.isArray(failedStep.engines) ? failedStep.engines : [])]
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim()))];
  if (currentEngines.length === 1 && currentEngines[0] === engine) return null;

  const retryStep: CesarPlanStep = {
    ...failedStep,
    state: 'pending',
    result: undefined,
    engine,
    engines: Array.isArray(failedStep.engines) || ['forge', 'teamforge', 'pipeline', 'brainstorm', 'campfire', 'tribunal'].includes(String(failedStep.type))
      ? [engine]
      : failedStep.engines,
  };

  return {
    ...plan,
    state: 'running',
    completedAt: undefined,
    steps: plan.steps.map((step, index) => index === failedIndex ? retryStep : step),
    fallbackRetriesUsed: {
      ...retriesUsed,
      [failedStep.id]: used + 1,
    },
  };
}

export function createPlanCoordinator(host: PlanCoordinatorHost) {
  // Reporting is best effort. A broken view or log sink cannot change which
  // steps executed, undo a durable result, or authorize another execution.
  const warn = (message: string, error: unknown) => {
    try { host.warn(message, error); } catch { /* no further reporting sink */ }
  };
  const emit = (event: { type: 'info' | 'warning' | 'error' | 'success'; message: string }) => {
    try { host.notify(event.type, event.message); }
    catch (error) { warn('[plan] failed to report execution status:', error); }
  };
  const publish = (plan: CesarPlan) => {
    try { host.setActivePlan(plan); }
    catch (error) { warn('[plan] failed to publish execution state:', error); }
  };
  const report = (name: string, callback: () => void) => {
    try { callback(); }
    catch (error) { warn(`[plan] failed to report ${name}:`, error); }
  };
  function persistSnapshot(plan: CesarPlan, warning = '[plan] failed to write plan file:'): void {
    host.save(plan);
    if (plan.planFilePath) {
      try { host.writeMarkdown(plan); }
      catch (error) { warn(warning, error instanceof Error ? error.message : error); }
    }
  }
  function saveAndPublish(plan: CesarPlan, warning?: string): void {
    persistSnapshot(plan, warning);
    publish(plan);
  }
  function recoverSnapshot(plan: CesarPlan): void {
    const paused: CesarPlan = plan.state === 'cancelled' ? cancelCesarPlan(plan)
      : { ...plan, state: 'paused', completedAt: undefined, activeStepId: null, currentStepId: null };
    try { saveAndPublish(paused); }
    catch (error) { warn('[plan] failed to persist recovery snapshot:', error); }
  }
  async function executeAndDrain(plan: CesarPlan, executors: Record<string, StepExecutor>,
    callbacks: PlanExecutorCallbacks & { flush(): void }, signal: AbortSignal,
    failurePrefix = 'Plan execution failed', pendingStepId?: string): Promise<CesarPlan> {
    let latest = plan;
    let settled = false;
    const phase = new AbortController();
    const abortPhase = () => phase.abort(signal.reason);
    if (signal.aborted) abortPhase();
    else signal.addEventListener('abort', abortPhase, { once: true });
    const reportedSteps = new Set<string>();
    const startedSteps = new Set<string>();
    const observingCallbacks: PlanExecutorCallbacks = {
      onPlanUpdate(updated) {
        if (settled || latest.state === 'cancelled') return;
        latest = updated.state === 'cancelled' ? cancelCesarPlan(updated) : updated;
        report('plan update', () => callbacks.onPlanUpdate(verificationCheckpoint(latest)));
      },
      onStepStart(stepId) {
        if (settled || latest.state === 'cancelled') return;
        const step = latest.steps.find(item => item.id === stepId);
        if (!step || !['pending', 'running'].includes(step.state ?? '') || startedSteps.has(stepId)) return;
        startedSteps.add(stepId);
        latest = { ...latest, steps: latest.steps.map(step => step.id === stepId
          ? { ...step, state: 'running', startedAt: step.startedAt ?? new Date().toISOString() } : step) };
        report('step start', () => callbacks.onStepStart(stepId));
      },
      onStepDone(stepId, result) {
        if (settled || latest.state === 'cancelled' || reportedSteps.has(stepId)) return;
        reportedSteps.add(stepId);
        const step = latest.steps.find(item => item.id === stepId);
        if (step && step.state !== 'done' && step.state !== 'failed' && step.state !== 'skipped') {
          latest = advanceCesarStep(latest, stepId, result);
        }
        report('step completion', () => callbacks.onStepDone(stepId, result));
      },
      onBudgetWarning(actual, estimated) {
        if (!settled) report('budget warning', () => callbacks.onBudgetWarning(actual, estimated));
      },
      ...(callbacks.summarizeStepOutput ? { summarizeStepOutput: async (stepId: string, output: string) =>
        settled ? output : callbacks.summarizeStepOutput!(stepId, output) } : {}),
    };
    try {
      const returned = await host.executePlan(plan, executors, observingCallbacks, phase.signal);
      if (latest.state !== 'cancelled' && returned.state === 'cancelled') {
        latest = cancelCesarPlan(returned);
        report('cancellation', () => callbacks.onPlanUpdate(latest));
      }
      return latest.state === 'cancelled' ? latest : returned;
    }
    catch (error) {
      settled = true;
      phase.abort(error);
      const message = error instanceof Error ? error.message : String(error);
      const failedIds = new Set(latest.steps.filter(step => step.state === 'running'
        || (step.id === pendingStepId && (step.state === 'pending' || step.state === 'blocked' || !step.state))).map(step => step.id));
      const terminal = latest.state === 'cancelled' || latest.state === 'done';
      if (terminal) failedIds.clear();
      const paused: CesarPlan = terminal ? latest : { ...latest, state: 'paused', completedAt: undefined,
        activeStepId: null, currentStepId: null,
        steps: latest.steps.map(step => !failedIds.has(step.id) ? step : {
          ...step, state: 'failed', result: { status: 'failure',
            actualTokens: step.result?.actualTokens ?? 0, actualCostUsd: step.result?.actualCostUsd ?? 0,
            durationMs: step.result?.durationMs ?? 0, output: step.result?.output ?? '', error: message },
        }),
      };
      // Settle the domain callbacks too: the UI must not keep a running spinner
      // or todo after the stored plan becomes paused. Preserve completed steps.
      for (const step of paused.steps) {
        if (!failedIds.has(step.id)) continue;
        try { callbacks.onStepDone(step.id, step.result!); }
        catch (reportError) { warn('[plan] failed to report interrupted step:', reportError); }
      }
      try { callbacks.onPlanUpdate(verificationCheckpoint(paused)); }
      catch (reportError) { warn('[plan] failed to report paused plan:', reportError); }
      emit({ type: terminal ? 'warning' : 'error', message: terminal
        ? `Plan ${latest.state}; execution cleanup reported: ${message}` : `${failurePrefix}: ${message}` });
      return paused;
    }
    finally {
      settled = true;
      signal.removeEventListener('abort', abortPhase);
      // Finish this phase's writer before its caller persists the returned
      // state or starts another phase. An older writer must never run last.
      try { callbacks.flush(); }
      catch (error) { warn('[plan] failed to flush plan callbacks:', error); }
    }
  }
  /**
   * FU-4: shared executor for the auto-approve, manual-approve, and plan-resume paths. Wires the abort controller, builds callbacks (with debounced persistence), runs executePlan, runs finalizePlanWithReviewGate, and dispatches the terminal status. Eliminates the ~60 lines of triplication that lived in dispatch.kern and forced future changes (e.g., new callback hooks, new finalize behavior) to be applied to all three sites.
   */
  async function executeApprovedPlan(approved: CesarPlan): Promise<void> {
    let lastKnown = approved;
    let initialPersisted = false;
    let abortController = new AbortController();
    const attemptedControllers: AbortController[] = [];
    const registerAbort = (controller: AbortController) => {
      // Registration can mutate a host slot before its UI setter throws.
      attemptedControllers.push(controller);
      host.setAbort(controller);
    };
    try {
      // Execution must not begin before its approved state is durable. All
      // entry paths share this boundary and the recovery path below.
      saveAndPublish(approved);
      initialPersisted = true;
      const executors = host.createExecutors();
      registerAbort(abortController);
      let callbacks = host.callbacks(approved);
      let finalPlan = await executeAndDrain(approved, executors, callbacks, abortController.signal);
      lastKnown = finalPlan;
      saveAndPublish(verificationCheckpoint(finalPlan));
      const fallback = host.takeFallback(abortController.signal, finalPlan.id);
      const fallbackEngine = fallback?.engine ?? '';
      const retryPlan = fallback && finalPlan.state === 'paused'
        ? preparePlanFallbackRetry(finalPlan, fallbackEngine, fallback.stepId) : null;
      if (retryPlan) {
        const retryStep = retryPlan.steps.find((step, index) => step.state === 'pending' && finalPlan.steps[index]?.state === 'failed');
        emit({
          type: 'warning',
          message: `Plan fallback retry — rerunning step "${retryStep?.description ?? 'unknown'}" on ${fallbackEngine}`,
        });
        abortController = new AbortController();
        registerAbort(abortController);
        lastKnown = retryPlan;
        saveAndPublish(retryPlan, '[plan] failed to write fallback retry plan file:');
        callbacks = host.callbacks(retryPlan);
        finalPlan = await executeAndDrain(retryPlan, executors, callbacks, abortController.signal,
          'Plan fallback retry failed', retryStep?.id);
        lastKnown = finalPlan;
        saveAndPublish(verificationCheckpoint(finalPlan));
      }
      finalPlan = await finalizeReview(finalPlan, executors, abortController.signal, snapshot => { lastKnown = snapshot; });
      if (finalPlan.state === 'done') {
        report('completion message', () => emit({ type: 'success', message: `Plan complete \u2014 ${finalPlan.steps.length} steps, $${finalPlan.totalActualCostUsd.toFixed(4)} actual cost` }));
      } else if (finalPlan.state === 'paused') {
        const failedStep = finalPlan.steps.find(s => s.state === 'failed');
        if (failedStep) {
          emit({ type: 'warning', message: `Plan paused \u2014 step "${failedStep.description}" failed: ${failedStep.result?.error ?? 'unknown'}` });
        } else if (abortController.signal.aborted) {
          emit({ type: 'warning', message: 'Plan paused \u2014 execution was interrupted.' });
        } else {
          emit({ type: 'warning', message: 'Plan paused.' });
        }
        emit({ type: 'info', message: 'Use /plan resume to retry, or /cancel to abort' });
      }
    } catch (err) {
      // Setup and required persistence failures must stop execution, not leave
      // a durable running plan. Recovery is best effort if storage itself failed.
      if (initialPersisted) recoverSnapshot(lastKnown);
      emit({ type: 'error', message: `Plan execution failed: ${err instanceof Error ? err.message : String(err)}${initialPersisted ? '' : '. No work started; retry approval or resume after storage recovers.'}` });
    } finally {
      for (const controller of attemptedControllers.reverse()) {
        try { host.releaseAbort(controller); }
        catch (error) { warn('[plan] failed to release abort controller:', error); }
      }
    }
  }

  /**
   * Single source of truth for the post-execution self-review gate. Called from BOTH the plan-task and plan-resume terminal paths so resume cannot bypass the gate or the cycle cap (tribunal fix #4).
   */
  async function finalizePlanWithReviewGate(finalPlan: CesarPlan, executors: Record<string,StepExecutor>, abortSignal: AbortSignal): Promise<CesarPlan> {
    let lastKnown = finalPlan;
    try {
      return await finalizeReview(finalPlan, executors, abortSignal, snapshot => { lastKnown = snapshot; });
    } catch (error) { recoverSnapshot(lastKnown); throw error; }
  }

  async function finalizeReview(finalPlan: CesarPlan, executors: Record<string,StepExecutor>, abortSignal: AbortSignal,
    observe: (plan: CesarPlan) => void): Promise<CesarPlan> {
    if (finalPlan.state !== 'done') return finalPlan;
    const policy = verificationPolicy(finalPlan);
    const cyclesUsed = finalPlan.reviewCyclesUsed ?? 0;
    if (!policy.inspectForge && !policy.appendReview) return finalPlan;
    const pendingVerification = verificationCheckpoint(finalPlan);
    observe(pendingVerification);
    saveAndPublish(pendingVerification);

    // Tribunal fix #2 + #8: source of truth is the actual cwd, not step state.
    const hasUncommittedChanges = host.hasWorkingTreeChanges();

    // Only forge/teamforge/pipeline produce un-applied "winner" patches —
    // self/agent/delegate live-edit (or don't edit at all). A self-only plan
    // that left cwd clean is a no-op success, not a stuck forge.
    if (policy.inspectForge && !hasUncommittedChanges) {
      emit({ type: 'warning', message: 'Plan completed forge steps but cwd has no changes. Forge winners may need to be applied. Use /forge accept or inspect ~/.agon/runs.' });
      const paused = { ...finalPlan, state: 'paused' as const, completedAt: undefined };
      saveAndPublish(paused);
      return paused;
    }

    const wantsReview = policy.appendReview && hasUncommittedChanges;

    if (!wantsReview) {
      observe(finalPlan);
      saveAndPublish(finalPlan);
      report('verified plan', () => host.reportVerifiedPlan?.(finalPlan));
      return finalPlan;
    }

    if (abortSignal.aborted) {
      const paused: CesarPlan = { ...finalPlan, state: 'paused', completedAt: undefined };
      saveAndPublish(paused);
      return paused;
    }

    const reviewEst = host.estimateReview();
    const reviewPrefix = `review-${Date.now().toString(36)}`;
    let reviewId = reviewPrefix;
    for (let suffix = 1; finalPlan.steps.some(step => step.id === reviewId); suffix++) reviewId = `${reviewPrefix}-${suffix}`;
    const reviewStep: CesarPlanStep = {
      id: reviewId,
      type: 'review',
      description: `Verify mutating changes against intent: ${finalPlan.intent.slice(0, 100)}`,
      estimatedTokens: reviewEst.tokens,
      estimatedCostUsd: reviewEst.costUsd,
      state: 'pending',
      selfReviewCycle: cyclesUsed + 1,
    };

    const replanned: CesarPlan = {
      ...finalPlan,
      state: 'running',
      completedAt: undefined,
      steps: [...finalPlan.steps, reviewStep],
      // Tribunal fix #5b: thread plan.intent into stepContext so the review
      // executor can build a prompt that verifies the diff against intent.
      stepContext: { ...finalPlan.stepContext, __plan_intent: finalPlan.intent },
      reviewCyclesUsed: cyclesUsed + 1,
    };

    const cycleNum = replanned.reviewCyclesUsed ?? 1;
    emit({ type: 'info', message: `Self-review gate: appending review step (cycle ${cycleNum}/2)` });

    // Tribunal fix #10: build fresh callbacks against the replanned plan so
    // onStepStart/onStepDone find the new review step.
    observe(replanned);
    saveAndPublish(replanned);
    const callbacks = host.callbacks(replanned);

    const reviewedPlan = await executeAndDrain(replanned, executors, callbacks, abortSignal,
      'Self-review cycle failed mid-execution', reviewStep.id);

    observe(reviewedPlan);
    saveAndPublish(reviewedPlan);

    if (reviewedPlan.state === 'paused' && (reviewedPlan.reviewCyclesUsed ?? 0) >= 2) {
      const failedReview = reviewedPlan.steps.some(step => step.id === reviewStep.id && step.state === 'failed');
      emit({ type: 'error', message: failedReview
        ? 'Self-review cycle 2/2 failed. Auto-review exhausted. Inspect the plan and decide manually.'
        : 'Self-review cycle 2/2 paused before completion. Auto-review exhausted. Inspect the plan and decide manually.' });
    }

    return reviewedPlan;
  }

  return { executeApprovedPlan, finalizePlanWithReviewGate };
}
