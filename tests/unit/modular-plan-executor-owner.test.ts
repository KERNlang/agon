import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as planMod from '../../packages/mod-plan/src/index.js';
import { createCesarPlan, approveCesarPlan } from '@kernlang/agon-mod-plan';
import { executePlan as legacy } from '../fixtures/modular-plan-executor-legacy.js';
import { planCostEstimator } from '../../packages/core/src/cesar/plan-cost-estimator.js';
import type { CesarPlanStep } from '@kernlang/agon-mod-plan';
import type { PlanExecutorCallbacks, StepExecutor } from '@kernlang/agon-mod-plan';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('physical Plan scheduler ownership', () => {
  it.each([false, true])('checks cancellation again after start notification (parallel=%s)', async parallel => {
    const controller = new AbortController();
    const initial = approveCesarPlan(createCesarPlan('cancel fixture', [{ id: 'a', type: 'self', description: 'a',
      estimatedTokens: 1, estimatedCostUsd: 1, parallel }]));
    const execute = vi.fn(async () => ({ result: { status: 'success' as const, output: '', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } }));
    const result = await planMod.createPlanExecutor({ recordStepCompletion: vi.fn() })(initial, { self: { execute } },
      { onStepStart: () => controller.abort(), onStepDone: () => {}, onPlanUpdate: () => {}, onBudgetWarning: () => {} }, controller.signal);
    expect(execute).not.toHaveBeenCalled();
    expect(result.state).toBe('paused');
  });
  it('does not start a sequential step after cancellation during a parallel batch', async () => {
    const controller = new AbortController();
    const initial = approveCesarPlan(createCesarPlan('cancel fixture', ['a', 'b', 'c'].map(id => ({
      id, type: 'self', description: id, estimatedTokens: 1, estimatedCostUsd: 1, parallel: id !== 'c',
    }))));
    const executed: string[] = [];
    const result = await planMod.createPlanExecutor({ recordStepCompletion: vi.fn() })(initial,
      { self: { execute: async step => {
        executed.push(step.id);
        await Promise.resolve();
        controller.abort();
        return { result: { status: 'success', output: step.id, actualTokens: 1, actualCostUsd: 1, durationMs: 1 } };
      } } }, { onStepStart: () => {}, onStepDone: () => {}, onPlanUpdate: () => {}, onBudgetWarning: () => {} }, controller.signal);
    expect(executed).toEqual(['a', 'b']);
    expect(result).toMatchObject({ state: 'paused', steps: [{ state: 'done' }, { state: 'done' }, { state: 'pending' }] });
  });
  it.each(['throw', 'missing', 'cancel before start'])('does not train estimates on synthetic parallel failures: %s', async fault => {
    const controller = new AbortController();
    const initial = approveCesarPlan(createCesarPlan('history fixture', [{ id: 'a', type: 'self', description: 'a',
      estimatedTokens: 1, estimatedCostUsd: 1, parallel: true }]));
    const recordStepCompletion = vi.fn();
    const executors = fault === 'missing' ? {} : { self: { execute: async () => { throw new Error('transport failed'); } } };
    await planMod.createPlanExecutor({ recordStepCompletion })(initial, executors,
      { onStepStart: () => {}, onStepDone: () => {}, onBudgetWarning: () => {}, onPlanUpdate: () => {
        if (fault === 'cancel before start') controller.abort();
      } }, controller.signal);
    expect(recordStepCompletion).not.toHaveBeenCalled();
  });
  it.each([false, true])('checkpoints actual results when a completion observer fails (parallel=%s)', async parallel => {
    const initial = approveCesarPlan(createCesarPlan('fixture', ['a', 'b'].map(id => ({
      id, type: 'self', description: id, estimatedTokens: 1, estimatedCostUsd: 1, parallel, exports: [id],
    }))));
    const snapshots: typeof initial[] = [];
    const run = planMod.createPlanExecutor({ recordStepCompletion: vi.fn() });
    await expect(run(initial, { self: { execute: async step => ({ result: {
      status: 'success', output: step.id, actualTokens: 1, actualCostUsd: 1, durationMs: 1 }, contextExport: step.id }) } }, {
      onStepStart: () => {}, onStepDone: () => { throw new Error('observer failed'); },
      onPlanUpdate: snapshot => { snapshots.push(snapshot); }, onBudgetWarning: () => {},
    })).rejects.toThrow('observer failed');
    const saved = snapshots.at(-1)!;
    expect(saved.steps[0]).toMatchObject({ state: 'done', result: { status: 'success', output: 'a' } });
    expect(saved.steps[1].state).toBe(parallel ? 'done' : 'pending');
    expect(saved.stepContext.a).toBe('a');
    if (parallel) expect(saved.stepContext.b).toBe('b');
  });
  it('exports the scheduler from Plan and leaves no scheduler loop in core', () => {
    expect(planMod).toHaveProperty('createPlanExecutor');
    expect(existsSync(new URL('../../packages/core/src/cesar/plan-executor.ts', import.meta.url))).toBe(false);
    const binding = readFileSync(new URL('../../packages/core/src/cesar/plan-cost-estimator.ts', import.meta.url), 'utf8');
    expect(binding).not.toMatch(/while\s*\(|Promise\.all|markStepsRunning|createPlanExecutor/);
    expect(binding).toContain('createPlanRuntime');
    const scheduler = readFileSync(new URL('../../packages/mod-plan/src/executor.ts', import.meta.url), 'utf8');
    expect(scheduler).not.toMatch(/@kernlang\/agon-core|packages\/core|node:fs|planCostEstimator/);
    expect(scheduler).not.toContain('services.advance');
    expect(existsSync(new URL('../../packages/core/src/cesar/plan.ts', import.meta.url))).toBe(false);
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
    const actual = await replay(planMod.createPlanExecutor({ recordStepCompletion: (...args) => { actualCosts.push(args); } }), () => { throw new Error('new scheduler used legacy cost singleton'); });
    expect(actual).toEqual(expected);
    expect(actualCosts).toEqual(expectedCosts);
    expect(initial.steps.every(item => item.state !== 'done')).toBe(true);
  });
});
