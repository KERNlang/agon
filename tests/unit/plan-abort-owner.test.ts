import { afterEach, expect, it, vi } from 'vitest';
import { runTrackAbort, _activeAborts } from '../../packages/cli/src/surfaces/app-interrupt.js';
import { runInJobAbortScope, trackJobAbortController } from '../../packages/cli/src/signals/job-abort-scope.js';

afterEach(() => _activeAborts.clear());
it('does not clear another run from the terminal abort slot', () => {
  const old = new AbortController();
  const current = new AbortController();
  const ref = { current: null as AbortController | null };
  const set = vi.fn();
  runTrackAbort(old, ref, set);
  runTrackAbort(current, ref, set);
  runTrackAbort(null, ref, set, old);
  expect(ref.current).toBe(current);
  expect(_activeAborts.has(current)).toBe(true);
  expect(set).toHaveBeenCalledTimes(2);
  runTrackAbort(null, ref, set, current);
  expect(ref.current).toBeNull();
  expect(_activeAborts.size).toBe(0);
});

it('does not detach another run from its job cancellation signal', async () => {
  const parent = new AbortController();
  const old = new AbortController();
  const current = new AbortController();
  await runInJobAbortScope(parent.signal, async () => {
    trackJobAbortController(old);
    trackJobAbortController(current);
    expect(trackJobAbortController(null, old)).toBe(true);
    parent.abort('operator cancelled');
    expect(current.signal.aborted).toBe(true);
    expect(old.signal.aborted).toBe(false);
  });
});
