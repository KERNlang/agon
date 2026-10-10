import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as owner from '@kernlang/agon-mod-brainstorm';
import { createBrainstormPresentation as legacy } from '../fixtures/modular-brainstorm-presentation-legacy.js';
import { createBrainstormPresentation as current } from '../../packages/cli/src/blocks/brainstorm-presentation.js';

afterEach(() => vi.useRealTimers());

it('registers the legacy timer cadence through the host and cancels at completion', () => {
  const cancel = vi.fn();
  const scheduleEvery = vi.fn(() => cancel);
  const view = owner.createBrainstormPresentation({
    now: () => 0, scheduleEvery, dispatch: vi.fn(),
    icons: () => ({ success: 'ok', fail: 'fail', winner: 'best' }),
    engineColor: () => 124,
    createScoreboard: () => ({
      entries: () => [], add: vi.fn(), start: vi.fn(), finish: vi.fn(),
      fail: vi.fn(), render: () => '',
    }),
  });
  expect(scheduleEvery).toHaveBeenCalledWith(expect.any(Function), 250);
  view.complete({ question: 'fixture', winner: '', response: '', bids: [] });
  expect(cancel).toHaveBeenCalledTimes(1);
  view.complete({ question: 'fixture', winner: '', response: '', bids: [] });
  expect(cancel).toHaveBeenCalledTimes(1);
  view.dispose();
});

it('owns presentation decisions in Brainstorm rather than the CLI binding', () => {
  expect(owner).toHaveProperty('createBrainstormPresentation', expect.any(Function));
  const binding = readFileSync(new URL('../../packages/cli/src/blocks/brainstorm-presentation.ts', import.meta.url), 'utf8');
  expect(binding).not.toContain('const seats');
  expect(binding).not.toContain('result.bids');
  expect(binding).not.toContain('Synthesis fallback:');
});

it.each(['complete', 'failure', 'dispose'])('preserves raw presentation events and timer cleanup on %s', ending => {
  vi.useFakeTimers();
  const replay = (create: typeof legacy) => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    const events: unknown[] = [];
    const view = create(event => events.push(structuredClone(event)));
    view.setEngines(['a', 'b', 'missing']);
    view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'a' } });
    vi.advanceTimersByTime(1250);
    view.onEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'a', ok: true, attempts: 2 } });
    view.onEvent({ type: 'brainstorm:seat-completed', data: { engineId: 'b', ok: false, failure: 'timeout' } });
    view.onEvent({ type: 'brainstorm:dedup-started' });
    view.onEvent({ type: 'brainstorm:synthesis-started', data: { engineId: 'a' } });
    if (ending === 'complete') view.complete({ question: 'fixture', winner: 'a', response: 'answer',
      bids: [{ engineId: 'a', reasoning: 'why', approach: 'how', score: 71, confidence: 0 }],
      dedup: { status: 'unavailable', detail: 'fixture' }, synthesis: { status: 'fallback', detail: 'timeout' },
    } as never);
    else if (ending === 'failure') view.fail();
    view.dispose();
    const count = events.length;
    view.onEvent({ type: 'brainstorm:seat-started', data: { engineId: 'late' } });
    vi.advanceTimersByTime(5000);
    view.dispose();
    expect(events).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
    return events;
  };
  expect(replay(current)).toEqual(replay(legacy));
});
