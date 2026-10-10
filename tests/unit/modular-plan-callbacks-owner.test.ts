import { afterEach, expect, it, vi } from 'vitest';
import { createPlanCallbacks } from '../../packages/mod-plan/src/execution-callbacks.js';
import { createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import type { PlanCallbackHost } from '../../packages/mod-plan/src/execution-callbacks.js';

function fixture() {
  const plan = createCesarPlan('work', [{ id: 's', type: 'self', description: 'first', estimatedTokens: 0, estimatedCostUsd: 0 }]);
  plan.state = 'running'; plan.planFilePath = '/plan.md';
  const host: PlanCallbackHost = { dispatch: vi.fn(), setActivePlan: vi.fn(), todos: () => [], save: vi.fn(), writeMarkdown: vi.fn(), warn: vi.fn() };
  return { plan, host, callbacks: createPlanCallbacks(plan, host) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('debounces to the latest plan and cancels the pending write on flush', async () => {
  vi.useFakeTimers(); const { plan, host, callbacks } = fixture();
  callbacks.onPlanUpdate(plan);
  await vi.advanceTimersByTimeAsync(100);
  const latest = { ...plan, totalActualTokens: 7 };
  callbacks.onPlanUpdate(latest);
  await vi.advanceTimersByTimeAsync(299);
  expect(host.save).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  callbacks.flush();
  expect(host.save).toHaveBeenCalledExactlyOnceWith(latest);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(host.save).toHaveBeenCalledOnce();
});

it('flushes terminal states immediately without a later timer write', () => {
  vi.useFakeTimers();
  for (const state of ['done', 'paused', 'cancelled'] as const) {
    const { plan, host, callbacks } = fixture();
    callbacks.onPlanUpdate(plan);
    const terminal = { ...plan, state };
    callbacks.onPlanUpdate(terminal);
    expect(host.save).toHaveBeenCalledExactlyOnceWith(terminal);
    expect(vi.getTimerCount()).toBe(0);
  }
});

it('uses appended steps from the latest plan for live tool events', () => {
  vi.useFakeTimers(); const { plan, host, callbacks } = fixture();
  callbacks.onPlanUpdate({ ...plan, steps: [...plan.steps, { id: 'review', type: 'review', description: 'check changes', engine: 'validator', estimatedTokens: 0, estimatedCostUsd: 0 }] });
  callbacks.onStepStart('review');
  expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'spinner-start', engineId: 'validator', message: expect.stringContaining('Step 2/2') }));
  expect(host.setActivePlan).toHaveBeenLastCalledWith(expect.objectContaining({ activeStepId: 'review', currentStepId: 'review' }));
  const input = JSON.stringify({ planId: plan.id, stepId: 'review', step: 2, totalSteps: 2,
    type: 'review', engine: 'validator', engines: [], description: 'check changes', state: 'running' });
  expect(host.dispatch).toHaveBeenCalledWith({ type: 'tool-call', engineId: 'cesar', tool: 'PlanStep', input, status: 'running' });
  callbacks.onStepDone('review', { status: 'success', output: 'checked', durationMs: 1, actualTokens: 0, actualCostUsd: 0 });
  expect(host.dispatch).toHaveBeenCalledWith({ type: 'tool-call', engineId: 'cesar', tool: 'PlanStep', input,
    status: 'done', output: 'checked', error: undefined });
  callbacks.flush();
});

it('renders paused results without a failed todo and bounds tool output', async () => {
  const { host, callbacks } = fixture();
  callbacks.onStepDone('s', { status: 'paused', output: 'x'.repeat(4001), error: 'needs input', durationMs: 1, actualCostUsd: 0, actualTokens: 0 });
  expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'todos-update', state: 'pending' }));
  expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-call', status: 'done', output: 'x'.repeat(4000), error: undefined }));
  expect(await callbacks.summarizeStepOutput('s', 'y'.repeat(501))).toBe('y'.repeat(500) + '\n\n[... truncated from 501 chars. Full output in step s]');
});

it('reports both storage failures without changing the existing best-effort contract', () => {
  const { host, callbacks } = fixture();
  vi.mocked(host.save).mockImplementation(() => { throw new Error('disk'); });
  vi.mocked(host.writeMarkdown).mockImplementation(() => { throw new Error('markdown'); });
  expect(() => callbacks.flush()).not.toThrow();
  expect(host.warn).toHaveBeenNthCalledWith(1, '[plan] saveCesarPlan failed:', 'disk');
  expect(host.warn).toHaveBeenNthCalledWith(2, '[plan] failed to write plan file:', 'markdown');
});

it('persists the latest snapshot when the trailing debounce expires', async () => {
  vi.useFakeTimers();
  const { plan, host, callbacks } = fixture();
  callbacks.onPlanUpdate(plan);
  await vi.advanceTimersByTimeAsync(100);
  const latest = { ...plan, totalActualTokens: 7 };
  callbacks.onPlanUpdate(latest);
  await vi.advanceTimersByTimeAsync(299);
  expect(host.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.save).toHaveBeenCalledExactlyOnceWith(latest);
  expect(vi.getTimerCount()).toBe(0);
});

it('emits state changes and repeated terminals but suppresses same-state running rows', () => {
  vi.useFakeTimers();
  const { plan, host, callbacks } = fixture();
  for (const state of ['running', 'running', 'paused', 'running', 'done', 'done'] as const) {
    callbacks.onPlanUpdate({ ...plan, state });
  }
  const rows = vi.mocked(host.dispatch).mock.calls.map(([event]) => event)
    .filter(event => event.type === 'plan-execution');
  expect(rows.map(event => event.plan.state)).toEqual(['running', 'paused', 'running', 'done', 'done']);
  expect(vi.getTimerCount()).toBe(0);
});

it('publishes terminal UI state before saving and writing markdown', () => {
  const { plan } = fixture();
  const trace: string[] = [];
  const callbacks = createPlanCallbacks(plan, {
    dispatch: event => { trace.push(event.type); },
    setActivePlan: () => { trace.push('active'); },
    todos: () => { trace.push('todos'); return []; },
    save: () => { trace.push('save'); },
    writeMarkdown: () => { trace.push('markdown'); },
    warn: () => { trace.push('warn'); },
  });
  trace.length = 0;
  callbacks.onPlanUpdate({ ...plan, state: 'paused' });
  expect(trace).toEqual(['active', 'plan-execution', 'spinner-stop', 'todos', 'todos-set', 'save', 'markdown']);
});
