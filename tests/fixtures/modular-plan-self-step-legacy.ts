// Frozen Self body from d3bc97278beee5a6ecfdbd078af99a8374b5e7b1.
// Complete CLI source SHA-256: 2ccf85d447780419eb0ea0631715a5d5c3a3c9edccac84252ef03de783504e55.
// Constructor retains the legacy authority wrapper. Unrelated executors are omitted.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkingDir, RUNS_DIR, tracker, spawnWithTimeout } from '@kernlang/agon-core';
import type { CesarPlanStep, StepExecutor } from '@kernlang/agon-core';
import { runDelegate } from '@kernlang/agon-forge';
import type { HandlerContext, Dispatch } from '../../packages/cli/src/handlers/types.js';
import { assertProcessPlanStepAvailable, assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, guardProcessEngineAdapter, withProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { handleCesarBrain } from '../../packages/cli/src/cesar/brain.js';
export function buildLegacySelfStepExecutor(ctx: HandlerContext, liveDispatch?: Dispatch): Record<string,StepExecutor> {
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

  return {
    self: wrap('self', async (step, context, signal) => {
      const startTime = Date.now();
      const before = snapshotTokens();
      const task = buildContext(step, context);
      // A finished Cesar turn is NOT proof the work is correct. If the step
      // declares a verifyCmd, run it and gate success on its real exit code —
      // this is what stops an engine reporting "done/all green" when the gate
      // is actually red (the 88ba7aa4 false-green class).
      const runVerifyGate = async (): Promise<{ ok: true } | { ok: false, error: string }> => {
        if (!step.verifyCmd) return { ok: true };
        const v = await spawnWithTimeout({ command: 'bash', args: ['-lc', step.verifyCmd], cwd, timeout: 600000, signal });
        if (v.timedOut || v.exitCode !== 0) {
          const tail = `${v.stdout ?? ''}\n${v.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
          return { ok: false, error: `verify failed (exit ${v.exitCode ?? '?'}${v.timedOut ? ', timed out' : ''}): ${step.verifyCmd}\n${tail}` };
        }
        return { ok: true };
      };
      try {
        // Claude-style auto mode: a Cesar self-step must run through the
        // same live tool loop as a normal Cesar turn so the user sees each
        // Read/Edit/Bash and can interrupt instead of watching an opaque
        // delegate call. Fall back to runDelegate only when no dispatch is
        // available, which can happen in non-REPL tests or library callers.
        const engineId = step.engine ?? step.engines?.[0] ?? 'claude';
        const dispatch = liveDispatch ?? ctx.cesar?.planDispatch ?? ctx.cesar?.lastDispatch;
        if (dispatch) {
          const captured: string[] = [];
          const stepDispatch = (event: any) => {
            dispatch(event);
            if (event?.type === 'engine-block' && typeof event.content === 'string') captured.push(event.content);
            else if (event?.type === 'streaming-chunk' && typeof event.chunk === 'string') captured.push(event.chunk);
            else if (event?.type === 'tool-call' && (event.status === 'done' || event.status === 'error')) {
              const status = event.status === 'error' ? 'failed' : 'done';
              captured.push(`[tool:${event.tool}:${status}]`);
            }
          };
          const prompt = [
            '[APPROVED PLAN STEP]',
            'Execute this already-approved Agon plan step now.',
            'Do not call ProposePlan. Do not propose another plan. Do not ask whether to start.',
            'Use the available tools directly and stream each tool call normally.',
            `Step ${step.id}: ${task}`,
            '',
            'When the step is complete, finish with a concise recap of what changed and what remains.',
          ].join('\n');
          let outcome = await handleCesarBrain(prompt, stepDispatch as any, ctx, []);
          // Deadlock guard: a weak brain may IGNORE the "do not ask whether to start"
          // instruction and stall, awaiting a greenlight it cannot receive while the
          // plan owns the REPL (it never goes idle). Give it ONE forceful override
          // retry; if it STILL stalls, PAUSE the plan to idle so the user can respond.
          let retryOutputStart = captured.length;
          if (outcome.awaitingUserInput && !signal?.aborted) {
            stepDispatch({ type: 'warning', message: 'Cesar stalled awaiting input on a pre-approved step — forcing one retry.' } as any);
            const overridePrompt = [
              '[EXECUTOR OVERRIDE] This plan step is ALREADY APPROVED by the user. Proceed and DO IT NOW.',
              'Do NOT ask for approval, a greenlight, or confirmation. Do NOT say you are holding or waiting.',
              'Use the available tools to complete the step. If you are TRULY blocked, end with one concrete question.',
              `Step ${step.id}: ${task}`,
            ].join('\n');
            retryOutputStart = captured.length; // pause message shows only the RETRY's output, not the first stalled run
            outcome = await handleCesarBrain(overridePrompt, stepDispatch as any, ctx, []);
          }
          const after = snapshotTokens();
          if (signal?.aborted || outcome.decisionReason === 'aborted') {
            return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: captured.join('\n').trim(), error: 'cancelled' } };
          }
          if (outcome.awaitingUserInput) {
            // Still awaiting after the override → pause the plan to idle. advanceCesarStep
            // leaves the step pending (re-runs on /plan resume) and sets plan.state='paused'.
            const retryLines = captured.slice(retryOutputStart);
            const ask = (retryLines.length ? retryLines : captured).join('\n').trim().split('\n').filter((l) => l.trim()).slice(-4).join('\n');
            stepDispatch({ type: 'warning', message: `⏸ Plan paused — Cesar is waiting on you before continuing:\n${ask}\n\nType your answer, then /plan resume to continue (or /cancel).` } as any);
            return { result: { status: 'paused', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: captured.join('\n').trim(), error: 'Cesar is awaiting your input on this approved step' } };
          }
          const output = captured.join('\n').trim() || `Cesar completed step ${step.id}.`;
          if (step.verifyCmd) stepDispatch({ type: 'info', message: `Verifying step ${step.id}: ${step.verifyCmd}` } as any);
          const verified = await runVerifyGate();
          const afterVerify = snapshotTokens();
          if (!verified.ok) {
            return { result: { status: 'failure', actualTokens: afterVerify.tokens - before.tokens, actualCostUsd: afterVerify.cost - before.cost, durationMs: Date.now() - startTime, output, error: verified.error } };
          }
          return {
            result: { status: 'success', actualTokens: afterVerify.tokens - before.tokens, actualCostUsd: afterVerify.cost - before.cost, durationMs: Date.now() - startTime, output },
            contextExport: output.slice(0, 500),
          };
        }
        assertProcessPlanStepAvailable('delegate');
        const result = await runDelegate({ engineId, task: `Analyze and respond:\n${task}`, registry: ctx.registry, adapter: guardedAdapter('delegate', signal), timeout: 180, outputDir: join(outputDir, step.id), signal });
        assertStepAvailable('delegate', signal);
        const verifiedDelegate = await runVerifyGate();
        assertStepAvailable('delegate', signal);
        const after = snapshotTokens();
        if (!verifiedDelegate.ok) {
          return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response, error: verifiedDelegate.error } };
        }
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
