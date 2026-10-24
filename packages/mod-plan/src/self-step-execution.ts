import { join } from 'node:path';
import type { StepExecutor } from './executor.js';
import { buildPlanStepContext } from './panel-step-execution.js';

/** Only the event fields inspected by Plan. Other fields pass through unchanged. */
export interface PlanSelfEvent {
  type: string;
  content?: unknown;
  chunk?: unknown;
  status?: unknown;
  tool?: unknown;
}
export interface PlanSelfNotice {
  type: 'warning' | 'info';
  message: string;
}
export interface PlanSelfStepHost<Event extends PlanSelfEvent = PlanSelfEvent> {
  cwd: string;
  outputDir: string;
  assertAvailable(type: 'self' | 'delegate', signal?: AbortSignal): void;
  snapshot(): { tokens: number; cost: number };
  getDispatch(): ((event: Event | PlanSelfNotice) => void) | undefined;
  brain(prompt: string, emit: (event: Event | PlanSelfNotice) => void, signal?: AbortSignal): Promise<{
    awaitingUserInput?: boolean; decisionReason?: string;
    terminalState?: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'superseded';
  }>;
  verify(options: { command: string; args: string[]; cwd: string; timeout: number; signal?: AbortSignal }): Promise<{
    exitCode: number | null; timedOut: boolean; stdout?: string; stderr?: string;
  }>;
  delegate(options: { engineId: string; task: string; timeout: number; outputDir: string; signal?: AbortSignal }): Promise<{ response: string }>;
}

export function createSelfStepExecutor<Event extends PlanSelfEvent>(host: PlanSelfStepHost<Event>): StepExecutor {
  const assertCurrentAuthority = (signal?: AbortSignal): void => {
    signal?.throwIfAborted();
    host.assertAvailable('self', signal);
  };
  return {
    async execute(step, context, signal) {
      assertCurrentAuthority(signal);
      const startTime = Date.now();
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      const captured: string[] = [];
      let delegateOutput = '';
      const assertBrainNotFailed = (outcome: Awaited<ReturnType<typeof host.brain>>): void => {
        assertCurrentAuthority(signal);
        if (outcome.decisionReason === 'aborted') throw new Error('cancelled');
        if (outcome.terminalState && outcome.terminalState !== 'completed') {
          throw new Error(`Cesar ${outcome.terminalState}${outcome.decisionReason ? `: ${outcome.decisionReason}` : ''}`);
        }
      };
      // A finished Cesar turn is NOT proof the work is correct. If the step
      // declares a verifyCmd, run it and gate success on its real exit code —
      // this is what stops an engine reporting "done/all green" when the gate
      // is actually red (the 88ba7aa4 false-green class).
      const runVerifyGate = async (): Promise<{ ok: true } | { ok: false, error: string }> => {
        assertCurrentAuthority(signal);
        if (!step.verifyCmd) return { ok: true };
        const v = await host.verify({ command: 'bash', args: ['-lc', step.verifyCmd], cwd: host.cwd, timeout: 600000, signal });
        assertCurrentAuthority(signal);
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
        const dispatch = host.getDispatch();
        if (dispatch) {
          const stepDispatch = (event: Event | PlanSelfNotice) => {
            const output: PlanSelfEvent = event;
            if ((output?.type === 'tool-call' || output?.type === 'tool-stream-end') && (output.status === 'done' || output.status === 'error')) {
              const status = output.status === 'error' ? 'failed' : 'done';
              captured.push(`[tool:${output.tool}:${status}]`);
            }
            assertCurrentAuthority(signal);
            dispatch(event);
            if (output?.type === 'engine-block' && typeof output.content === 'string') captured.push(output.content);
            else if (output?.type === 'streaming-chunk' && typeof output.chunk === 'string') captured.push(output.chunk);
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
          let outcome = await host.brain(prompt, stepDispatch, signal);
          assertBrainNotFailed(outcome);
          // Deadlock guard: a weak brain may IGNORE the "do not ask whether to start"
          // instruction and stall, awaiting a greenlight it cannot receive while the
          // plan owns the REPL (it never goes idle). Give it ONE forceful override
          // retry; if it STILL stalls, PAUSE the plan to idle so the user can respond.
          let retryOutputStart = captured.length;
          if (outcome.awaitingUserInput && !signal?.aborted) {
            stepDispatch({ type: 'warning', message: 'Cesar stalled awaiting input on a pre-approved step — forcing one retry.' });
            const overridePrompt = [
              '[EXECUTOR OVERRIDE] This plan step is ALREADY APPROVED by the user. Proceed and DO IT NOW.',
              'Do NOT ask for approval, a greenlight, or confirmation. Do NOT say you are holding or waiting.',
              'Use the available tools to complete the step. If you are TRULY blocked, end with one concrete question.',
              `Step ${step.id}: ${task}`,
            ].join('\n');
            retryOutputStart = captured.length; // pause message shows only the RETRY's output, not the first stalled run
            assertCurrentAuthority(signal);
            outcome = await host.brain(overridePrompt, stepDispatch, signal);
            assertBrainNotFailed(outcome);
          }
          const after = host.snapshot();
          if (signal?.aborted || outcome.decisionReason === 'aborted') {
            return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: captured.join('\n').trim(), error: 'cancelled' } };
          }
          if (outcome.awaitingUserInput) {
            // Still awaiting after the override → pause the plan to idle. advanceCesarStep
            // leaves the step pending (re-runs on /plan resume) and sets plan.state='paused'.
            const retryLines = captured.slice(retryOutputStart);
            const ask = (retryLines.length ? retryLines : captured).join('\n').trim().split('\n').filter((l) => l.trim()).slice(-4).join('\n');
            stepDispatch({ type: 'warning', message: `⏸ Plan paused — Cesar is waiting on you before continuing:\n${ask}\n\nType your answer, then /plan resume to continue (or /cancel).` });
            return { result: { status: 'paused', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: captured.join('\n').trim(), error: 'Cesar is awaiting your input on this approved step' } };
          }
          const output = captured.join('\n').trim() || `Cesar completed step ${step.id}.`;
          if (step.verifyCmd) stepDispatch({ type: 'info', message: `Verifying step ${step.id}: ${step.verifyCmd}` });
          const verified = await runVerifyGate();
          const afterVerify = host.snapshot();
          if (!verified.ok) {
            return { result: { status: 'failure', actualTokens: afterVerify.tokens - before.tokens, actualCostUsd: afterVerify.cost - before.cost, durationMs: Date.now() - startTime, output, error: verified.error } };
          }
          return {
            result: { status: 'success', actualTokens: afterVerify.tokens - before.tokens, actualCostUsd: afterVerify.cost - before.cost, durationMs: Date.now() - startTime, output },
            contextExport: output.slice(0, 500),
          };
        }
        host.assertAvailable('delegate', signal);
        const result = await host.delegate({ engineId, task: `Analyze and respond:\n${task}`, timeout: 180, outputDir: join(host.outputDir, step.id), signal });
        delegateOutput = result.response;
        host.assertAvailable('delegate', signal);
        const verifiedDelegate = await runVerifyGate();
        host.assertAvailable('delegate', signal);
        const after = host.snapshot();
        if (!verifiedDelegate.ok) {
          return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response, error: verifiedDelegate.error } };
        }
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response },
          contextExport: result.response.slice(0, 500),
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: captured.join('\n').trim() || delegateOutput, error: signal?.aborted && err instanceof Error && err.name === 'AbortError' ? 'cancelled' : err instanceof Error ? err.message : String(err) } };
      }
    },
  };
}
