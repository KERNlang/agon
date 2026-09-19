import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as planMod from '../../packages/mod-plan/src/index.js';
import { createCesarPlan, approveCesarPlan, advanceCesarStep } from '../../packages/core/src/cesar/plan.js';
import { executePlan as legacy } from '../fixtures/modular-plan-executor-legacy.js';
import { planCostEstimator } from '../../packages/core/src/cesar/plan-cost-estimator.js';
import type { CesarPlanStep } from '../../packages/core/src/cesar/plan.js';
import type { PlanExecutorCallbacks, StepExecutor } from '../../packages/core/src/cesar/plan-executor.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('physical Plan scheduler ownership', () => {
  it('exports the scheduler from Plan and leaves no scheduler loop in core', () => {
    expect(planMod).toHaveProperty('createPlanExecutor');
    const adapter = readFileSync(new URL('../../packages/core/src/cesar/plan-executor.ts', import.meta.url), 'utf8');
    expect(adapter).not.toMatch(/while\s*\(|Promise\.all|markStepsRunning/);
    expect(adapter).toContain('@kernlang/agon-mod-plan');
    const scheduler = readFileSync(new URL('../../packages/mod-plan/src/executor.ts', import.meta.url), 'utf8');
    expect(scheduler).not.toMatch(/@kernlang\/agon-core|packages\/core|node:fs|planCostEstimator/);
    const legacyModel = readFileSync(new URL('../../packages/core/src/cesar/plan.ts', import.meta.url), 'utf8');
    expect(legacyModel).not.toMatch(/export interface CesarPlan(?:Step)?\s*\{/);
  });

  it.each(['sequential', 'parallel', 'failure', 'paused', 'throw', 'missing', 'abort', 'summary-failure'])('matches frozen raw events and result: %s', async scenario => {
    expect(planMod).toHaveProperty('createPlanExecutor');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    const step = (id: string, extra: Partial<CesarPlanStep> = {}): CesarPlanStep => ({
      id, type: 'self', description: id, estimatedTokens: 1, estimatedCostUsd: 0.01,
      exports: [id], ...extra,
    });
    const parallel = scenario === 'parallel';
    const initial = approveCesarPlan(createCesarPlan('fixture', [step('a', { parallel }), step('b', { parallel, dependsOn: parallel ? [] : ['a'] })]));
    const replay = async (run: typeof legacy, recordCost: (type: string, tokens: number, cost: number) => void) => {
      const trace: unknown[] = [];
      const signal = new AbortController();
      const callbacks: PlanExecutorCallbacks = {
        onStepStart: id => trace.push(['start', id]),
        onStepDone: (id, result) => trace.push(['done', id, structuredClone(result)]),
        onPlanUpdate: plan => trace.push(['update', structuredClone(plan)]),
        onBudgetWarning: (actual, estimated) => trace.push(['budget', actual, estimated]),
        summarizeStepOutput: async (id, output) => { trace.push(['summarize', id, output]); if (scenario === 'summary-failure') throw new Error('unavailable'); return `summary:${output}`; },
      };
      const executors: Record<string, StepExecutor> = scenario === 'missing' ? {} : { self: { execute: async (item, context, passedSignal) => {
        trace.push(['execute', item.id, structuredClone(context), passedSignal === signal.signal]);
        if (scenario === 'throw') throw new Error('fixture failure');
        if (scenario === 'abort') signal.abort();
        return { result: { status: scenario === 'failure' ? 'failure' : scenario === 'paused' ? 'paused' : 'success', actualTokens: 5, actualCostUsd: 1, durationMs: 2, output: item.id }, contextExport: `output:${item.id}` };
      } } };
      const spy = vi.spyOn(planCostEstimator, 'recordStepCompletion').mockImplementation(recordCost);
      try { return { result: await run(structuredClone(initial), executors, callbacks, signal.signal), trace }; }
      finally { spy.mockRestore(); }
    };
    const expectedCosts: unknown[] = [];
    const expected = await replay(legacy, (...args) => { expectedCosts.push(args); });
    const actualCosts: unknown[] = [];
    const factory = (planMod as unknown as { createPlanExecutor: (services: { advance: typeof advanceCesarStep; recordStepCompletion: (type: string, tokens: number, cost: number) => void }) => typeof legacy }).createPlanExecutor;
    const actual = await replay(factory({ advance: advanceCesarStep, recordStepCompletion: (...args) => { actualCosts.push(args); } }), () => { throw new Error('new scheduler used legacy cost singleton'); });
    expect(actual).toEqual(expected);
    expect(actualCosts).toEqual(expectedCosts);
    expect(initial.steps.every(item => item.state !== 'done')).toBe(true);
  });
});
