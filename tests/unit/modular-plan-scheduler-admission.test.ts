import { expect, it, vi } from 'vitest';
import { createPlanExecutor } from '../../packages/mod-plan/src/executor.js';
import { approveCesarPlan, createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';

const step = (id: string) => ({ id, type: 'self' as const, description: id, estimatedTokens: 1, estimatedCostUsd: 0 });
const result = { status: 'success' as const, output: 'fixture', actualTokens: 1, actualCostUsd: 0, durationMs: 1 };
const callbacks = () => ({ onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(), onBudgetWarning: vi.fn(), onCheckpoint: vi.fn() });

it.each([false, true])('does not let pending state bypass dependencies, parallel=%s', async parallel => {
  const plan = approveCesarPlan(createCesarPlan('ordering fixture', [
    { ...step('dependent'), dependsOn: ['prerequisite'], parallel }, { ...step('prerequisite'), parallel },
  ]));
  plan.steps[0].state = 'pending';
  const events: string[] = [];
  await createPlanExecutor({ recordStepCompletion: vi.fn() })(plan, { self: { execute: async value => {
    events.push(`start:${value.id}`);
    await Promise.resolve();
    events.push(`done:${value.id}`);
    return { result };
  } } }, callbacks());
  expect(events).toEqual(['start:prerequisite', 'done:prerequisite', 'start:dependent', 'done:dependent']);
});

it('unblocks a dependent from a saved successful skipped prerequisite', async () => {
  const plan = approveCesarPlan(createCesarPlan('resume fixture', [step('prior'), { ...step('next'), dependsOn: ['prior'] }]));
  plan.steps[0] = { ...plan.steps[0], state: 'skipped', result };
  const execute = vi.fn(async (_value: { id: string }) => ({ result }));
  const completed = await createPlanExecutor({ recordStepCompletion: vi.fn() })(plan, { self: { execute } }, callbacks());
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][0]).toMatchObject({ id: 'next' });
  expect(completed.state).toBe('done');
});

it.each(['forge', 'teamforge', 'pipeline', 'agent', 'team-agent'] as const)('refuses saved parallel %s writers before any checkpoint or dispatch', async type => {
  const plan = approveCesarPlan(createCesarPlan('writer fixture', ['one', 'two'].map(id => ({ ...step(id), type, parallel: true }))));
  const execute = vi.fn(async () => ({ result }));
  const calls = callbacks();
  await expect(createPlanExecutor({ recordStepCompletion: vi.fn() })(plan, { [type]: { execute } }, calls)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(calls.onCheckpoint).not.toHaveBeenCalled();
});

it.each(['failed', 'done-without-result', 'skipped-without-result', 'skipped-failure'])('does not dispatch a dependent after %s', async scenario => {
  const plan = approveCesarPlan(createCesarPlan('unproven dependency', [step('prior'), { ...step('next'), dependsOn: ['prior'] }]));
  plan.steps[0].state = scenario === 'failed' ? 'failed' : scenario.startsWith('done') ? 'done' : 'skipped';
  if (scenario === 'failed' || scenario === 'skipped-failure') plan.steps[0].result = { ...result, status: 'failure' };
  plan.steps[1].state = 'pending';
  const execute = vi.fn(async () => ({ result }));
  const paused = await createPlanExecutor({ recordStepCompletion: vi.fn() })(plan, { self: { execute } }, callbacks());
  expect(execute).not.toHaveBeenCalled();
  expect(paused.state).toBe('paused');
});

it('keeps serialized workspace writers executable', async () => {
  const plan = approveCesarPlan(createCesarPlan('serialized writers', ['one', 'two'].map(id => ({ ...step(id), type: 'forge' as const, parallel: false }))));
  const execute = vi.fn(async () => ({ result }));
  const complete = await createPlanExecutor({ recordStepCompletion: vi.fn() })(plan, { forge: { execute } }, callbacks());
  expect(execute).toHaveBeenCalledTimes(2);
  expect(complete.state).toBe('done');
});
