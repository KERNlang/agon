import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), complete: vi.fn(), fail: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async importOriginal => ({
  ...await importOriginal<object>(), executeProcessCesarRoute: mocks.execute,
}));
vi.mock('../../packages/cli/src/blocks/brainstorm-session-record.js', () => ({
  createBrainstormSessionRecord: () => ({ complete: mocks.complete, fail: mocks.fail }),
}));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';

beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const result = { winner: 'codex', response: 'recovered answer', bids: [
  { engineId: 'codex', approach: 'fixture approach', reasoning: 'fixture reasoning', score: 71, confidence: 80 },
] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { activeEngines: () => ['codex'], chatSession: { id: 'fixture' } } });

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
