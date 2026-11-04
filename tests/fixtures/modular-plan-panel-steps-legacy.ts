// Frozen Git tree: 9a9919e319260c2ac46fc23b818e13fa40906846.
// Source: packages/cli/src/handlers/plan-mode.ts.
// Constructor, helpers and panel branches retain source text except blank-line spaces.
// Unrelated branches are omitted.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkingDir, RUNS_DIR, tracker } from '@kernlang/agon-core';
import type { CesarPlanStep, StepExecutor } from '@kernlang/agon-core';
import { runBrainstorm, runTribunal, runCampfire, runDelegate } from '@kernlang/agon-forge';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { assertProcessPlanStepAvailable, assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, guardProcessEngineAdapter, withProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
export function buildLegacyPanelStepExecutors(ctx: HandlerContext): Record<string, StepExecutor> {
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

  // Helper: extract token/cost from tracker delta.
  // meteredCostUsd, NOT totalCostUsd: only real per-token billing counts as a
  // step's "actual" spend. The ballpark total priced flat-rate engines at a
  // made-up default rate and fed the budget warning fabricated dollars
  // ($8.79 "actual" on a $0-marginal kimi coding-plan run, 2026-06-11).
  const snapshotTokens = () => {
    const s = tracker.getStats();
    return { tokens: s.totalTokens, cost: s.meteredCostUsd };
  };

  const buildContext = (step: CesarPlanStep, context: Record<string, string | undefined>) => {
    const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
    return contextStr ? `${step.description}\n\n${contextStr}` : step.description;
  };

  const resolveStepEngines = (step: CesarPlanStep): string[] | undefined => {
    const explicit = (step.engines ?? []).filter((id: any) => typeof id === 'string' && id.trim().length > 0);
    if (explicit.length > 0) return explicit;
    try {
      const active = ctx.activeEngines?.() ?? [];
      const clean = active.filter((id: any) => typeof id === 'string' && id.trim().length > 0);
      if (clean.length > 0) return clean;
    } catch {
      // Fall through to runForge's config fallback for non-REPL callers.
    }
    return undefined;
  };

  void cwd;
  return {
    brainstorm: wrap('brainstorm', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const question = buildContext(step, context);
      try {
        const result = await runBrainstorm({ question, engines: resolveStepEngines(step) ?? [], registry: ctx.registry, adapter: guardedAdapter('brainstorm', signal), timeout: 120, outputDir: join(outputDir, step.id), signal });
        assertStepAvailable('brainstorm', signal);
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

    tribunal: wrap('tribunal', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const question = buildContext(step, context);
      try {
        // FU-1: thread signal so plan-level cancel propagates into the
        // tribunal's per-round dispatch loop.
        const result = await runTribunal({ question, engines: resolveStepEngines(step) ?? [], rounds: 2, mode: step.tribunalMode as any, registry: ctx.registry, adapter: guardedAdapter('tribunal', signal), timeout: 120, outputDir: join(outputDir, step.id), signal });
        assertStepAvailable('tribunal', signal);
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

    campfire: wrap('campfire', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const topic = buildContext(step, context);
      try {
        const result = await runCampfire({ topic, engines: resolveStepEngines(step) ?? [], registry: ctx.registry, adapter: guardedAdapter('campfire', signal), strategy: 'all-respond', timeout: 120, outputDir: join(outputDir, step.id), signal });
        assertStepAvailable('campfire', signal);
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

    delegate: wrap('delegate', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      try {
        const result = await runDelegate({ engineId: step.engine ?? step.engines?.[0] ?? 'claude', task, registry: ctx.registry, adapter: guardedAdapter('delegate', signal), timeout: 120, outputDir: join(outputDir, step.id), signal });
        assertStepAvailable('delegate', signal);
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

  };
}
