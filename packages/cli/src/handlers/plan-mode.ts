import { writeFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { planCostEstimator, resolveWorkingDir, RUNS_DIR, tracker, readPatchFromPath, applyPatchToTree, cesarPlanMarkdownPath, saveCesarPlan, spawnWithTimeout, getCoreWorkflowRegistry, compileWorkflowSpec, verifyWorkflowExecutionPlanFlow, verifyWorkflowRunFlow, throwWorkflowConformance, createWorkflowRun, appendWorkflowPhaseEvent } from '@kernlang/agon-core';
import { publishPlanProposal, exitPlanSession, createPanelStepExecutors, createSelfStepExecutor, createAgentReviewStepExecutors, buildPlanStepContext, resolvePlanStepEngines } from '@kernlang/agon-mod-plan';
import { SurfaceGenerationError } from '@kernlang/agon-kernel';

import type { CesarPlan, CesarPlanStep, CesarStepResult, StepExecutor, WorkflowConformanceIssue, WorkflowPhaseEventType, WorkflowRun } from '@kernlang/agon-core';

import { runForge, runBrainstorm, runTribunal, runCampfire, runDelegate } from '@kernlang/agon-forge';

import type { Dispatch, HandlerContext, EngineProgress } from './types.js';

import { runReviewCore, resolveReviewTarget, selectReviewEngine } from './review.js';

import { runAgentMode, runAgentTeam } from './agent.js';

import { handleCesarBrain } from '../cesar/brain.js';

import { isAgenticAutoMode } from '../cesar/task-controller.js';
import { assertProcessPlanStepAvailable, assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, guardProcessEngineAdapter, withProcessSurfaceAuthority } from '../surface-authority-runtime.js';

export async function handleProposePlan(args: Record<string, unknown>, dispatch: Dispatch, ctx: HandlerContext): Promise<CesarPlan> {
  return publishPlanProposal(args, {
    estimator: planCostEstimator,
    agenticAutoMode: () => isAgenticAutoMode(ctx),
    markdownPath: cesarPlanMarkdownPath,
    writeMarkdown: (path, markdown) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, markdown);
    },
    persist: saveCesarPlan,
    proposed: () => ctx.cesar?.proposedPlan,
    active: () => ctx.activePlan,
    clearProposal: () => { if (ctx.cesar) ctx.cesar.proposedPlan = undefined; },
    notify: message => dispatch?.({ type: 'info', message }),
    publish: (plan, markdown, path) => dispatch({ type: 'plan-proposal', plan, markdown, planFilePath: path }),
  });
}

/**
 * Cesar's escape hatch from plan mode (shared by the native onToolCall path and the MCP/XML signal paths in brain.kern). Archives any pending/paused plan as cancelled-with-reason, clears all plan state so mutation guards lift and go/yes stop routing to /approve, and sets a one-turn ping-pong guard. Refuses to abandon a RUNNING plan (it may have in-flight jobs/worktrees) — the user must cancel that. The dispatch is only for UI events; the state cleanup above does not depend on it, so a null dispatch is non-fatal (both call paths then behave identically). Returns the tool-result string.
 */
export function handleExitPlanMode(reason: string, dispatch: Dispatch|null, ctx: HandlerContext): string {
  return exitPlanSession(reason, ctx.activePlan, {
    persist: saveCesarPlan,
    clearProposalAndMarkExited: () => {
      if (ctx.cesar) {
        ctx.cesar.proposedPlan = undefined;
        ctx.cesar.justExitedPlanMode = true;
      }
    },
    setInactive: () => ctx.setActivePlan?.(null),
    ...(dispatch ? {
      cancelled: (plan: CesarPlan) => dispatch({ type: 'plan-cancelled', plan }),
      notify: (message: string) => dispatch({ type: 'info', message }),
    } : {}),
  });
}

export function buildStepExecutors(ctx: HandlerContext, liveDispatch?: Dispatch): Record<string,StepExecutor> {
  assertProcessSurfaceAvailable('tui', '/plan');
  const assertCurrent = captureProcessSurfaceAuthority();
  const cwd = resolveWorkingDir();
  const runsRoot = process.env.AGON_HOME?.trim() ? join(process.env.AGON_HOME.trim(), 'runs') : RUNS_DIR;
  const outputDir = join(runsRoot, `plan-exec-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
  
  const assertStepAvailable = (type: string, signal?: AbortSignal): void => {
    signal?.throwIfAborted();
    assertCurrent();
    assertProcessSurfaceAvailable('tui', '/plan');
    assertProcessPlanStepAvailable(type);
  };
  const wrap = (type: string, fn: StepExecutor['execute']): StepExecutor => ({
    execute: async (step, context, signal) => {
      assertStepAvailable(type, signal);
      return withProcessSurfaceAuthority(signal,
        childSignal => assertStepAvailable(type, childSignal),
        childSignal => fn(step, context, childSignal));
    },
  });
  const guardedAdapter = (type: string, signal?: AbortSignal) =>
    guardProcessEngineAdapter(ctx.adapter, () => assertStepAvailable(type, signal));
  const executionRefusal = (type: string, signal?: AbortSignal) => () => {
    try { assertStepAvailable(type, signal); return undefined; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  };
  
  // Helper: extract token/cost from tracker delta.
  // meteredCostUsd, NOT totalCostUsd: only real per-token billing counts as a
  // step's "actual" spend. The ballpark total priced flat-rate engines at a
  // made-up default rate and fed the budget warning fabricated dollars
  // ($8.79 "actual" on a $0-marginal kimi coding-plan run, 2026-06-11).
  const snapshotTokens = () => {
    const s = tracker.getStats();
    return { tokens: s.totalTokens, cost: s.meteredCostUsd };
  };
  
  const buildContext = buildPlanStepContext;
  const agentReviewExecutors = createAgentReviewStepExecutors({
    assertAvailable: assertStepAvailable,
    snapshot: snapshotTokens,
    reviewTarget: () => resolveReviewTarget('uncommitted', cwd, undefined),
    selectReviewEngine: requested => selectReviewEngine(requested, ctx),
    review: (diff, label, engineId, signal) => runReviewCore(diff, label, engineId, ctx, signal),
    agent: (task, emit, options) => runAgentMode(task, emit as Dispatch, ctx, {
      ...options, executionRefusal: executionRefusal('agent', options.parentSignal),
    }),
    teamAgent: (task, emit, options) => runAgentTeam(task, emit as Dispatch, ctx, {
      ...options, executionRefusal: executionRefusal('team-agent', options.parentSignal),
    }),
  });
  const resolveStepEngines = (step: CesarPlanStep) => resolvePlanStepEngines(step, () => ctx.activeEngines?.() ?? []);
  const panelExecutors = createPanelStepExecutors({
    outputDir,
    assertAvailable: assertStepAvailable,
    snapshot: snapshotTokens,
    activeEngines: () => ctx.activeEngines?.() ?? [],
    brainstorm: options => runBrainstorm({ ...options, registry: ctx.registry, adapter: guardedAdapter('brainstorm', options.signal) }),
    tribunal: options => runTribunal({ ...options, mode: options.mode as Parameters<typeof runTribunal>[0]['mode'], registry: ctx.registry, adapter: guardedAdapter('tribunal', options.signal) }),
    campfire: options => runCampfire({ ...options, registry: ctx.registry, adapter: guardedAdapter('campfire', options.signal) }),
    delegate: options => runDelegate({ ...options, registry: ctx.registry, adapter: guardedAdapter('delegate', options.signal) }),
  });
  
  const getPlanDispatch = (): Dispatch | undefined => liveDispatch ?? ctx.cesar?.planDispatch ?? ctx.cesar?.lastDispatch ?? undefined;
  
  const emitPlanForgeProgress = (dispatch: Dispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number) => {
    if (!dispatch || !engines || engines.length === 0) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const progress: EngineProgress[] = engines.map((id: string) => {
      const status = engineStatus[id] ?? 'preparing';
      return {
        id,
        status: status === 'done' ? `done (${engineStatus[`${id}:score`] ?? '?'})` : status,
        elapsed,
        done: status === 'done',
        failed: status === 'failed',
        score: engineStatus[`${id}:score`],
      };
    });
    dispatch({ type: 'progress-update', engines: progress } as any);
  };
  
  const notePlanForgeEvent = (event: any, dispatch: Dispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number) => {
    const id = String(event?.engineId ?? event?.data?.engineId ?? '');
    switch (event?.type) {
      case 'baseline:start':
        dispatch?.({ type: 'info', message: 'Forge baseline check...' } as any);
        break;
      case 'baseline:done':
        if (event.data?.passes) dispatch?.({ type: 'warning', message: 'Baseline passes - fitness test may be non-discriminating' } as any);
        break;
      case 'stage1:dispatch':
      case 'stage2:dispatch':
        if (id) engineStatus[id] = 'building';
        break;
      case 'engine:worktree':
        if (id) {
          engineStatus[id] = 'building';
          const worktreePath = String(event.data?.worktreePath ?? '');
          if (worktreePath && engineStatus[`${id}:worktree`] !== worktreePath) {
            engineStatus[`${id}:worktree`] = worktreePath;
            dispatch?.({ type: 'info', message: `Forge worktree ${id}: ${worktreePath}` } as any);
          }
        }
        break;
      case 'engine:failed':
        if (id) {
          engineStatus[id] = 'failed';
          engineStatus[`${id}:score`] = '0';
          engineStatus[`${id}:error`] = String(event.data?.error ?? 'failed');
        }
        break;
      case 'stage1:accepted':
      case 'stage1:score':
      case 'stage2:score':
        if (id) {
          const passed = event.data?.pass !== false;
          engineStatus[id] = passed ? 'done' : 'failed';
          engineStatus[`${id}:score`] = String(event.data?.score ?? '?');
          if (!passed) engineStatus[`${id}:error`] = Number(event.data?.score ?? 0) === 0 ? 'no candidate changes or fitness failed' : 'fitness failed';
        }
        break;
      case 'winner:determined':
        if (event.data?.winner) {
          const winner = String(event.data.winner);
          engineStatus[winner] = 'done';
          engineStatus[`${winner}:score`] = String(event.data?.bestScore ?? engineStatus[`${winner}:score`] ?? '?');
          dispatch?.({ type: 'info', message: `Forge winner: ${winner}` } as any);
        }
        break;
      case 'synthesis:start':
        dispatch?.({ type: 'info', message: 'Forge synthesis...' } as any);
        break;
    }
    emitPlanForgeProgress(dispatch, engines, engineStatus, startTime);
  };
  
  const startPlanForgeProgress = (dispatch: Dispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number): any => {
    if (!dispatch || !engines || engines.length === 0) return null;
    dispatch({ type: 'info', message: `Forge engines: ${engines.join(', ')}` } as any);
    emitPlanForgeProgress(dispatch, engines, engineStatus, startTime);
    return setInterval(() => emitPlanForgeProgress(dispatch, engines, engineStatus, startTime), 500);
  };
  
  // FU-9: applyForgeWinnerToCwd — shared helper that reads the winning
  // patch from the manifest and applies it to cwd via git apply. This
  // closes the tribunal fix #2 loop: before, runForge produced a winner
  // in the forgeDir worktree but never modified cwd, so the self-review
  // gate saw an empty diff and the plan-paused fallback fired on every
  // forge plan. Now the autonomous plan path applies the winner directly.
  // The user-facing /forge command keeps its interactive preflight flow
  // (via handleForge) — this only changes the plan-step execution path.
  const applyForgeWinnerToCwd = (manifest: any): { ok: boolean; error?: string } => {
    if (!manifest.winner) return { ok: false, error: 'No winner' };
    const patchPath: string | undefined = manifest.patches?.[manifest.winner];
    if (!patchPath) return { ok: false, error: `Winner ${manifest.winner} has no patchPath in manifest` };
    const patch = readPatchFromPath(patchPath);
    if (!patch) return { ok: false, error: `Failed to read patch at ${patchPath}` };
    if (!patch.content || patch.content.trim().length === 0) {
      // Winner produced an empty diff — not an error, just nothing to apply.
      return { ok: true };
    }
    return applyPatchToTree(cwd, patch.content);
  };
  
  const isAlreadySatisfiedNoopForge = (manifest: any): boolean => {
    // Forge layer now sets manifest.alreadySatisfied for both the
    // early-baseline-passes case and the all-no-op-after-stage2 case.
    // Trust that flag when set.
    if (manifest?.alreadySatisfied) return true;
    if (!manifest?.baselinePasses) return false;
    const results = Object.values(manifest.results ?? {}) as any[];
    if (results.length === 0) return false;
    return results.every((r: any) => {
      if (!r) return false;
      const hasFitnessLog = typeof r.fitnessLogPath === 'string' && r.fitnessLogPath.length > 0;
      const noPatch = Number(r.diffLines ?? 0) === 0 && Number(r.filesChanged ?? 0) === 0;
      const zeroScore = Number(r.score ?? 0) === 0;
      const notDispatchCrash = !String(r.dispatchStdout ?? '').startsWith('ERROR:');
      return r.pass === false && hasFitnessLog && noPatch && zeroScore && notDispatchCrash;
    });
  };
  
  return {
    self: wrap('self', createSelfStepExecutor<Parameters<Dispatch>[0]>({
      cwd,
      outputDir,
      assertAvailable: assertStepAvailable,
      snapshot: snapshotTokens,
      getDispatch: getPlanDispatch,
      brain: (prompt, emit, signal) => handleCesarBrain(
        prompt, emit as Dispatch, ctx, [], signal, () => assertStepAvailable('self', signal),
      ),
      verify: spawnWithTimeout,
      delegate: options => runDelegate({
        ...options, registry: ctx.registry, adapter: guardedAdapter('delegate', options.signal),
      }),
    }).execute),
  
    forge: wrap('forge', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      const engines = resolveStepEngines(step);
      const dispatch = getPlanDispatch();
      const engineStatus: Record<string,string> = {};
      let progressInterval: any = null;
      try {
        const stepForgeDir = join(outputDir, step.id);
        mkdirSync(stepForgeDir, { recursive: true });
        dispatch?.({ type: 'info', message: `Forge run dir: ${stepForgeDir}` } as any);
        progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: stepForgeDir, engines, signal },
          ctx.registry, guardedAdapter('forge', signal),
          dispatch && engines ? (event: any) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
        );
        assertStepAvailable('forge', signal);
        const after = snapshotTokens();
  
        if (!manifest.winner) {
          const engineSummaries = Object.entries(manifest.results ?? {}).map(([id, r]: [string, any]) => {
            return `  ${id}: ${r.pass ? 'PASS' : 'FAIL'} (score: ${r.score ?? 'N/A'}, ${r.diffLines ?? 0} lines)`;
          }).join('\n');
          if (isAlreadySatisfiedNoopForge(manifest)) {
            const message = `Already satisfied: baseline fitness passed and all forge candidates left a clean worktree.\n${engineSummaries}`;
            return {
              result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: message },
              contextExport: 'Forge step already satisfied; no patch needed.',
            };
          }
          // Surface manifest.error (preflight/availability/execution failure
          // from the new never-throws contract) so the user sees the actual
          // cause instead of a generic "No winner" — which is misleading
          // when forge couldn't even dispatch (e.g. "No available engines").
          const errorReason = (manifest as any).error
            ? `Forge error: ${(manifest as any).error}`
            : 'No winner';
          const output = (manifest as any).error
            ? `${errorReason}\n${engineSummaries}`
            : `No winner.\n${engineSummaries}`;
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output, error: errorReason },
          };
        }
  
        // FU-9: apply the winning patch to cwd so downstream review/
        // verify steps see real changes. Failure to apply = step failure.
        const applied = applyForgeWinnerToCwd(manifest);
        if (!applied.ok) {
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner ${manifest.winner} but patch apply failed: ${applied.error}`, error: `patch apply failed: ${applied.error}` },
          };
        }
  
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner} (patch applied to cwd)` },
          contextExport: `Forge winner: ${manifest.winner}`,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      } finally {
        if (progressInterval) clearInterval(progressInterval);
        dispatch?.({ type: 'progress-clear' } as any);
      }
    }),
  
    teamforge: wrap('teamforge', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      const engines = resolveStepEngines(step);
      const dispatch = getPlanDispatch();
      const engineStatus: Record<string,string> = {};
      let progressInterval: any = null;
      try {
        const stepForgeDir = join(outputDir, step.id);
        mkdirSync(stepForgeDir, { recursive: true });
        dispatch?.({ type: 'info', message: `Team forge run dir: ${stepForgeDir}` } as any);
        progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: stepForgeDir, engines, hardened: true, signal },
          ctx.registry, guardedAdapter('teamforge', signal),
          dispatch && engines ? (event: any) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
        );
        assertStepAvailable('teamforge', signal);
        const after = snapshotTokens();
        if (!manifest.winner) {
          if (isAlreadySatisfiedNoopForge(manifest)) {
            return {
              result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'Already satisfied: baseline fitness passed and all team-forge candidates left a clean worktree.' },
              contextExport: 'TeamForge step already satisfied; no patch needed.',
            };
          }
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'No winner' },
          };
        }
        // FU-9: apply winning patch to cwd.
        const applied = applyForgeWinnerToCwd(manifest);
        if (!applied.ok) {
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner ${manifest.winner} but patch apply failed: ${applied.error}`, error: `patch apply failed: ${applied.error}` },
          };
        }
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner} (patch applied to cwd)` },
          contextExport: `TeamForge winner: ${manifest.winner}`,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      } finally {
        if (progressInterval) clearInterval(progressInterval);
        dispatch?.({ type: 'progress-clear' } as any);
      }
    }),
  
    ...Object.fromEntries(Object.entries(panelExecutors).map(([type, executor]) => [type, wrap(type, executor.execute)])),
  
    pipeline: wrap('pipeline', async (step, context, signal) => {
      const assertPhaseAvailable = (phase: 'brainstorm' | 'forge' | 'tribunal'): void => {
        assertStepAvailable('pipeline', signal);
        assertProcessPlanStepAvailable(phase);
      };
      // Pipeline = brainstorm → forge → tribunal chain
      // Resolve, compile, and verify the certified workflow spec before executing.
      const pipelineRegistry = getCoreWorkflowRegistry();
      const pipelineSpec = pipelineRegistry.require('agon.brainstorm-forge-tribunal@v1');
      const pipelinePlan = compileWorkflowSpec(pipelineSpec);
      const pipelineFlowIssues: WorkflowConformanceIssue[] = verifyWorkflowExecutionPlanFlow(pipelinePlan);
      if (pipelineFlowIssues.length > 0) throwWorkflowConformance(pipelineFlowIssues, 'agon.brainstorm-forge-tribunal@v1 flow verification failed');
      const pipelineRunId = `plan-pipeline-${step.id}-${Date.now()}`;
  
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      let pipelineContext = '';
      const engines = resolveStepEngines(step) ?? [];
      const dispatch = getPlanDispatch();
      const engineStatus: Record<string,string> = {};
      let progressInterval: any = null;
      let pipelineRunClosed = false;
      let pipelineTrackingFailed = false;
      let currentWorkflowPhase = '';
      let pipelineWorkflowRun: WorkflowRun = createWorkflowRun(pipelinePlan, pipelineRunId);
      const pipelineIssuesFromError = (err: unknown): WorkflowConformanceIssue[] => {
        const issues = (err as { issues?: WorkflowConformanceIssue[] } | null)?.issues;
        if (Array.isArray(issues)) return issues;
        return [{ code: 'invalid-phase', message: err instanceof Error ? err.message : String(err), path: 'workflowRun' }];
      };
      const pipelineTrackingFailureResult = (): { result: CesarStepResult } => {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: pipelineContext ? `Partial pipeline (brainstorm done): ${pipelineContext.slice(0, 200)}` : '', error: 'workflow-conformance-failed' } };
      };
      const pipelineUiType = (type: WorkflowPhaseEventType) => `workflow-phase-${type === 'started' ? 'started' : type === 'completed' ? 'completed' : type}`;
      const emitPipelinePhase = (phaseId: string, type: WorkflowPhaseEventType, reason = '') => {
        if (pipelineTrackingFailed) return false;
        try {
          pipelineWorkflowRun = appendWorkflowPhaseEvent(pipelineWorkflowRun, phaseId, type, reason || undefined, reason ? { reason } : undefined);
        } catch (err) {
          pipelineTrackingFailed = true;
          dispatch?.({ type: 'workflow-run-conformance-failed', workflowId: pipelineSpec.id, runId: pipelineRunId, issues: pipelineIssuesFromError(err) } as any);
          dispatch?.({ type: 'error', message: `Workflow tracking failed: ${err instanceof Error ? err.message : String(err)}` } as any);
          closePipelineRun('failed', 'workflow-conformance-failed');
          return false;
        }
        dispatch?.({ type: pipelineUiType(type), workflowId: pipelineSpec.id, runId: pipelineRunId, phaseId, reason, status: pipelineWorkflowRun.status } as any);
        return true;
      };
      const closePipelineRun = (status: 'completed' | 'failed' | 'cancelled', reason = '') => {
        if (pipelineRunClosed) return;
        const issues = verifyWorkflowRunFlow(pipelineWorkflowRun);
        if (issues.length > 0) {
          dispatch?.({ type: 'workflow-run-conformance-failed', workflowId: pipelineSpec.id, runId: pipelineRunId, issues } as any);
        }
        pipelineRunClosed = true;
        dispatch?.({ type: 'workflow-run-completed', workflowId: pipelineSpec.id, runId: pipelineRunId, planId: pipelinePlan.logicalPlanId, status, reason, workflowStatus: pipelineTrackingFailed ? status : pipelineWorkflowRun.status } as any);
      };
      dispatch?.({ type: 'workflow-run-start', workflowId: pipelineSpec.id, runId: pipelineRunId, planId: pipelinePlan.logicalPlanId } as any);
      try {
        // 1. Brainstorm — get approach bids
        currentWorkflowPhase = 'brainstorm';
        if (!emitPipelinePhase('brainstorm', 'started')) return pipelineTrackingFailureResult();
        assertPhaseAvailable('brainstorm');
        const bsResult = await runBrainstorm({ question: task, engines, registry: ctx.registry, adapter: guardedAdapter('brainstorm', signal), timeout: 120, outputDir: join(outputDir, step.id, 'brainstorm'), signal });
        assertPhaseAvailable('brainstorm');
        if (!emitPipelinePhase('brainstorm', 'completed')) return pipelineTrackingFailureResult();
        currentWorkflowPhase = '';
        pipelineContext = bsResult.response;
  
        // 2. Forge — compete on implementation
        currentWorkflowPhase = 'forge';
        if (!emitPipelinePhase('forge', 'started')) return pipelineTrackingFailureResult();
        const forgeTask = `${task}\n\nBrainstorm winner approach:\n${pipelineContext}`;
        progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
        assertPhaseAvailable('forge');
        const manifest = await runForge(
          { task: forgeTask, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id, 'forge'), engines, signal },
          ctx.registry, guardedAdapter('forge', signal),
          dispatch && engines.length > 0 ? (event: any) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
        );
        assertPhaseAvailable('forge');
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
          dispatch?.({ type: 'progress-clear' } as any);
        }
        if (!manifest.winner) {
          if (!emitPipelinePhase('forge', 'failed', 'forge-produced-no-winner')) return pipelineTrackingFailureResult();
          currentWorkflowPhase = '';
          closePipelineRun('failed', 'forge-produced-no-winner');
          const after = snapshotTokens();
          return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'Pipeline forge step: no winner', error: 'Forge produced no winner' } };
        }
        if (!emitPipelinePhase('forge', 'completed')) return pipelineTrackingFailureResult();
        currentWorkflowPhase = '';
  
        // 3. Tribunal — review the forge winner
        currentWorkflowPhase = 'tribunal';
        if (!emitPipelinePhase('tribunal', 'started')) return pipelineTrackingFailureResult();
        const tribunalQ = `Review the implementation from forge winner ${manifest.winner} for: ${task}`;
        assertPhaseAvailable('tribunal');
        const tResult = await runTribunal({ question: tribunalQ, engines: engines.slice(0, 3), rounds: 2, registry: ctx.registry, adapter: guardedAdapter('tribunal', signal), timeout: 120, outputDir: join(outputDir, step.id, 'tribunal'), signal });
        assertPhaseAvailable('tribunal');
        if (!emitPipelinePhase('tribunal', 'completed')) return pipelineTrackingFailureResult();
        currentWorkflowPhase = '';
        closePipelineRun('completed');
  
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `[workflow:${pipelineSpec.id}] Pipeline: brainstorm → forge (${manifest.winner}) → tribunal\n${tResult.summary}` },
          contextExport: `Pipeline result: forge winner ${manifest.winner}. Tribunal: ${tResult.summary.slice(0, 300)}`,
        };
      } catch (err) {
        const cancelled = signal?.aborted && !(signal.reason instanceof SurfaceGenerationError);
        if (currentWorkflowPhase && !pipelineTrackingFailed) {
          emitPipelinePhase(currentWorkflowPhase, cancelled ? 'cancelled' : 'failed', cancelled ? 'aborted' : (err instanceof Error ? err.message : String(err)));
          currentWorkflowPhase = '';
        }
        closePipelineRun(cancelled ? 'cancelled' : 'failed', cancelled ? 'aborted' : (err instanceof Error ? err.message : String(err)));
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: pipelineContext ? `Partial pipeline (brainstorm done): ${pipelineContext.slice(0, 200)}` : '', error: err instanceof Error ? err.message : String(err) } };
      } finally {
        if (progressInterval) clearInterval(progressInterval);
        dispatch?.({ type: 'progress-clear' } as any);
      }
    }),
  
    review: wrap('review', agentReviewExecutors.review.execute),
    agent: wrap('agent', agentReviewExecutors.agent.execute),
    'team-agent': wrap('team-agent', agentReviewExecutors['team-agent'].execute),
  };
}
