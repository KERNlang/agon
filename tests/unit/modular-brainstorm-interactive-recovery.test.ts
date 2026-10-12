import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), complete: vi.fn(), fail: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async importOriginal => ({
  ...await importOriginal<object>(), executeProcessCesarRoute: mocks.execute,
}));
vi.mock('@kernlang/agon-mod-brainstorm', async original => ({
  ...await original<object>(),
  createBrainstormSessionRecord: () => ({ complete: mocks.complete, fail: mocks.fail }),
}));
vi.mock('@kernlang/agon-forge', async original => ({
  ...await original<object>(), runBrainstorm: () => { throw new Error('legacy brainstorm bypass'); },
}));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';
import { dispatchMetaIntent } from '../../packages/cli/src/signals/dispatch/intent-meta.js';

beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const result: BrainstormResult = { question: 'second', winner: 'codex', response: 'recovered answer', bids: [
  { engineId: 'codex', approach: 'fixture approach', reasoning: 'fixture reasoning', score: 71, confidence: 80 },
] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { activeEngines: () => ['codex'], chatSession: { id: 'fixture' } } });

it.each(['brainstorm', 'suggest-brainstorm'])('%s preserves the generated authority and job cancellation boundary', async type => {
  const controller = new AbortController();
  const jobs: Array<(signal: AbortSignal) => Promise<unknown>> = [];
  const base = callbacks();
  const cb = { ...base, ctx: { ...base.ctx, config: {}, setActiveAbort: vi.fn() }, askQuestion: async () => 'yes',
    runAsJob: (_kind: string, _label: string, run: (signal: AbortSignal) => Promise<unknown>) => jobs.push(run),
  } as unknown as DispatchCallbacks;
  mocks.execute.mockRejectedValue(new Error('brainstorm disabled in selected generation'));
  const route = type === 'brainstorm' ? dispatchOrchestrationIntent : dispatchMetaIntent;
  await route({ type, question: 'fixture question', input: 'fixture question' }, 'fixture question', cb);
  expect(jobs).toHaveLength(1);
  await expect(jobs[0]!(controller.signal)).rejects.toThrow('brainstorm disabled in selected generation');
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('brainstorm', expect.objectContaining({ question: 'fixture question' }),
    expect.objectContaining({ signal: controller.signal }));
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['brainstorm', 'suggest-brainstorm'])('%s records success through the mod and refuses a cancelled queued job', async type => {
  const jobs: Array<(signal: AbortSignal) => Promise<unknown>> = [];
  const base = callbacks();
  const cb = { ...base, ctx: { ...base.ctx, inputEpoch: 0 }, askQuestion: async () => 'yes',
    runAsJob: (_kind: string, _label: string, run: (signal: AbortSignal) => Promise<unknown>) => jobs.push(run),
  } as unknown as DispatchCallbacks;
  const route = type === 'brainstorm' ? dispatchOrchestrationIntent : dispatchMetaIntent;
  mocks.execute.mockImplementation(() => {
    cb.ctx.inputEpoch = 1;
    return { exitCode: 0, result };
  });
  await route({ type, question: 'second', input: 'second' }, 'second', cb);
  await jobs[0]!(new AbortController().signal);
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: result.response }));
  expect(vi.getTimerCount()).toBe(0);

  const cancelled = new AbortController();
  cancelled.abort(new Error('queued job cancelled'));
  await route({ type, question: 'third', input: 'third' }, 'third', cb);
  await expect(jobs[1]!(cancelled.signal)).rejects.toThrow('queued job cancelled');
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.complete).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('clears real presenter state after a failed command and accepts the next invocation', async () => {
  const cb = callbacks();
  mocks.execute.mockResolvedValueOnce({ exitCode: 1, stderr: 'Invalid fixture request' })
    .mockResolvedValueOnce({ exitCode: 0, result });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'first' }, cb as never)).rejects.toThrow('Invalid fixture request');
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
  expect(cb.dispatch.mock.calls.some(([event]) => event.type === 'engine-block')).toBe(false);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);

  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'second' }, cb as never)).resolves.toEqual(result);
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: 'recovered answer' }));
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a cancelled late success, ignores its late progress and recovers in the same UI', async () => {
  const cb = callbacks();
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  let oldEvent!: (event: unknown) => void;
  mocks.execute.mockImplementationOnce((_route, _input, context) => {
    expect(context.signal).toBe(controller.signal);
    oldEvent = context.onWorkflowEvent;
    oldEvent({ type: 'brainstorm:seat-started', data: { engineId: 'codex' } });
    return new Promise(resolve => { finish = resolve; });
  });
  const run = runPhysicalCesarWorkflow('brainstorm', { question: 'first' }, cb as never, controller.signal);
  const rejected = expect(run).rejects.toThrow('operator cancelled');
  controller.abort(new Error('operator cancelled'));
  finish({ exitCode: 0, result: { ...result, response: 'stale answer' } });
  await rejected;
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
  expect(cb.dispatch.mock.calls.some(([event]) => event.type === 'engine-block')).toBe(false);

  mocks.execute.mockImplementationOnce(() => {
    const count = cb.dispatch.mock.calls.length;
    oldEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'late-old-seat', ok: true } });
    expect(cb.dispatch).toHaveBeenCalledTimes(count);
    return { exitCode: 0, result };
  });
  await runPhysicalCesarWorkflow('brainstorm', { question: 'second' }, cb as never);
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: 'recovered answer' }));
  expect(vi.getTimerCount()).toBe(0);
});
