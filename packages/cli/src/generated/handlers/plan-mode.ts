// @kern-source: plan-mode:1
import { writeFileSync, mkdirSync } from 'node:fs';

// @kern-source: plan-mode:2
import { join } from 'node:path';

// @kern-source: plan-mode:3
import { createCesarPlan, formatCesarPlanMarkdown, planCostEstimator, resolveWorkingDir, RUNS_DIR, tracker } from '@agon/core';

// @kern-source: plan-mode:4
import type { CesarPlan, CesarPlanStep, CesarStepResult, StepExecutor } from '@agon/core';

// @kern-source: plan-mode:5
import { runForge, runBrainstorm, runTribunal, runCampfire, runDelegate } from '@agon/forge';

// @kern-source: plan-mode:6
import type { Dispatch, HandlerContext, EngineProgress } from '../../handlers/types.js';

// @kern-source: plan-mode:8
export async function handleProposePlan(args: any, dispatch: Dispatch, ctx: HandlerContext): Promise<CesarPlan> {
  const steps: CesarPlanStep[] = (args.steps ?? []).map((s: any) => ({
    id: s.id,
    type: s.type,
    description: s.description,
    engines: s.engines,
    engine: s.engine,
    fitnessCmd: s.fitnessCmd,
    tribunalMode: s.tribunalMode,
    parallel: s.parallel ?? false,
    dependsOn: s.dependsOn,
    exports: typeof s.exports === 'string' ? [s.exports] : s.exports,
    imports: typeof s.imports === 'string' ? [s.imports] : s.imports,
    estimatedTokens: s.estimatedTokens ?? planCostEstimator.estimate(s.type, s.engines ?? []).tokens,
    estimatedCostUsd: s.estimatedCostUsd ?? planCostEstimator.estimate(s.type, s.engines ?? []).costUsd,
  }));
  
  let plan = createCesarPlan(args.intent, steps);
  plan = {
    ...plan,
    planningCost: args.planningCost ?? undefined,
    state: 'awaiting_approval' as any,
  };
  
  const slug = args.intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const filePath = join('docs', 'plans', `cesar-${Date.now()}-${slug}.md`);
  mkdirSync(join('docs', 'plans'), { recursive: true });
  writeFileSync(filePath, formatCesarPlanMarkdown(plan));
  plan = { ...plan, planFilePath: filePath };
  
  dispatch({ type: 'plan-proposal' as any, plan, markdown: formatCesarPlanMarkdown(plan) });
  return plan;
}

// @kern-source: plan-mode:43
export function buildStepExecutors(ctx: HandlerContext): Record<string,StepExecutor> {
  const cwd = resolveWorkingDir();
  const outputDir = join(RUNS_DIR, `plan-exec-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
  
  const wrap = (fn: (step: CesarPlanStep, context: Record<string,string>, signal?: AbortSignal) => Promise<{result: CesarStepResult, contextExport?: string}>): StepExecutor => ({ execute: fn });
  
  // Helper: extract token/cost from tracker delta
  const snapshotTokens = () => {
    const s = tracker.getStats();
    return { tokens: s.totalTokens, cost: s.totalCostUsd };
  };
  
  const buildContext = (step: CesarPlanStep, context: Record<string, string>) => {
    const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
    return contextStr ? `${step.description}\n\n${contextStr}` : step.description;
  };
  
  return {
    self: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      try {
        // Self step: delegate to the Cesar engine to analyze/synthesize
        const engineId = step.engine ?? step.engines?.[0] ?? 'claude';
        const result = await runDelegate({ engineId, task: `Analyze and respond:\n${task}`, registry: ctx.registry, adapter: ctx.adapter, timeout: 180, outputDir: join(outputDir, step.id), signal });
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response },
          contextExport: result.response.slice(0, 500),
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    forge: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      try {
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, signal },
          ctx.registry, ctx.adapter,
        );
        const after = snapshotTokens();
  
        if (!manifest.winner) {
          const engineSummaries = Object.entries(manifest.results ?? {}).map(([id, r]: [string, any]) => {
            return `  ${id}: ${r.pass ? 'PASS' : 'FAIL'} (score: ${r.score ?? 'N/A'}, ${r.diffLines ?? 0} lines)`;
          }).join('\n');
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `No winner.\n${engineSummaries}`, error: 'No winner' },
          };
        }
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner}` },
          contextExport: `Forge winner: ${manifest.winner}`,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    teamforge: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      try {
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, hardened: true, signal },
          ctx.registry, ctx.adapter,
        );
        const after = snapshotTokens();
        return {
          result: { status: manifest.winner ? 'success' : 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: manifest.winner ? `Winner: ${manifest.winner}` : 'No winner' },
          contextExport: manifest.winner ? `TeamForge winner: ${manifest.winner}` : undefined,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    brainstorm: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const question = buildContext(step, context);
      try {
        const result = await runBrainstorm({ question, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${result.winner}\n${result.response}` },
          contextExport: result.response,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    tribunal: wrap(async (step, context, _signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const question = buildContext(step, context);
      try {
        const result = await runTribunal({ question, engines: step.engines ?? [], rounds: 2, mode: step.tribunalMode as any, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id) });
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.summary },
          contextExport: result.summary,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    campfire: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const topic = buildContext(step, context);
      try {
        const result = await runCampfire({ topic, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, strategy: 'all-respond', timeout: 120, outputDir: join(outputDir, step.id), signal });
        const after = snapshotTokens();
        const summary = result.rounds.map((r: any) => `${r.engineId}: ${r.content.slice(0, 200)}`).join('\n');
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: summary },
          contextExport: summary,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    delegate: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      try {
        const result = await runDelegate({ engineId: step.engine ?? step.engines?.[0] ?? 'claude', task, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response },
          contextExport: result.response.slice(0, 500),
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    pipeline: wrap(async (step, context, signal) => {
      // Pipeline = brainstorm → forge → tribunal chain
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      let pipelineContext = '';
      try {
        // 1. Brainstorm — get approach bids
        const bsResult = await runBrainstorm({ question: task, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id, 'brainstorm'), signal });
        pipelineContext = bsResult.response;
  
        // 2. Forge — compete on implementation
        const forgeTask = `${task}\n\nBrainstorm winner approach:\n${pipelineContext}`;
        const manifest = await runForge(
          { task: forgeTask, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id, 'forge'), engines: step.engines, signal },
          ctx.registry, ctx.adapter,
        );
        if (!manifest.winner) {
          const after = snapshotTokens();
          return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'Pipeline forge step: no winner', error: 'Forge produced no winner' } };
        }
  
        // 3. Tribunal — review the forge winner
        const tribunalQ = `Review the implementation from forge winner ${manifest.winner} for: ${task}`;
        const tResult = await runTribunal({ question: tribunalQ, engines: (step.engines ?? []).slice(0, 3), rounds: 2, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id, 'tribunal') });
  
        const after = snapshotTokens();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Pipeline: brainstorm → forge (${manifest.winner}) → tribunal\n${tResult.summary}` },
          contextExport: `Pipeline result: forge winner ${manifest.winner}. Tribunal: ${tResult.summary.slice(0, 300)}`,
        };
      } catch (err) {
        const after = snapshotTokens();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: pipelineContext ? `Partial pipeline (brainstorm done): ${pipelineContext.slice(0, 200)}` : '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  };
}

