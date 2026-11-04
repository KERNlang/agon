import { join } from 'node:path';
import type { CesarPlanStep } from './execution-model.js';
import type { StepExecutor } from './executor.js';

export type PlanPanelStepType = 'brainstorm' | 'tribunal' | 'campfire' | 'delegate';

interface PanelCall {
  engines: string[];
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
}

/** Plan owns step policy; the host supplies authority, billing, and backend capabilities.
 * No registry, adapter, personal configuration, or legacy module crosses this boundary.
 */
export interface PlanPanelStepHost {
  outputDir: string;
  assertAvailable(type: PlanPanelStepType, signal?: AbortSignal): void;
  snapshot(): { tokens: number; cost: number };
  activeEngines?(): string[];
  brainstorm(options: PanelCall & { question: string }): Promise<{ winner: string | null; response: string }>;
  tribunal(options: PanelCall & { question: string; rounds: number; mode?: string }): Promise<{ summary: string }>;
  campfire(options: PanelCall & { topic: string; strategy: 'all-respond' }): Promise<{ rounds: { engineId: string; content: string }[] }>;
  delegate(options: Omit<PanelCall, 'engines'> & { engineId: string; task: string }): Promise<{ response: string }>;
}

export function buildPlanStepContext(step: CesarPlanStep, context: Record<string, string | undefined>): string {
  const contextStr = (step.imports ?? []).map(k => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
  return contextStr ? `${step.description}\n\n${contextStr}` : step.description;
}

export function resolvePlanStepEngines(step: CesarPlanStep, activeEngines?: () => string[]): string[] | undefined {
  const explicit = (step.engines ?? []).filter(id => typeof id === 'string' && id.trim().length > 0);
  if (explicit.length > 0) return explicit;
  try {
    const clean = (activeEngines?.() ?? []).filter(id => typeof id === 'string' && id.trim().length > 0);
    if (clean.length > 0) return clean;
  } catch {
    // Preserve the backend's configured fallback for callers without a live session.
  }
  return undefined;
}

export function createPanelStepExecutors(host: PlanPanelStepHost): Record<PlanPanelStepType, StepExecutor> {
  const activeEngines = () => host.activeEngines?.() ?? [];
  const assertReturnedAuthority = (type: PlanPanelStepType, signal?: AbortSignal): void => {
    signal?.throwIfAborted();
    host.assertAvailable(type, signal);
  };
  const wrap = (type: PlanPanelStepType, execute: StepExecutor['execute']): StepExecutor => ({
    async execute(step, context, signal) {
      signal?.throwIfAborted();
      host.assertAvailable(type, signal);
      return execute(step, context, signal);
    },
  });
  return {
    brainstorm: wrap('brainstorm', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const question = buildPlanStepContext(step, context);
      try {
        const result = await host.brainstorm({ question, engines: resolvePlanStepEngines(step, activeEngines) ?? [], timeout: 120, outputDir: join(host.outputDir, step.id), signal });
        assertReturnedAuthority('brainstorm', signal);
        const after = host.snapshot();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${result.winner}\n${result.response}` },
          contextExport: result.response,
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),

    tribunal: wrap('tribunal', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const question = buildPlanStepContext(step, context);
      try {
        // FU-1: thread signal so plan-level cancel propagates into the
        // tribunal's per-round dispatch loop.
        const result = await host.tribunal({ question, engines: resolvePlanStepEngines(step, activeEngines) ?? [], rounds: 2, mode: step.tribunalMode, timeout: 120, outputDir: join(host.outputDir, step.id), signal });
        assertReturnedAuthority('tribunal', signal);
        const after = host.snapshot();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.summary },
          contextExport: result.summary,
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),

    campfire: wrap('campfire', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const topic = buildPlanStepContext(step, context);
      try {
        const result = await host.campfire({ topic, engines: resolvePlanStepEngines(step, activeEngines) ?? [], strategy: 'all-respond', timeout: 120, outputDir: join(host.outputDir, step.id), signal });
        assertReturnedAuthority('campfire', signal);
        const after = host.snapshot();
        const summary = result.rounds.map((r) => `${r.engineId}: ${r.content.slice(0, 200)}`).join('\n');
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: summary },
          contextExport: summary,
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),

    delegate: wrap('delegate', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      try {
        const result = await host.delegate({ engineId: step.engine ?? step.engines?.[0] ?? 'claude', task, timeout: 120, outputDir: join(host.outputDir, step.id), signal });
        assertReturnedAuthority('delegate', signal);
        const after = host.snapshot();
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: result.response },
          contextExport: result.response.slice(0, 500),
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      }
    }),

  };
}
