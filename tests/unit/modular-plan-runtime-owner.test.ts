import { existsSync, readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createPlanRuntime } from '../../packages/mod-plan/src/runtime.js';
import { PlanCostEstimator } from '../../packages/mod-plan/src/cost-estimator.js';
import { createCesarPlan, approveCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { executePlan as executeCore, sanitizePlanSteps as sanitizeCore, planCostEstimator as coreEstimator } from '../../packages/core/src/cesar/plan-cost-estimator.js';
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import type { ModServices, Registrar } from '@kernlang/agon-mod-api';
import { MANIFEST } from '../../packages/mod-plan/src/index.js';
import { MANIFEST as REVIEW_MANIFEST } from '../../packages/mod-review/src/index.js';
import { activateFirstPartySurfaceGeneration, FIRST_PARTY_SURFACE_CATALOG } from '../../packages/mod-kernel/src/index.js';

it('binds a Plan-owned runtime at activation and revokes execution before cleanup', async () => {
  let runtime: ReturnType<typeof createPlanRuntime<PlanCostEstimator>> | undefined;
  const plan = { ...approveCesarPlan(createCesarPlan('lifetime', ['a', 'b'].map(id => ({
    id, type: 'self', description: id, estimatedTokens: 20, estimatedCostUsd: 1,
  })))), selfReview: false };
  const execute = vi.fn(async (step: { id: string }) => ({ result: {
    status: 'success' as const, actualTokens: step.id === 'a' ? 12 : 16,
    actualCostUsd: 0.3, durationMs: 1, output: 'done',
  } }));
  const callbacks = { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() };
  const unbind = vi.fn(async () => {
    await expect(runtime!.executePlan(plan, {}, callbacks)).rejects.toThrow(/disposed/i);
  });
  const bind = vi.fn(value => { runtime = value; return unbind; });
  const unregister = vi.fn();
  const register = vi.fn(() => unregister);
  const registrar = new Proxy({}, { get: () => register }) as Registrar;
  const mod = await createMod({ planRuntime: { estimateCost: () => 0.5, bind } } as unknown as ModServices);
  expect(bind).not.toHaveBeenCalled();
  const dispose = await mod.activate(registrar);
  expect(bind).toHaveBeenCalledTimes(1);
  expect(register.mock.invocationCallOrder.at(-1)).toBeLessThan(bind.mock.invocationCallOrder[0]);
  expect(runtime!.estimator.estimate('self', [])).toEqual({ tokens: 2000, costUsd: 0.5 });
  expect((await runtime!.executePlan(plan, { self: { execute } }, callbacks)).state).toBe('done');
  expect(execute).toHaveBeenCalledTimes(2);
  expect(runtime!.sanitizePlanSteps([{ type: 'self' }]).steps[0].estimatedTokens).toBe(14);
  await dispose?.();
  expect(unbind).toHaveBeenCalledTimes(1);
  expect(unregister).toHaveBeenCalledTimes(register.mock.calls.length);
  await expect(runtime!.executePlan(plan, {}, callbacks)).rejects.toThrow(/disposed/i);
  expect(execute).toHaveBeenCalledTimes(2);
});

it('does not bind a runtime when contribution registration fails', async () => {
  const bind = vi.fn(() => vi.fn());
  const failure = new Error('registration failed');
  const registrar = new Proxy({}, { get: () => () => { throw failure; } }) as Registrar;
  const mod = await createMod({ planRuntime: { estimateCost: () => 1, bind } } as unknown as ModServices);
  await expect(mod.activate(registrar)).rejects.toBe(failure);
  expect(bind).not.toHaveBeenCalled();
});

it('revokes a captured runtime when host binding fails', async () => {
  let runtime: ReturnType<typeof createPlanRuntime<PlanCostEstimator>> | undefined;
  const failure = new Error('binding failed');
  const mod = await createMod({ planRuntime: { estimateCost: () => 1,
    bind: (value: typeof runtime) => { runtime = value; throw failure; },
  } } as unknown as ModServices);
  const registrar = new Proxy({}, { get: () => () => () => {} }) as Registrar;
  await expect(mod.activate(registrar)).rejects.toBe(failure);
  const plan = approveCesarPlan(createCesarPlan('failed binding', []));
  await expect(runtime!.executePlan(plan, {}, {
    onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn(),
  })).rejects.toThrow(/disposed/i);
});

it.each(['dispose-pending', 'stale-pending', 'dispose-on-start'] as const)(
  'drains completed work without starting a backend after revocation: %s', async phase => {
    let runtime!: ReturnType<typeof createPlanRuntime<PlanCostEstimator>>;
    let current = true;
    const mod = await createMod({ planRuntime: {
      estimateCost: () => 1,
      assertAvailable: () => { if (!current) throw new Error('generation changed'); },
      bind: (value: typeof runtime) => { runtime = value; return () => {}; },
    } } as unknown as ModServices);
    const dispose = await mod.activate(new Proxy({}, { get: () => () => () => {} }) as Registrar);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const execute = vi.fn(async (step: { id: string }) => {
      if (step.id === 'a' && phase !== 'dispose-on-start') { entered(); await pending; }
      return { result: { status: 'success' as const, actualTokens: 7,
        actualCostUsd: 0.1, durationMs: 1, output: `completed-${step.id}` } };
    });
    const plan = { ...approveCesarPlan(createCesarPlan('revoke', [
      { id: 'a', type: 'self', description: 'first', estimatedTokens: 10, estimatedCostUsd: 1 },
      { id: 'b', type: 'self', description: 'second', dependsOn: ['a'], estimatedTokens: 10, estimatedCostUsd: 1 },
    ])), selfReview: false };
    let cleanup: ReturnType<NonNullable<typeof dispose>> | undefined;
    const checkpoints: typeof plan[] = [];
    const run = runtime.executePlan(plan, { self: { execute } }, {
      onStepStart: id => { if (phase === 'dispose-on-start' && id === 'a') cleanup = dispose?.(); },
      onCheckpoint: value => checkpoints.push(value as typeof plan),
      onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn(),
    });
    if (phase !== 'dispose-on-start') {
      await started;
      if (phase === 'dispose-pending') await dispose?.();
      else current = false;
      release();
    }
    const result = await run;
    await cleanup;
    expect(execute.mock.calls.map(([step]) => step.id)).toEqual(phase === 'dispose-on-start' ? [] : ['a']);
    expect(result.state).not.toBe('done');
    if (phase !== 'dispose-on-start') {
      expect(result.steps[0].result?.output).toBe('completed-a');
      expect(checkpoints.some(value => value.steps[0].result?.output === 'completed-a')).toBe(true);
    }
    await dispose?.();
  },
);

it.each(['registration-commit', 'later-owner'] as const)('revokes Plan binding after real generation failure: %s', async phase => {
  let runtime!: ReturnType<typeof createPlanRuntime<PlanCostEstimator>>;
  const unbind = vi.fn();
  const services = { planRuntime: { estimateCost: () => 1,
    bind: (value: typeof runtime) => { runtime = value; return unbind; },
  } } as unknown as ModServices;
  const planMod = await createMod(services);
  const planPackage = { manifest: MANIFEST, services, mod: { apiVersion: '1' as const,
    activate: (registrar: Registrar) => planMod.activate(phase === 'registration-commit'
      ? { ...registrar, tool: (surface, contribution) => contribution.id === 'mcpTools:0008'
        ? () => {} : registrar.tool(surface, contribution) }
      : registrar),
  } };
  const laterPackage = { manifest: { ...REVIEW_MANIFEST, dependencies: {
    ...REVIEW_MANIFEST.dependencies, required: [...REVIEW_MANIFEST.dependencies.required,
      { id: MANIFEST.id, range: MANIFEST.version }],
  } }, services, mod: { apiVersion: '1' as const, activate: async () => {
    expect(runtime).toBeDefined();
    throw new Error('later owner failed');
  } } };
  const packages = phase === 'later-owner' ? [planPackage, laterPackage] : [planPackage];
  await expect(activateFirstPartySurfaceGeneration({
    id: `fixture:${phase}`, packages,
    catalog: FIRST_PARTY_SURFACE_CATALOG.filter(entry => packages.some(candidate => candidate.manifest.id === entry.owner.id)),
    runtime: { command: () => ({}), tool: () => null, parseIntent: () => undefined, renderDocs: () => ({ text: '' }) },
  })).rejects.toThrow(phase === 'registration-commit' ? /declared contribution was not registered/ : /later owner failed/);
  expect(unbind).toHaveBeenCalledTimes(1);
  const plan = approveCesarPlan(createCesarPlan('failure cleanup', []));
  await expect(runtime.executePlan(plan, {}, {
    onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn(),
  })).rejects.toThrow(/disposed/);
});

it('connects Core execution and sanitization to its exported estimator', async () => {
  coreEstimator.reset();
  try {
    const plan = approveCesarPlan(createCesarPlan('Core history', ['a', 'b'].map(id => ({
      id, type: 'self', description: id, estimatedTokens: 1, estimatedCostUsd: 1,
    }))));
    await executeCore(plan, { self: { execute: async () => ({ result: {
      status: 'success', actualTokens: 10, actualCostUsd: 0.3, durationMs: 1, output: 'done',
    } }) } }, { onStepStart() {}, onStepDone() {}, onPlanUpdate() {}, onBudgetWarning() {} });
    expect(coreEstimator.estimate('self', [])).toEqual({ tokens: 10, costUsd: 0.3 });
    expect(sanitizeCore([{ type: 'self' }]).steps[0]).toMatchObject({ estimatedTokens: 10, estimatedCostUsd: 0.3 });
  } finally { coreEstimator.reset(); }
});

it('shares completed-step estimates with proposal validation', async () => {
  const estimator = new PlanCostEstimator((_, tokens) => tokens / 1000);
  const runtime = createPlanRuntime(estimator);
  expect(runtime.estimator).toBe(estimator);
  const plan = approveCesarPlan(createCesarPlan('learn', ['a', 'b'].map(id => ({ id, type: 'self', description: id, estimatedTokens: 0, estimatedCostUsd: 0 }))));
  const result = await runtime.executePlan(plan, { self: { execute: async step => ({ result: { status: 'success', actualTokens: step.id === 'a' ? 10 : 30,
    actualCostUsd: step.id === 'a' ? 1 : 3, durationMs: 1, output: '' } }) } },
  { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() });
  expect(result.state).toBe('done');
  expect(runtime.sanitizePlanSteps([{ id: 'next', type: 'self', description: 'next' }]).steps[0]).toMatchObject({ estimatedTokens: 20, estimatedCostUsd: 2 });
});

it('keeps independently created runtime histories separate', () => {
  const one = createPlanRuntime(new PlanCostEstimator(() => 1));
  const two = createPlanRuntime(new PlanCostEstimator(() => 2));
  one.estimator.recordStepCompletion('self', 5, 3);
  one.estimator.recordStepCompletion('self', 5, 3);
  expect(one.estimator.estimate('self', [])).toEqual({ tokens: 5, costUsd: 3 });
  expect(two.estimator.estimate('self', [])).toEqual({ tokens: 2000, costUsd: 2 });
});

it('reports estimation failures without losing the completed step', async () => {
  const estimator = new PlanCostEstimator(() => 1);
  const error = new Error('history unavailable');
  vi.spyOn(estimator, 'recordStepCompletion').mockImplementation(() => { throw error; });
  const report = vi.fn();
  const runtime = createPlanRuntime(estimator, report);
  const plan = approveCesarPlan(createCesarPlan('report', [{ id: 'a', type: 'self', description: 'a', estimatedTokens: 0, estimatedCostUsd: 0 }]));
  const result = await runtime.executePlan(plan, { self: { execute: async () => ({ result: {
    status: 'success', actualTokens: 10, actualCostUsd: 1, durationMs: 1, output: 'completed',
  } }) } }, { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() });
  expect(result.state).toBe('done');
  expect(result.steps[0].result?.output).toBe('completed');
  expect(report).toHaveBeenCalledExactlyOnceWith('self', error);
});

it('removes the legacy scheduler and sanitizer facades without removing root exports', () => {
  for (const file of ['plan-executor', 'plan-validation']) {
    expect(existsSync(new URL('../../packages/core/src/cesar/' + file + '.ts', import.meta.url))).toBe(false);
  }
  const root = readFileSync(new URL('../../packages/core/src/index.ts', import.meta.url), 'utf8');
  expect(root).toContain('sanitizePlanSteps');
  expect(root).toContain('executePlan');
  expect(root).not.toContain("from './cesar/plan-executor.js'");
  expect(root).not.toContain("from './cesar/plan-validation.js'");
});
