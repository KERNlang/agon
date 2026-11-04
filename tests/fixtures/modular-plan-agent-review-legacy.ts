// Frozen Review/Agent bodies from f91bd221ece55b6ae3b47de0c59ccb0123b8977c.
// Complete CLI source SHA-256: 2e2fa6d1022a43f9ecaa86a85dee6b1667c748f1e66f94f328fe6690233726aa.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkingDir, RUNS_DIR, tracker } from '@kernlang/agon-core';
import type { CesarPlanStep, StepExecutor } from '@kernlang/agon-core';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { assertProcessPlanStepAvailable, assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, withProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { runReviewCore, resolveReviewTarget, selectReviewEngine } from '../../packages/cli/src/handlers/review.js';
import { runAgentMode, runAgentTeam } from '../../packages/cli/src/handlers/agent.js';
export function buildLegacyAgentReviewStepExecutors(ctx: HandlerContext): Record<string, StepExecutor> {
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
  
  const buildContext = (step: CesarPlanStep, context: Record<string, string | undefined>) => {
    const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
    return contextStr ? `${step.description}\n\n${contextStr}` : step.description;
  };

  return {
    // Tribunal fix #3: review step calls runReviewCore directly so it
    // does NOT touch ctx.setActiveAbort (which would nuke the plan
    // executor's own abort controller and silently break Ctrl-C for
    // the rest of the plan), ctx.lastReviewResult, or ctx.chatSession.
    review: wrap('review', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      try {
        const { diff, label } = resolveReviewTarget('uncommitted', cwd, undefined);
        if (!diff.trim()) {
          const after = snapshotTokens();
          return {
            result: {
              status: 'failure',
              actualTokens: after.tokens - before.tokens,
              actualCostUsd: after.cost - before.cost,
              durationMs: Date.now() - startTime,
              output: 'Review step found no diff in cwd; mutating steps may have written to forge outputDir without applying patches to the working tree.',
              error: 'no diff to review',
            },
          };
        }
        const engineId = selectReviewEngine(step.engine ?? undefined, ctx);
        // Tribunal fix #5b: thread plan.intent through stepContext.
        // finalizePlanWithReviewGate injects __plan_intent before
        // re-entering executePlan for the review cycle.
        // FU-5: StepExecutor's context type is now Record<string,string|undefined>
        // so the optional read no longer needs an `as any` cast.
        const intent = context['__plan_intent'] ?? step.description;
        const enrichedLabel = `${label} (verifying intent: ${String(intent).slice(0, 200)})`;
        // OpenCode fix (f2): pass signal as-is (may be undefined). The
        // dummy `new AbortController().signal` fallback was a never-
        // abortable signal that could hang the plan if the runtime ever
        // omitted the executor signal.
        const { response, blocking, parseFailed } = await runReviewCore(diff, enrichedLabel, engineId, ctx, signal);
        assertStepAvailable('review', signal);
        const after = snapshotTokens();
        if (blocking || parseFailed) {
          return {
            result: {
              status: 'failure',
              actualTokens: after.tokens - before.tokens,
              actualCostUsd: after.cost - before.cost,
              durationMs: Date.now() - startTime,
              output: response.slice(0, 2000),
              error: parseFailed ? 'review parse failed (fail-closed)' : 'blocking issues found',
            },
            contextExport: `Review ${parseFailed ? 'unparseable' : 'blocked'}: ${response.slice(0, 300)}`,
          };
        }
        return {
          result: {
            status: 'success',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: response.slice(0, 2000),
          },
          contextExport: `Review approved: ${response.slice(0, 300)}`,
        };
      } catch (err) {
        const after = snapshotTokens();
        return {
          result: {
            status: 'failure',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: '',
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  
    agent: wrap('agent', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      // Capture dispatch output for plan-step reporting. The plan
      // executor doesn't need real-time agent UI output, just the
      // final result + cost delta.
      const captured: string[] = [];
      const captureDispatch = (event: any) => {
        if (event && typeof event === 'object') {
          if (typeof event.message === 'string') captured.push(event.message);
          else if (typeof event.content === 'string') captured.push(event.content);
        }
      };
      try {
        // Codex P1: thread parentSignal so the plan executor's abort
        // controller propagates into the agent session AND the agent
        // does not clobber ctx.setActiveAbort.
        const outcome = await runAgentMode(task, captureDispatch as any, ctx, {
          engineId: step.engine ?? step.engines?.[0],
          parentSignal: signal,
          executionRefusal: executionRefusal('agent', signal),
        });
        assertStepAvailable('agent', signal);
        if (outcome?.status !== 'completed') {
          throw new Error(outcome?.summary || `Agent step did not complete (${outcome?.status ?? 'no result'})`);
        }
        const after = snapshotTokens();
        const summary = captured.slice(-20).join('\n').slice(0, 2000);
        return {
          result: {
            status: 'success',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: summary || `Agent step completed (${(after.tokens - before.tokens)} tokens)`,
          },
          contextExport: summary.slice(0, 500),
        };
      } catch (err) {
        const after = snapshotTokens();
        return {
          result: {
            status: 'failure',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: captured.slice(-10).join('\n').slice(0, 2000),
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  
    // Codex P2: wire team-agent to the in-tree runAgentTeam. Same
    // capture-dispatch + parentSignal pattern as the agent executor.
    'team-agent': wrap('team-agent', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      const captured: string[] = [];
      const captureDispatch = (event: any) => {
        if (event && typeof event === 'object') {
          if (typeof event.message === 'string') captured.push(event.message);
          else if (typeof event.content === 'string') captured.push(event.content);
        }
      };
      try {
        const outcome = await runAgentTeam(task, captureDispatch as any, ctx, {
          engines: step.engines,
          fitnessCmd: step.fitnessCmd,
          parentSignal: signal,
          executionRefusal: executionRefusal('team-agent', signal),
        });
        assertStepAvailable('team-agent', signal);
        if (outcome?.status !== 'completed') {
          throw new Error(outcome?.summary || `Team-agent step did not complete (${outcome?.status ?? 'no result'})`);
        }
        const after = snapshotTokens();
        const summary = captured.slice(-20).join('\n').slice(0, 2000);
        return {
          result: {
            status: 'success',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: summary || `Team-agent step completed (${(after.tokens - before.tokens)} tokens)`,
          },
          contextExport: summary.slice(0, 500),
        };
      } catch (err) {
        const after = snapshotTokens();
        return {
          result: {
            status: 'failure',
            actualTokens: after.tokens - before.tokens,
            actualCostUsd: after.cost - before.cost,
            durationMs: Date.now() - startTime,
            output: captured.slice(-10).join('\n').slice(0, 2000),
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  };
}
