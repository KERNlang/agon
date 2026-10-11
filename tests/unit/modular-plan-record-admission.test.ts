import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createPlanCoordinator } from '../../packages/mod-plan/src/execution-coordinator.js';
import type { PlanCoordinatorHost } from '../../packages/mod-plan/src/execution-coordinator.js';
import { createPlanExecutor } from '../../packages/mod-plan/src/executor.js';
import { runPlanResumeApproval } from '../../packages/mod-plan/src/resume-workflow.js';
import type { CesarPlan } from '../../packages/mod-plan/src/execution-model.js';
import { createCesarPlan, approveCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { assertExecutablePlan } from '../../packages/mod-plan/src/execution-record.js';

function valid(): CesarPlan {
  return approveCesarPlan(createCesarPlan('admission fixture', [{ id: 'first', type: 'self', description: 'fixture', estimatedTokens: 1, estimatedCostUsd: 0 }]));
}

it.each([
  ['missing totals', (plan: any) => { delete plan.totalActualTokens; }],
  ['nonfinite totals', (plan: any) => { plan.totalEstimatedCostUsd = Infinity; }],
  ['negative cost', (plan: any) => { plan.totalActualCostUsd = -1; }],
  ['missing context', (plan: any) => { delete plan.stepContext; }],
  ['nonstring context', (plan: any) => { plan.stepContext.output = {}; }],
  ['duplicate IDs', (plan: any) => { plan.steps.push({ ...plan.steps[0] }); }],
  ['unknown dependency', (plan: any) => { plan.steps[0].dependsOn = ['absent']; }],
  ['cycle', (plan: any) => { plan.steps[0].dependsOn = ['first']; }],
  ['unknown executor', (plan: any) => { plan.steps[0].type = 'toString'; }],
  ['invalid engine list', (plan: any) => { plan.steps[0].engines = [null]; }],
  ['invalid result', (plan: any) => { plan.steps[0].result = { status: 'success' }; }],
  ['unknown active step', (plan: any) => { plan.activeStepId = 'absent'; }],
  ['invalid retry count', (plan: any) => { plan.fallbackRetriesUsed = { first: -1 }; }],
] as const)('rejects %s without normalizing input', (_label, corrupt) => {
  const plan = valid();
  corrupt(plan);
  const snapshot = structuredClone(plan);
  expect(() => assertExecutablePlan(plan)).toThrow(/execution record/i);
  expect(plan).toEqual(snapshot);
});

it('validates a deep dependency chain without recursion', () => {
  const plan = valid();
  plan.steps = Array.from({ length: 10000 }, (_, index) => ({ ...plan.steps[0], id: String(index),
    dependsOn: index ? [String(index - 1)] : [] }));
  expect(() => assertExecutablePlan(plan)).not.toThrow();
  plan.steps[0].dependsOn = ['9999'];
  expect(() => assertExecutablePlan(plan)).toThrow(/execution record/i);
});

it('keeps valid execution reachable with the same result and accounting', async () => {
  const execute = vi.fn(async () => ({ result: { status: 'success' as const, output: 'valid output', actualTokens: 2, actualCostUsd: 0.01, durationMs: 1 } }));
  const completed = await createPlanExecutor({ recordStepCompletion: vi.fn() })(valid(), { self: { execute } },
    { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() });
  expect(execute).toHaveBeenCalledOnce();
  expect(completed).toMatchObject({ state: 'done', totalActualTokens: 2, totalActualCostUsd: 0.01 });
});

it('accepts populated optional fields and saved results without changing them', () => {
  const plan = valid();
  Object.assign(plan, { autoApprove: false, selfReview: true, activeStepId: null, currentStepId: 'first',
    updatedAt: '2026-01-01', approvedAt: '2026-01-01', completedAt: '2026-01-02',
    planFilePath: '/synthetic/plan.md', exitReason: 'fixture', exitedAt: '2026-01-02',
    planningCost: { tokens: 2, costUsd: 0.1 }, reviewCyclesUsed: 1, fallbackRetriesUsed: { first: 1 } });
  Object.assign(plan.steps[0], { engine: 'fixture', engines: ['fixture'], fitnessCmd: 'true',
    tribunalMode: 'red-team', rationale: 'fixture', verifyCmd: 'true', startedAt: '2026-01-01',
    completedAt: '2026-01-02', runDir: '/synthetic/run', dependsOn: [], exports: ['proof'], imports: ['input'],
    parallel: false, eloSpread: 0.5, selfReviewCycle: 1, state: 'done',
    result: { status: 'success', output: 'fixture', error: '', actualTokens: 1, actualCostUsd: 0, durationMs: 1 } });
  const snapshot = structuredClone(plan);
  expect(() => assertExecutablePlan(plan)).not.toThrow();
  expect(plan).toEqual(snapshot);
});

function historical(): CesarPlan {
  return JSON.parse(readFileSync(new URL('../fixtures/modular-plan-historical/auto-approved-without-execution.json', import.meta.url), 'utf8')).payload;
}

it('refuses incomplete historical execution before a step or checkpoint', async () => {
  const plan = historical();
  const original = structuredClone(plan);
  const execute = vi.fn(async () => ({ result: { status: 'success' as const, actualTokens: 1, actualCostUsd: 0, durationMs: 1, output: 'fixture' } }));
  const checkpoint = vi.fn();
  await expect(createPlanExecutor({ recordStepCompletion: vi.fn() })(plan,
    { self: { execute }, review: { execute } }, { onCheckpoint: checkpoint, onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn() },
  )).rejects.toThrow(/execution record/i);
  expect(execute).not.toHaveBeenCalled();
  expect(checkpoint).not.toHaveBeenCalled();
  expect(plan).toEqual(original);
});

it('refuses incomplete historical execution before the coordinator writes or publishes it', async () => {
  const plan = historical();
  const save = vi.fn();
  const executePlan = vi.fn(async () => ({ ...plan, state: 'paused' as const }));
  const setActivePlan = vi.fn();
  const notify = vi.fn();
  const host: PlanCoordinatorHost = { createExecutors: () => ({}), executePlan,
    callbacks: () => ({ onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn(), flush: vi.fn() }),
    setActivePlan, setAbort: vi.fn(), releaseAbort: vi.fn(), save, writeMarkdown: vi.fn(),
    hasWorkingTreeChanges: () => false, estimateReview: () => ({ tokens: 0, costUsd: 0 }),
    takeFallback: () => undefined, notify, warn: vi.fn() };
  const coordinator = createPlanCoordinator(host);
  await coordinator.executeApprovedPlan(plan);
  await expect(coordinator.finalizePlanWithReviewGate(plan, {}, new AbortController().signal)).rejects.toThrow(/execution record/i);
  expect(save).not.toHaveBeenCalled();
  expect(setActivePlan).not.toHaveBeenCalled();
  expect(executePlan).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('error', expect.stringMatching(/execution record/i));
  expect(notify.mock.calls.flat().join(' ')).not.toMatch(/storage recovers/);
});

it('explains an incomplete historical record without offering a misleading resume choice', async () => {
  const plan = historical();
  const choose = vi.fn(async () => '1');
  const execute = vi.fn(async () => {});
  const notify = vi.fn();
  await runPlanResumeApproval(plan, { available: () => true, choose, execute, notify });
  expect(choose).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('error', expect.stringMatching(/execution record/i));
});
