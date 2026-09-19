import { expect, it, vi } from 'vitest';
import { createBrainstormSessionRecord } from '../../packages/cli/src/blocks/brainstorm-session-record.js';

function fixture() {
  const effects = {
    now: () => 1000,
    checkpoint: vi.fn(), appendMessage: vi.fn(), track: vi.fn(), addResult: vi.fn(),
    recordRun: vi.fn(() => ({ id: 'record' })), formatSummary: vi.fn(() => 'summary'),
  };
  const controller = new AbortController();
  const chatSession = { id: 'chat' };
  const session = createBrainstormSessionRecord({ question: 'Question', engines: ['a', 'b'], chatSession, signal: controller.signal } as never, effects as never);
  const result = { winner: 'a', response: 'answer', bids: [{ engineId: 'a', reasoning: 'why', approach: 'how', score: 75 }],
    dedup: { status: 'unavailable' }, synthesis: { status: 'fallback', detail: 'timeout' } };
  return { effects, controller, chatSession, session, result };
}

it('preserves checkpoint, history, tracker, result and completed telemetry payloads', () => {
  const { effects, chatSession, session, result } = fixture();
  expect(effects.checkpoint).toHaveBeenCalledWith(expect.any(String), 'pre-dispatch', ['a', 'b'], { question: 'Question' });
  expect(session.complete(result as never)).toBe('summary');
  expect(effects.checkpoint).toHaveBeenLastCalledWith(expect.any(String), 'post-dispatch', ['a', 'b'], { winner: 'a', question: 'Question' });
  expect(effects.appendMessage.mock.calls).toEqual([
    [chatSession, { role: 'user', content: '[brainstorm] Question', timestamp: '1970-01-01T00:00:01.000Z' }],
    [chatSession, { role: 'engine', engineId: 'a', content: 'answer', timestamp: '1970-01-01T00:00:01.000Z' }],
  ]);
  expect(effects.track.mock.calls).toEqual([['a', { prompt: 'Question', response: 'why' }], ['a', { prompt: 'Question', response: 'answer' }]]);
  expect(effects.addResult).toHaveBeenCalledWith({ type: 'brainstorm', timestamp: '1970-01-01T00:00:01.000Z', question: 'Question', engines: ['a', 'b'], winner: 'a', data: { bids: result.bids, response: 'answer', dedup: result.dedup, synthesis: result.synthesis } });
  expect(effects.recordRun).toHaveBeenCalledExactlyOnceWith({ mode: 'brainstorm', intent: 'Question', winner: 'a', success: true, durationMs: 0, engineIds: ['a', 'b'], completionState: 'completed' });
  session.complete(result as never); session.fail();
  expect(effects.recordRun).toHaveBeenCalledTimes(1);
  expect(effects.appendMessage).toHaveBeenCalledTimes(2);
});

it.each([false, true])('records only failure telemetry when aborted=%s', aborted => {
  const { effects, controller, session } = fixture();
  if (aborted) controller.abort();
  session.fail(); session.fail();
  expect(effects.recordRun).toHaveBeenCalledExactlyOnceWith({ mode: 'brainstorm', intent: 'Question', success: false, durationMs: 0, engineIds: ['a', 'b'], completionState: aborted ? 'aborted' : 'crashed' });
  expect(effects.appendMessage).not.toHaveBeenCalled();
  expect(effects.addResult).not.toHaveBeenCalled();
  expect(effects.checkpoint).toHaveBeenCalledTimes(1);
});

it('refuses a late result after cancellation', () => {
  const { effects, controller, session, result } = fixture();
  controller.abort(new Error('cancelled'));
  expect(() => session.complete(result as never)).toThrow('cancelled');
  expect(effects.appendMessage).not.toHaveBeenCalled();
  expect(effects.recordRun).toHaveBeenCalledWith(expect.objectContaining({ success: false, completionState: 'aborted' }));
});

it('does not label a history write failure as a successful run', () => {
  const { effects, session, result } = fixture();
  effects.appendMessage.mockImplementation(() => { throw new Error('disk full'); });
  expect(() => session.complete(result as never)).toThrow('disk full');
  session.fail();
  expect(effects.recordRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ success: false }));
  expect(effects.addResult).not.toHaveBeenCalled();
});

it('does not duplicate a committed receipt when summary formatting fails', () => {
  const { effects, session, result } = fixture();
  effects.formatSummary.mockImplementation(() => { throw new Error('format failure'); });
  expect(() => session.complete(result as never)).toThrow('format failure');
  session.fail();
  expect(effects.recordRun).toHaveBeenCalledTimes(1);
});
