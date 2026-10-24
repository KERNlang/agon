import { afterEach, expect, it, vi } from 'vitest';
import { runProcessInputQueue } from '../../packages/cli/src/surfaces/app-submit.js';
import type { QueuedInput } from '../../packages/cli/src/signals/queued-input.js';
import { clearSteering } from '../../packages/cli/src/cesar/steering.js';

afterEach(() => { vi.useRealTimers(); clearSteering(); });

it('hands the head to submit immediately without leaving an unowned delayed callback', async () => {
  vi.useFakeTimers();
  const retry = { kind: 'telemetry-retry', input: 'retry' } as const;
  let queue: QueuedInput[] = [retry, 'next'];
  const submit = vi.fn();
  runProcessInputQueue('idle', queue, fn => { queue = fn(queue); }, submit, vi.fn());
  expect(submit).toHaveBeenCalledExactlyOnceWith(retry);
  expect(queue).toEqual(['next']);
  expect(vi.getTimerCount()).toBe(0);
  // Once the consumer cancels/disposes, there is no timer left to resurrect it.
  submit.mockClear();
  await vi.advanceTimersByTimeAsync(1000);
  expect(submit).not.toHaveBeenCalled();
});

it('lets the submit transition to busy before the next queue render can drain another prompt', () => {
  vi.useFakeTimers();
  let queue: QueuedInput[] = ['first', 'second'];
  let state: 'idle' | 'streaming' = 'idle';
  const submit = vi.fn((_value: QueuedInput) => { state = 'streaming'; });
  const render = () => runProcessInputQueue(state, queue, fn => { queue = fn(queue); }, submit, vi.fn());
  render();
  render();
  expect(submit).toHaveBeenCalledExactlyOnceWith('first');
  expect(queue).toEqual(['second']);
  state = 'idle';
  render();
  expect(submit.mock.calls).toEqual([['first'], ['second']]);
  expect(queue).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
