import { afterEach, expect, it, vi } from 'vitest';
import { createBrainstormPresentation } from '../../packages/cli/src/blocks/brainstorm-presentation.js';
import { createScoreboard, scoreboardFinishEngine, scoreboardFailEngine, renderScoreboard } from '../../packages/cli/src/cesar/scoreboard.js';

afterEach(() => { vi.useRealTimers(); });

it('shows live seat progress and retries, then stops timers and ignores late events', () => {
  vi.useFakeTimers();
  const dispatch = vi.fn();
  const view = createBrainstormPresentation(dispatch);
  view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'a' } });
  expect(dispatch).toHaveBeenCalledWith({ type: 'progress-update', engines: [expect.objectContaining({ id: 'a', done: false, failed: false })] });
  vi.advanceTimersByTime(1000);
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'progress-update', engines: [expect.objectContaining({ elapsed: 1 })] });
  view.onEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'a', ok: false, attempts: 2, detail: 'timeout' } });
  expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'a: 2 attempt(s)' });
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'progress-update', engines: [expect.objectContaining({ id: 'a', failed: true, status: expect.stringContaining('timeout') })] });
  view.dispose();
  const count = dispatch.mock.calls.length;
  view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'late' } });
  vi.advanceTimersByTime(5000);
  view.dispose();
  expect(dispatch).toHaveBeenCalledTimes(count);
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps concurrent invocation state separate', () => {
  vi.useFakeTimers();
  const first = vi.fn(); const second = vi.fn();
  const a = createBrainstormPresentation(first); const b = createBrainstormPresentation(second);
  a.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'a' } });
  b.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'b' } });
  expect(second).toHaveBeenLastCalledWith({ type: 'progress-update', engines: [expect.objectContaining({ id: 'b' })] });
  a.dispose(); b.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('renders quality scores and degraded outcomes without hiding a usable fallback', () => {
  const dispatch = vi.fn();
  const view = createBrainstormPresentation(dispatch);
  try {
    view.complete({ winner: 'a', response: 'usable draft', bids: [{ engineId: 'a', reasoning: 'why', approach: 'how', score: 71 }],
      panelHealth: { banner: 'panel degraded: b dropped' }, dedup: { status: 'unavailable', detail: 'fixture' },
      synthesis: { status: 'fallback', detail: 'timeout' } } as never);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'kern-draft', critique: expect.stringContaining('score: 71') }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: '⚠ panel degraded: b dropped' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Synthesis fallback: timeout' });
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'engine-block', engineId: 'a', content: 'usable draft' }));
  } finally { view.dispose(); }
});

it('renders the legacy final scoreboard including engines without a draft, only once', () => {
  vi.useFakeTimers();
  const dispatch = vi.fn();
  const view = createBrainstormPresentation(dispatch);
  view.setEngines(['a', 'b', 'skipped']);
  view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'a' } });
  view.onEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'b', ok: false, detail: 'timeout' } });
  const result = { winner: 'a', response: 'answer', bids: [{ engineId: 'a', reasoning: 'why', approach: 'how', score: 71 }] };
  view.complete(result as never);
  const expected = createScoreboard('fixture', 'brainstorm', ['a', 'b', 'skipped']);
  scoreboardFinishEngine(expected, 'a', { score: 71, result: 'bid submitted' });
  scoreboardFailEngine(expected, 'b', 'no response');
  scoreboardFailEngine(expected, 'skipped', 'no response');
  expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: renderScoreboard(expected) });
  const count = dispatch.mock.calls.length;
  view.complete(result as never);
  view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'late' } });
  vi.advanceTimersByTime(1000);
  expect(dispatch).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
  view.dispose();
});

it('preserves known seat failures and finalizes unfinished seats on workflow failure', () => {
  vi.useFakeTimers();
  const dispatch = vi.fn();
  const view = createBrainstormPresentation(dispatch);
  view.setEngines(['a', 'b']);
  view.onEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'a', ok: false, detail: 'timeout' } });
  view.fail();
  const expected = createScoreboard('fixture', 'brainstorm', ['a', 'b']);
  scoreboardFailEngine(expected, 'a', 'timeout');
  scoreboardFailEngine(expected, 'b', 'brainstorm aborted before a usable draft');
  expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: renderScoreboard(expected) });
  const count = dispatch.mock.calls.length;
  view.fail();
  vi.advanceTimersByTime(1000);
  expect(dispatch).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
  view.dispose();
});
