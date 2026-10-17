import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import type { CesarPlan, CesarStepResult } from '../../packages/mod-plan/src/execution-model.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
const effects = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<Record<string, unknown>>(), saveCesarPlan: effects.save }));
vi.mock('node:fs', async original => ({ ...await original<Record<string, unknown>>(), writeFileSync: effects.write }));
import { buildPlanCallbacks } from '../../packages/cli/src/signals/dispatch/plan-execution.js';
import { buildLegacyPlanCallbacks } from '../fixtures/modular-plan-callbacks-legacy.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const scenarios = ['debounce', 'terminal', 'paused', 'cancelled', 'success', 'failure', 'save-error', 'write-error', 'missing-step'];
it('keeps callback policy in the physical Plan owner', () => {
  const cli = readFileSync(new URL('../../packages/cli/src/signals/dispatch/plan-execution.ts', import.meta.url), 'utf8');
  const owner = readFileSync(new URL('../../packages/mod-plan/src/execution-session.ts', import.meta.url), 'utf8');
  const effects = readFileSync(new URL('../../packages/cli/src/blocks/plan-execution-effects.ts', import.meta.url), 'utf8');
  expect(cli).toContain('return createPlanExecutionSession(cb).callbacks(initialPlan)');
  expect(effects).toContain("createPlanExecutionSession as createSession, listCesarPlans } from '@kernlang/agon-mod-plan'");
  expect(owner).toContain('createPlanCallbacks(plan, host.callbacks)');
  expect(effects).not.toContain('const DEBOUNCE_MS');
  expect(effects).not.toContain('const markStepRunning');
  expect(cli).not.toContain('const DEBOUNCE_MS');
  expect(cli).not.toContain('const markStepRunning');
});
it.each(scenarios)('preserves raw callbacks and writes: %s', async scenario => {
  vi.useFakeTimers();
  const results = [];
  for (const factory of [buildLegacyPlanCallbacks, buildPlanCallbacks]) {
    vi.setSystemTime(123456789);
    effects.save.mockReset(); effects.write.mockReset();
    const events: unknown[] = []; const active: CesarPlan[] = []; const warnings: unknown[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args); });
    if (scenario === 'save-error') effects.save.mockImplementation(() => { throw new Error('save failed'); });
    if (scenario === 'write-error') effects.write.mockImplementation(() => { throw new Error('write failed'); });
    const plan = { ...createCesarPlan('fixture', [{ id: 's', type: 'self', description: 'work', estimatedTokens: 0, estimatedCostUsd: 0 }]),
      id: 'fixed', state: 'running' as const, planFilePath: '/fixture/plan.md' };
    const cb = factory(plan, { dispatch: event => { events.push(event); }, setActivePlan: value => { active.push(value); } } as DispatchCallbacks);
    cb.onStepStart(scenario === 'missing-step' ? 'absent' : 's');
    const status: CesarStepResult['status'] = scenario === 'paused' ? 'paused' : scenario === 'failure' ? 'failure' : 'success';
    cb.onStepDone('s', { status, actualTokens: 2, actualCostUsd: 0.1, durationMs: 1500, output: 'x'.repeat(4100), error: status === 'success' ? undefined : 'e'.repeat(90) });
    cb.onPlanUpdate({ ...plan, state: 'running', totalActualTokens: 1 });
    await vi.advanceTimersByTimeAsync(100);
    cb.onPlanUpdate({ ...plan, state: 'running', totalActualTokens: 2 });
    await vi.advanceTimersByTimeAsync(299);
    expect(effects.save).not.toHaveBeenCalled();
    if (scenario === 'terminal' || scenario === 'paused' || scenario === 'cancelled') {
      cb.onPlanUpdate({ ...plan, state: scenario === 'terminal' ? 'done' : scenario, totalActualTokens: 3 });
      expect(effects.save).toHaveBeenCalledOnce();
    } else await vi.advanceTimersByTimeAsync(1);
    cb.onBudgetWarning(2, 1);
    const short = await cb.summarizeStepOutput?.('s', 'short');
    const long = await cb.summarizeStepOutput?.('s', 'z'.repeat(501));
    cb.flush();
    expect(vi.getTimerCount()).toBe(0);
    results.push({ events, active, warnings, short, long, saves: effects.save.mock.calls.slice(), writes: effects.write.mock.calls.slice() });
  }
  expect(results[1]).toStrictEqual(results[0]);
});
