// @kern-source: plan-mode:1
import { writeFileSync, mkdirSync } from 'node:fs';

// @kern-source: plan-mode:2
import { join } from 'node:path';

// @kern-source: plan-mode:3
import { createCesarPlan, formatCesarPlanMarkdown, planCostEstimator, resolveWorkingDir, RUNS_DIR } from '@agon/core';

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
    exports: s.exports,
    imports: s.imports,
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
  
  return {
    self: wrap(async (step, _context, _signal) => {
      const startTime = Date.now();
      return {
        result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: `Self step: ${step.description}` },
        contextExport: step.description,
      };
    }),
  
    forge: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
      const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
      try {
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, signal },
          ctx.registry, ctx.adapter,
        );
        const totalTokens = (manifest.dispatchLog ?? []).reduce((s: number, m: any) => s + (m.tokens?.prompt ?? 0) + (m.tokens?.response ?? 0), 0);
        const totalCost = (manifest.dispatchLog ?? []).reduce((s: number, m: any) => s + (m.tokens?.costUsd ?? 0), 0);
  
        if (!manifest.winner) {
          // Collect per-engine summaries for the user
          const engineSummaries = Object.entries(manifest.results ?? {}).map(([id, r]: [string, any]) => {
            return `  ${id}: ${r.pass ? 'PASS' : 'FAIL'} (score: ${r.score ?? 'N/A'}, ${r.diffLines ?? 0} lines)`;
          }).join('\n');
  
          return {
            result: {
              status: 'failure',
              actualTokens: totalTokens,
              actualCostUsd: totalCost,
              durationMs: Date.now() - startTime,
              output: `Forge produced no winner.\n\nEngine results:\n${engineSummaries}\n\nUse /plan resume after deciding: retry with different engines, or abort.`,
              error: 'No winner — all engines failed or no passing score',
            },
          };
        }
  
        return {
          result: { status: 'success', actualTokens: totalTokens, actualCostUsd: totalCost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner}` },
          contextExport: `Forge winner: ${manifest.winner}`,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    teamforge: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
      const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
      try {
        const manifest = await runForge(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, hardened: true, signal },
          ctx.registry, ctx.adapter,
        );
        return {
          result: { status: manifest.winner ? 'success' : 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: manifest.winner ? `Winner: ${manifest.winner}` : 'No winner' },
          contextExport: manifest.winner ? `TeamForge winner: ${manifest.winner}` : undefined,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    brainstorm: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
      const question = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
      try {
        const result = await runBrainstorm({ question, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
        return {
          result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: `Winner: ${result.winner}\n${result.response}` },
          contextExport: result.response,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    tribunal: wrap(async (step, context, _signal) => {
      const startTime = Date.now();
      const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
      const question = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
      try {
        const result = await runTribunal({ question, engines: step.engines ?? [], rounds: 2, mode: step.tribunalMode as any, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id) });
        return {
          result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: result.summary },
          contextExport: result.summary,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    campfire: wrap(async (step, _context, signal) => {
      const startTime = Date.now();
      try {
        const result = await runCampfire({ topic: step.description, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, strategy: 'all-respond', timeout: 120, outputDir: join(outputDir, step.id), signal });
        const summary = result.rounds.map((r: any) => `${r.engineId}: ${r.content.slice(0, 200)}`).join('\n');
        return {
          result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: summary },
          contextExport: summary,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    delegate: wrap(async (step, context, signal) => {
      const startTime = Date.now();
      const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
      const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
      try {
        const result = await runDelegate({ engineId: step.engine ?? step.engines?.[0] ?? 'claude', task, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
        return {
          result: { status: 'success', actualTokens: result.usage?.totalTokens ?? 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: result.response },
          contextExport: result.response,
        };
      } catch (err) {
        return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  
    pipeline: wrap(async (step, _context, _signal) => {
      const startTime = Date.now();
      return { result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: 'Pipeline placeholder' } };
    }),
  };
}

