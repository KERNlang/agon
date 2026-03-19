import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ensureAgonHome,
  RUNS_DIR,
  createPlan,
  approvePlan,
  startPlan,
  mergeStepResult,
  cancelPlan,
  failPlan,
  savePlan,
  scanProjectContext,
  getActiveWorkspace,
  snapshotWorkspace,
  tracker,
} from '@agon/core';
import type { Plan, PlanStepInput, ApprovalLevel } from '@agon/core';
import { runForge } from '@agon/forge';
import { ENGINE_COLORS } from '../output.js';
import type { Dispatch, HandlerContext, EngineProgress } from './types.js';

export async function handleForge(
  task: string,
  fitnessCmd: string | null,
  dispatch: Dispatch,
  ctx: HandlerContext,
  existingPlan?: Plan,
): Promise<void> {
  ensureAgonHome();

  if (!task) {
    dispatch({ type: 'warning', message: 'No task provided. Usage: "fix the auth bug, test with npm test"' });
    return;
  }

  let fitness = fitnessCmd;
  if (!fitness) {
    fitness = await ctx.askQuestion('What command tests this?');
    fitness = fitness.trim();
    if (!fitness) {
      dispatch({ type: 'warning', message: 'Forge needs a test command. Try again with: "fix X, test with npm test"' });
      return;
    }
  }

  const engines = ctx.activeEngines();
  if (engines.length === 0) {
    dispatch({ type: 'error', message: 'No engines available. Install at least one AI CLI tool.' });
    return;
  }

  const config = ctx.config;
  let plan: Plan;

  if (existingPlan) {
    plan = startPlan(existingPlan);
    ctx.setCurrentPlan(plan);
    savePlan(plan);
  } else {
    const ws = getActiveWorkspace();
    const snapshot = ws
      ? snapshotWorkspace(ws)
      : { id: 'cwd', path: process.cwd(), headSha: 'unknown', branch: 'unknown', dirty: false };

    const forgeSteps: PlanStepInput[] = [
      { id: 'baseline', kind: 'fitness', label: 'Baseline fitness check', effects: ['exec'] },
      { id: 'dispatch', kind: 'dispatch', label: `Dispatch engines: ${engines.join(', ')}`, effects: ['exec', 'write', 'network'] },
      { id: 'score', kind: 'fitness', label: 'Score engine results', effects: ['exec', 'read'] },
      { id: 'winner', kind: 'dispatch', label: 'Determine winner', effects: ['read'] },
    ];
    if (config.forgeEnableSynthesis) {
      forgeSteps.push({ id: 'synthesis', kind: 'synthesis', label: 'Critique & synthesize', effects: ['exec', 'write', 'network'] });
    }

    plan = createPlan(
      { type: 'forge', task, fitnessCmd: fitness, engines },
      snapshot,
      forgeSteps,
    );
    ctx.setCurrentPlan(plan);

    dispatch({ type: 'plan', plan });

    const approvalLevel = (config.approvalLevel ?? 'plan') as ApprovalLevel;
    if (approvalLevel !== 'auto') {
      const answer = await ctx.askQuestion('Approve plan? [Y/n]');
      if (answer.trim().toLowerCase() === 'n') {
        plan = cancelPlan(plan);
        ctx.setCurrentPlan(plan);
        savePlan(plan);
        dispatch({ type: 'info', message: 'Plan cancelled.' });
        return;
      }
    }

    plan = approvePlan(plan);
    plan = startPlan(plan);
    ctx.setCurrentPlan(plan);
    savePlan(plan);
  }

  const forgeDir = join(RUNS_DIR, `forge-${Date.now()}`);
  mkdirSync(forgeDir, { recursive: true });

  const projectCtx = scanProjectContext(process.cwd(), config.projectContext || undefined, config.contextFormat);

  // Engine progress tracking
  const engineStatus: Record<string, string> = {};
  const startTime = Date.now();

  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const progress: EngineProgress[] = engines.map((id) => {
      const status = engineStatus[id] ?? 'queued';
      return {
        id,
        status: status === 'done' ? `done (${engineStatus[`${id}:score`] ?? '?'})` : status,
        elapsed,
        done: status === 'done',
        failed: false,
        score: engineStatus[`${id}:score`],
      };
    });
    dispatch({ type: 'progress-update', engines: progress });
  }, 250);

  const forgeAbort = new AbortController();
  ctx.setActiveAbort(forgeAbort);

  let manifest;
  try {
    manifest = await runForge(
      {
        task,
        fitnessCmd: fitness,
        cwd: process.cwd(),
        forgeDir,
        engines,
        context: projectCtx,
        signal: forgeAbort.signal,
      },
      ctx.registry,
      ctx.adapter,
      (event) => {
        if (ctx.currentPlan?.state === 'cancelled') return;
        const id = event.engineId ?? '';

        switch (event.type) {
          case 'baseline:start':
            plan = mergeStepResult(plan, 'baseline', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            break;
          case 'baseline:done':
            plan = mergeStepResult(plan, 'baseline', { state: 'completed' });
            if (event.data?.passes) {
              dispatch({ type: 'warning', message: 'Baseline passes — fitness test may be non-discriminating' });
            }
            break;
          case 'stage1:dispatch':
            plan = mergeStepResult(plan, 'dispatch', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            engineStatus[id] = 'building';
            break;
          case 'stage2:dispatch':
            engineStatus[id] = 'building';
            break;
          case 'stage1:accepted':
            engineStatus[id] = 'done';
            engineStatus[`${id}:score`] = String(event.data?.score ?? '?');
            break;
          case 'stage1:score':
          case 'stage2:score': {
            const scoreStep = plan.steps.find((s) => s.id === 'score');
            if (scoreStep && scoreStep.result.state === 'pending') {
              plan = mergeStepResult(plan, 'score', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            }
            break;
          }
          case 'winner:determined': {
            plan = mergeStepResult(plan, 'dispatch', { state: 'completed' });
            plan = mergeStepResult(plan, 'score', { state: 'completed' });
            plan = mergeStepResult(plan, 'winner', { state: 'completed' });
            if (event.data?.winner) {
              engineStatus[String(event.data.winner)] = 'done';
              engineStatus[`${String(event.data.winner)}:score`] = String(event.data.bestScore ?? '?');
            }
            break;
          }
          case 'synthesis:start':
            plan = mergeStepResult(plan, 'synthesis', { state: 'running', attempts: [{ startedAt: new Date().toISOString() }] });
            break;
          case 'synthesis:done':
            plan = mergeStepResult(plan, 'synthesis', { state: 'completed' });
            break;
        }
        ctx.setCurrentPlan(plan);
      },
    );
  } catch (err) {
    clearInterval(progressInterval);
    dispatch({ type: 'progress-clear' });
    ctx.setActiveAbort(null);
    if (ctx.currentPlan?.state !== 'cancelled') {
      const errorMsg = err instanceof Error ? err.message : String(err);
      plan = failPlan(plan, errorMsg);
      ctx.setCurrentPlan(plan);
      savePlan(plan);
    }
    throw err;
  }

  ctx.setActiveAbort(null);
  clearInterval(progressInterval);
  dispatch({ type: 'progress-clear' });

  // Final scoreboard
  const engineIds = Object.keys(manifest.results);
  const results = Object.values(manifest.results);

  dispatch({
    type: 'scoreboard',
    title: 'Forge Scoreboard',
    engineIds,
    winner: manifest.winner ?? undefined,
    metrics: [
      { label: 'Fitness', values: results.map((r) => r.pass ? `PASS (${r.score})` : 'FAIL') },
      { label: 'Score', values: results.map((r) => String(r.score)) },
      { label: 'Diff size', values: results.map((r) => `${r.diffLines} lines`) },
      { label: 'Files changed', values: results.map((r) => String(r.filesChanged)) },
      { label: 'Time', values: results.map((r) => `${r.durationSec}s`) },
    ],
  });

  if (manifest.winner) {
    dispatch({ type: 'success', message: `Winner: ${manifest.winner}` });
    dispatch({ type: 'info', message: `Patch: ${manifest.patches[manifest.winner]}` });
  } else {
    dispatch({ type: 'error', message: 'No winner — all engines failed' });
  }
  dispatch({ type: 'info', message: `Manifest: ${forgeDir}/manifest.json` });

  // Finalize plan
  for (const step of plan.steps) {
    if (step.result.state === 'pending' || step.result.state === 'running') {
      plan = mergeStepResult(plan, step.id, { state: 'completed' });
    }
  }

  const anyPassed = Object.values(manifest.results).some((r) => r.pass);
  const winnerArtifacts = [
    { type: 'manifest' as const, path: `${forgeDir}/manifest.json` },
    ...(manifest.winner && manifest.patches[manifest.winner]
      ? [{ type: 'patch' as const, path: manifest.patches[manifest.winner], engineId: manifest.winner }]
      : []),
  ];
  plan = mergeStepResult(plan, 'winner', { state: 'completed', artifacts: winnerArtifacts });

  if (!anyPassed) {
    plan = { ...plan, state: 'failed', currentStepId: null, updatedAt: new Date().toISOString() };
  }
  ctx.setCurrentPlan(plan);
  savePlan(plan);
  dispatch({ type: 'info', message: `Plan: ${plan.id}` });

  for (const [id, r] of Object.entries(manifest.results)) {
    tracker.record(id, task, `score:${r.score} diff:${r.diffLines}`);
  }
}
