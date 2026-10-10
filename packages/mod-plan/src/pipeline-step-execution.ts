import { join } from 'node:path';
import type { StepExecutor } from './executor.js';
import type { CesarStepResult } from './execution-model.js';
import { buildPlanStepContext, resolvePlanStepEngines } from './panel-step-execution.js';
import type { PlanPanelStepHost } from './panel-step-execution.js';
import { notePlanForgeEvent, startPlanForgeProgress, withPlanStepUiDiagnostics } from './forge-step-execution.js';
import type { PlanForgeHost, PlanForgeEvent, PlanForgeUiEvent } from './forge-step-execution.js';

export type PlanPipelinePhaseEventType = 'started' | 'completed' | 'failed' | 'cancelled';
export type PlanPipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface PlanPipelineIssue { code: string; message: string; path?: string }
export interface PlanPipelineRun {
  status: PlanPipelineRunStatus;
  events: ReadonlyArray<{ type: string; phaseId: string }>;
}
export type PlanPipelineUiEvent = PlanForgeUiEvent
  | { type: 'error'; message: string }
  | { type: 'workflow-run-start'; workflowId: string; runId: string; planId: string }
  | { type: 'workflow-run-conformance-failed'; workflowId: string; runId: string; issues: PlanPipelineIssue[] }
  | { type: `workflow-phase-${PlanPipelinePhaseEventType}`; workflowId: string; runId: string; phaseId: string; reason: string; status: PlanPipelineRunStatus }
  | { type: 'workflow-run-completed'; workflowId: string; runId: string; planId: string; status: 'completed' | 'failed' | 'cancelled'; reason: string; workflowStatus: PlanPipelineRunStatus };

/** The host supplies the existing workflow compiler/validator and backend effects.
 * Plan owns ordering, authority checks, tracking failure policy, and result shaping.
 * Generic plan/run values stay opaque beyond the metadata this policy reads.
 */
export interface PlanPipelineHost<P extends { logicalPlanId: string }, R extends PlanPipelineRun, I extends PlanPipelineIssue>
  extends Pick<PlanForgeHost, 'cwd' | 'outputDir' | 'snapshot' | 'activeEngines'>,
  Pick<PlanPanelStepHost, 'brainstorm' | 'tribunal'> {
  assertAvailable(type: 'pipeline' | 'brainstorm' | 'forge' | 'tribunal', signal?: AbortSignal): void;
  isCancellation(signal?: AbortSignal): boolean;
  getDispatch(): ((event: PlanPipelineUiEvent) => void) | undefined;
  forge: PlanForgeHost['run'];
  workflow: {
    resolve(): { id: string; plan: P };
    verifyPlan(plan: P): I[];
    rejectPlan(issues: I[], message: string): never;
    createRun(plan: P, id: string): R;
    append(run: R, phase: string, type: PlanPipelinePhaseEventType, message?: string, data?: Record<string, unknown>): R;
    verifyRun(run: R): I[];
  };
}

export function createPipelineStepExecutor<P extends { logicalPlanId: string }, R extends PlanPipelineRun, I extends PlanPipelineIssue>(host: PlanPipelineHost<P, R, I>): StepExecutor {
  return { async execute(step, context, signal) {
    signal?.throwIfAborted();
    host.assertAvailable('pipeline', signal);
    const assertPhaseAuthority = (phase: 'brainstorm' | 'forge' | 'tribunal'): void => {
      signal?.throwIfAborted();
      host.assertAvailable('pipeline', signal);
      host.assertAvailable(phase, signal);
    };
    // Pipeline = brainstorm → forge → tribunal chain
    // Resolve, compile, and verify the certified workflow spec before executing.
    const { id: workflowId, plan: pipelinePlan } = host.workflow.resolve();
    const pipelineFlowIssues = host.workflow.verifyPlan(pipelinePlan);
    if (pipelineFlowIssues.length > 0) host.workflow.rejectPlan(pipelineFlowIssues, 'agon.brainstorm-forge-tribunal@v1 flow verification failed');
    const pipelineRunId = `plan-pipeline-${step.id}-${Date.now()}`;

    const startTime = Date.now();
    const before = host.snapshot();
    const task = buildPlanStepContext(step, context);
    let pipelineContext = '';
    const engines = resolvePlanStepEngines(step, () => host.activeEngines?.() ?? []) ?? [];
    const dispatch = withPlanStepUiDiagnostics(host.getDispatch());
    const engineStatus: Record<string,string> = {};
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let pipelineRunClosed = false;
    let pipelineTrackingFailed = false;
    let currentWorkflowPhase = '';
    let pipelineWorkflowRun = host.workflow.createRun(pipelinePlan, pipelineRunId);
    const partialPipelineOutput = (): string => {
      const completed = pipelineWorkflowRun.events.filter(event => event.type === 'completed').map(event => event.phaseId);
      return completed.length ? `Partial pipeline (${completed.join(' → ')} done): ${pipelineContext.slice(0, 200)}` : '';
    };
    const pipelineIssuesFromError = (err: unknown): PlanPipelineIssue[] => {
      const issues = (err as { issues?: PlanPipelineIssue[] } | null)?.issues;
      if (Array.isArray(issues)) return issues;
      return [{ code: 'invalid-phase', message: err instanceof Error ? err.message : String(err), path: 'workflowRun' }];
    };
    const pipelineTrackingFailureResult = (): { result: CesarStepResult } => {
      const after = host.snapshot();
      return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: partialPipelineOutput(), error: 'workflow-conformance-failed' } };
    };
    const pipelineUiType = (type: PlanPipelinePhaseEventType): `workflow-phase-${PlanPipelinePhaseEventType}` => `workflow-phase-${type}`;
    const emitPipelinePhase = (phaseId: string, type: PlanPipelinePhaseEventType, reason = '') => {
      if (pipelineTrackingFailed) return false;
      try {
        pipelineWorkflowRun = host.workflow.append(pipelineWorkflowRun, phaseId, type, reason || undefined, reason ? { reason } : undefined);
      } catch (err) {
        pipelineTrackingFailed = true;
        dispatch?.({ type: 'workflow-run-conformance-failed', workflowId, runId: pipelineRunId, issues: pipelineIssuesFromError(err) });
        dispatch?.({ type: 'error', message: `Workflow tracking failed: ${err instanceof Error ? err.message : String(err)}` });
        closePipelineRun('failed', 'workflow-conformance-failed');
        return false;
      }
      dispatch?.({ type: pipelineUiType(type), workflowId, runId: pipelineRunId, phaseId, reason, status: pipelineWorkflowRun.status });
      return true;
    };
    const closePipelineRun = (status: 'completed' | 'failed' | 'cancelled', reason = '') => {
      if (pipelineRunClosed) return;
      let issues: PlanPipelineIssue[];
      try {
        issues = host.workflow.verifyRun(pipelineWorkflowRun);
      } catch (error) {
        issues = pipelineIssuesFromError(error);
        // A thrown validator is not successful verification, even if it carries
        // an empty structured diagnostics array.
        if (issues.length === 0) issues = [{ code: 'invalid-phase', message: error instanceof Error ? error.message : String(error), path: 'workflowRun' }];
      }
      if (issues.length > 0) {
        pipelineTrackingFailed = true;
        status = 'failed';
        reason = 'workflow-conformance-failed';
        dispatch?.({ type: 'workflow-run-conformance-failed', workflowId, runId: pipelineRunId, issues });
      }
      pipelineRunClosed = true;
      dispatch?.({ type: 'workflow-run-completed', workflowId, runId: pipelineRunId, planId: pipelinePlan.logicalPlanId, status, reason, workflowStatus: pipelineTrackingFailed ? status : pipelineWorkflowRun.status });
    };
    dispatch?.({ type: 'workflow-run-start', workflowId, runId: pipelineRunId, planId: pipelinePlan.logicalPlanId });
    try {
      // 1. Brainstorm — get approach bids
      currentWorkflowPhase = 'brainstorm';
      if (!emitPipelinePhase('brainstorm', 'started')) return pipelineTrackingFailureResult();
      assertPhaseAuthority('brainstorm');
      const bsResult = await host.brainstorm({ question: task, engines, timeout: 120, outputDir: join(host.outputDir, step.id, 'brainstorm'), signal });
      assertPhaseAuthority('brainstorm');
      if (!emitPipelinePhase('brainstorm', 'completed')) return pipelineTrackingFailureResult();
      currentWorkflowPhase = '';
      pipelineContext = bsResult.response;

      // 2. Forge — compete on implementation
      currentWorkflowPhase = 'forge';
      if (!emitPipelinePhase('forge', 'started')) return pipelineTrackingFailureResult();
      const forgeTask = `${task}\n\nBrainstorm winner approach:\n${pipelineContext}`;
      progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
      assertPhaseAuthority('forge');
      const manifest = await host.forge(
        { task: forgeTask, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd: host.cwd, forgeDir: join(host.outputDir, step.id, 'forge'), engines, signal },
        dispatch && engines.length > 0 ? (event: PlanForgeEvent) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
        'forge',
      );
      assertPhaseAuthority('forge');
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
        dispatch?.({ type: 'progress-clear' });
      }
      if (!manifest.winner) {
        if (!emitPipelinePhase('forge', 'failed', 'forge-produced-no-winner')) return pipelineTrackingFailureResult();
        currentWorkflowPhase = '';
        closePipelineRun('failed', 'forge-produced-no-winner');
        if (pipelineTrackingFailed) return pipelineTrackingFailureResult();
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'Pipeline forge step: no winner', error: 'Forge produced no winner' } };
      }
      if (!emitPipelinePhase('forge', 'completed')) return pipelineTrackingFailureResult();
      currentWorkflowPhase = '';

      // 3. Tribunal — review the forge winner
      currentWorkflowPhase = 'tribunal';
      if (!emitPipelinePhase('tribunal', 'started')) return pipelineTrackingFailureResult();
      const tribunalQ = `Review the implementation from forge winner ${manifest.winner} for: ${task}`;
      assertPhaseAuthority('tribunal');
      const tResult = await host.tribunal({ question: tribunalQ, engines: engines.slice(0, 3), rounds: 2, timeout: 120, outputDir: join(host.outputDir, step.id, 'tribunal'), signal });
      assertPhaseAuthority('tribunal');
      if (!emitPipelinePhase('tribunal', 'completed')) return pipelineTrackingFailureResult();
      currentWorkflowPhase = '';
      closePipelineRun('completed');
      if (pipelineTrackingFailed) return pipelineTrackingFailureResult();

      const after = host.snapshot();
      return {
        result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `[workflow:${workflowId}] Pipeline: brainstorm → forge (${manifest.winner}) → tribunal\n${tResult.summary}` },
        contextExport: `Pipeline result: forge winner ${manifest.winner}. Tribunal: ${tResult.summary.slice(0, 300)}`,
      };
    } catch (err) {
      const cancelled = host.isCancellation(signal);
      if (currentWorkflowPhase && !pipelineTrackingFailed) {
        emitPipelinePhase(currentWorkflowPhase, cancelled ? 'cancelled' : 'failed', cancelled ? 'aborted' : (err instanceof Error ? err.message : String(err)));
        currentWorkflowPhase = '';
      }
      closePipelineRun(cancelled ? 'cancelled' : 'failed', cancelled ? 'aborted' : (err instanceof Error ? err.message : String(err)));
      if (pipelineTrackingFailed) return pipelineTrackingFailureResult();
      const after = host.snapshot();
      return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: partialPipelineOutput(), error: err instanceof Error ? err.message : String(err) } };
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      dispatch?.({ type: 'progress-clear' });
    }
  } };
}
