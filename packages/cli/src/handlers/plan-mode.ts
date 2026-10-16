import { writeFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { planCostEstimator, resolveWorkingDir, RUNS_DIR, tracker, cesarPlanMarkdownPath, saveCesarPlan, spawnWithTimeout, getCoreWorkflowRegistry, compileWorkflowSpec, verifyWorkflowExecutionPlanFlow, verifyWorkflowRunFlow, throwWorkflowConformance, createWorkflowRun, appendWorkflowPhaseEvent } from '@kernlang/agon-core';
import { publishPlanProposal, exitPlanSession, createPlanStepExecutors } from '@kernlang/agon-mod-plan';
import { readPatchContent, applyPatchToTree } from '@kernlang/agon-support-worktree';
import { SurfaceGenerationError } from '@kernlang/agon-kernel';

import type { CesarPlan, StepExecutor } from '@kernlang/agon-core';

import { runForge, runBrainstorm, runTribunal, runCampfire, runDelegate } from '@kernlang/agon-forge';

import type { Dispatch, HandlerContext } from './types.js';

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
  
  const getPlanDispatch = (): Dispatch | undefined => liveDispatch ?? ctx.cesar?.planDispatch ?? ctx.cesar?.lastDispatch ?? undefined;

  // Plan accepts an empty artifact as an explicit no-change outcome.
  const readPlanPatch = (path: string): { content: string } | null => {
    try { return { content: readPatchContent(path) }; }
    catch { return null; }
  };

  return createPlanStepExecutors({
    assertAvailable: assertStepAvailable,
    withAuthority: withProcessSurfaceAuthority,
    agentReview: {
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
    },
    panel: {
      outputDir,
      assertAvailable: assertStepAvailable,
      snapshot: snapshotTokens,
      activeEngines: () => ctx.activeEngines?.() ?? [],
      brainstorm: options => runBrainstorm({ ...options, registry: ctx.registry, adapter: guardedAdapter('brainstorm', options.signal) }),
      tribunal: options => runTribunal({ ...options, mode: options.mode as Parameters<typeof runTribunal>[0]['mode'], registry: ctx.registry, adapter: guardedAdapter('tribunal', options.signal) }),
      campfire: options => runCampfire({ ...options, registry: ctx.registry, adapter: guardedAdapter('campfire', options.signal) }),
      delegate: options => runDelegate({ ...options, registry: ctx.registry, adapter: guardedAdapter('delegate', options.signal) }),
    },
    forge: {
      cwd,
      outputDir,
      assertAvailable: assertStepAvailable,
      snapshot: snapshotTokens,
      getDispatch: getPlanDispatch,
      activeEngines: () => ctx.activeEngines?.() ?? [],
      mkdir: path => { mkdirSync(path, { recursive: true }); },
      readPatch: readPlanPatch,
      applyPatch: applyPatchToTree,
      run: (options, onEvent, owner) => runForge(options, ctx.registry, guardedAdapter(owner, options.signal), onEvent),
    },
    pipeline: {
      cwd,
      outputDir,
      readPatch: readPlanPatch,
      applyPatch: applyPatchToTree,
      assertAvailable: assertStepAvailable,
      isCancellation: signal => Boolean(signal?.aborted && !(signal.reason instanceof SurfaceGenerationError)),
      snapshot: snapshotTokens,
      getDispatch: () => {
        const dispatch = getPlanDispatch();
        return dispatch ? event => dispatch(event as Parameters<Dispatch>[0]) : undefined;
      },
      activeEngines: () => ctx.activeEngines?.() ?? [],
      brainstorm: options => runBrainstorm({ ...options, registry: ctx.registry, adapter: guardedAdapter('brainstorm', options.signal) }),
      tribunal: options => runTribunal({ ...options, mode: options.mode as Parameters<typeof runTribunal>[0]['mode'], registry: ctx.registry, adapter: guardedAdapter('tribunal', options.signal) }),
      forge: (options, onEvent, owner) => runForge(options, ctx.registry, guardedAdapter(owner, options.signal), onEvent),
      workflow: {
        resolve: () => {
          const spec = getCoreWorkflowRegistry().require('agon.brainstorm-forge-tribunal@v1');
          return { id: spec.id, plan: compileWorkflowSpec(spec) };
        },
        verifyPlan: verifyWorkflowExecutionPlanFlow,
        rejectPlan: throwWorkflowConformance,
        createRun: createWorkflowRun,
        append: appendWorkflowPhaseEvent,
        verifyRun: verifyWorkflowRunFlow,
      },
    },
    self: {
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
    },
  });
}
