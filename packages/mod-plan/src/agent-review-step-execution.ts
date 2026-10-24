import type { StepExecutor } from './executor.js';
import { buildPlanStepContext } from './panel-step-execution.js';

export type PlanAgentReviewStepType = 'review' | 'agent' | 'team-agent';

export interface PlanAgentStepOutcome {
  status: string;
  summary?: string;
}

/** Narrow host effects: no mutable CLI session crosses the Plan package boundary. */
export interface PlanAgentReviewHost {
  assertAvailable(type: PlanAgentReviewStepType, signal?: AbortSignal): void;
  snapshot(): { tokens: number; cost: number };
  reviewTarget(): { diff: string; label: string };
  selectReviewEngine(requested?: string): string;
  review(diff: string, label: string, engineId: string, signal?: AbortSignal): Promise<{
    response: string; blocking: boolean; parseFailed: boolean;
  }>;
  agent(task: string, emit: (event: unknown) => void, options: {
    engineId?: string; parentSignal?: AbortSignal;
  }): Promise<PlanAgentStepOutcome | null | undefined>;
  teamAgent(task: string, emit: (event: unknown) => void, options: {
    engines?: string[]; fitnessCmd?: string; parentSignal?: AbortSignal;
  }): Promise<PlanAgentStepOutcome | null | undefined>;
}

export function createAgentReviewStepExecutors(host: PlanAgentReviewHost): Record<PlanAgentReviewStepType, StepExecutor> {
  const assertReturnedAuthority = (type: PlanAgentReviewStepType, signal?: AbortSignal): void => {
    signal?.throwIfAborted();
    host.assertAvailable(type, signal);
  };
  const wrap = (type: PlanAgentReviewStepType, execute: StepExecutor['execute']): StepExecutor => ({
    async execute(step, context, signal) {
      assertReturnedAuthority(type, signal);
      return execute(step, context, signal);
    },
  });
  return {
    // Bind a stateless review backend, not an interactive handler that replaces
    // the plan's abort controller, review result, or chat session.
    review: wrap('review', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      try {
        const { diff, label } = host.reviewTarget();
        if (!diff.trim()) {
          const after = host.snapshot();
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
        const engineId = host.selectReviewEngine(step.engine ?? undefined);
        // The coordinator injects the plan intent before its review cycle.
        const intent = context['__plan_intent'] ?? step.description;
        const enrichedLabel = `${label} (verifying intent: ${String(intent).slice(0, 200)})`;
        // Preserve undefined; a substitute controller would not receive cancellation.
        const { response, blocking, parseFailed } = await host.review(diff, enrichedLabel, engineId, signal);
        assertReturnedAuthority('review', signal);
        const after = host.snapshot();
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
        const after = host.snapshot();
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
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      // Capture dispatch output for plan-step reporting. The plan
      // executor doesn't need real-time agent UI output, just the
      // final result + cost delta.
      const captured: string[] = [];
      const captureDispatch = (event: unknown) => {
        if (event && typeof event === 'object') {
          const output = event as { message?: unknown; content?: unknown };
          if (typeof output.message === 'string') captured.push(output.message);
          else if (typeof output.content === 'string') captured.push(output.content);
        }
      };
      try {
        // The backend must use the parent signal without replacing plan cancellation.
        const outcome = await host.agent(task, captureDispatch, {
          engineId: step.engine ?? step.engines?.[0],
          parentSignal: signal,
        });
        assertReturnedAuthority('agent', signal);
        if (outcome?.status !== 'completed') {
          throw new Error(outcome?.summary || `Agent step did not complete (${outcome?.status ?? 'no result'})`);
        }
        const after = host.snapshot();
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
        const after = host.snapshot();
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
  
    // Team execution preserves the same event capture and parent-signal contract.
    'team-agent': wrap('team-agent', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      const captured: string[] = [];
      const captureDispatch = (event: unknown) => {
        if (event && typeof event === 'object') {
          const output = event as { message?: unknown; content?: unknown };
          if (typeof output.message === 'string') captured.push(output.message);
          else if (typeof output.content === 'string') captured.push(output.content);
        }
      };
      try {
        const outcome = await host.teamAgent(task, captureDispatch, {
          engines: step.engines,
          fitnessCmd: step.fitnessCmd,
          parentSignal: signal,
        });
        assertReturnedAuthority('team-agent', signal);
        if (outcome?.status !== 'completed') {
          throw new Error(outcome?.summary || `Team-agent step did not complete (${outcome?.status ?? 'no result'})`);
        }
        const after = host.snapshot();
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
        const after = host.snapshot();
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
