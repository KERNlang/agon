import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as physical from '@kernlang/agon-mod-brainstorm';
import type { BrainstormSessionEffects } from '@kernlang/agon-mod-brainstorm';
import { createBrainstormSessionRecord } from '../../packages/cli/src/blocks/brainstorm-session-record.js';

it('exports session-record orchestration from the physical mod, not the CLI adapter', () => {
  expect(physical).toHaveProperty('createBrainstormSessionRecord');
  const source = readFileSync(new URL('../../packages/cli/src/blocks/brainstorm-session-record.ts', import.meta.url), 'utf8');
  expect(source).toContain("from '@kernlang/agon-mod-brainstorm'");
  expect(source).not.toContain('let settled');
  expect(source).not.toContain('randomUUID');
  expect(source).not.toContain('for (const bid');
  const owner = readFileSync(new URL('../../packages/mod-brainstorm/src/session-record.ts', import.meta.url), 'utf8');
  expect(owner).not.toMatch(/from ['"](?:@kernlang\/agon-core|.*\/cli\/)/);
  expect(owner).not.toMatch(/\b(?:ChatSession|Dispatch)\b/);
});

it('runs through typed physical effects without exposing the host session', () => {
  const appendMessage = vi.fn<BrainstormSessionEffects<string>['appendMessage']>();
  const effects: BrainstormSessionEffects<string> = {
    now: () => 1000, checkpoint: vi.fn(), appendMessage, track: vi.fn(), addResult: vi.fn(),
    recordRun: () => 'receipt', formatSummary: receipt => receipt,
  };
  const session = physical.createBrainstormSessionRecord({ question: 'Question', engines: ['a'],
    signal: new AbortController().signal }, effects);
  expect(session.complete({ winner: 'a', response: 'answer',
    bids: [{ engineId: 'a', reasoning: 'why', approach: 'how' }] })).toBe('receipt');
  expect(appendMessage.mock.calls).toStrictEqual([
    [{ role: 'user', content: '[brainstorm] Question', timestamp: '1970-01-01T00:00:01.000Z' }],
    [{ role: 'engine', engineId: 'a', content: 'answer', timestamp: '1970-01-01T00:00:01.000Z' }],
  ]);
});

function fixture() {
  const effects = {
    now: () => 1000,
    checkpoint: vi.fn(), appendMessage: vi.fn(), track: vi.fn(), addResult: vi.fn(),
    recordRun: vi.fn<BrainstormSessionEffects<{ id: string }>['recordRun']>(() => ({ id: 'record' })), formatSummary: vi.fn(() => 'summary'),
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
  session.complete({ winner: 'a', response: 'late', bids: [] });
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
  expect(effects.checkpoint).toHaveBeenCalledTimes(1);
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.addResult).not.toHaveBeenCalled();
  expect(effects.recordRun).toHaveBeenCalledWith(expect.objectContaining({ success: false, completionState: 'aborted' }));
  session.fail(); session.complete(result as never);
  expect(effects.recordRun).toHaveBeenCalledTimes(1);
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

it('preserves inherited and late-bound host effects', () => {
  const { effects, controller, chatSession, result } = fixture();
  const inherited = Object.create(effects);
  const session = createBrainstormSessionRecord({ question: 'Question', engines: ['a', 'b'],
    chatSession, signal: controller.signal } as never, inherited);
  inherited.now = () => 1500;
  expect(session.complete(result as never)).toBe('summary');
  expect(effects.recordRun).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 500 }));
});

it('preserves cross-effect order, advancing timestamps and the bid projection', () => {
  const { effects, session, result } = fixture();
  const times = [1100, 1200, 1300, 1500];
  effects.now = () => times.shift()!;
  const bid = { ...result.bids[0], confidence: 99, extraMetadata: 'not a result field' };
  session.complete({ ...result, bids: [bid] } as never);
  expect(effects.appendMessage.mock.calls.map(call => call[1].timestamp)).toStrictEqual([
    '1970-01-01T00:00:01.100Z', '1970-01-01T00:00:01.200Z',
  ]);
  expect(effects.addResult.mock.calls[0][0].timestamp).toBe('1970-01-01T00:00:01.300Z');
  expect(effects.recordRun.mock.calls[0][0].durationMs).toBe(500);
  expect(effects.addResult.mock.calls[0][0].data.bids).toStrictEqual(result.bids);
  expect(effects.addResult.mock.calls[0][0].data.bids[0]).not.toBe(bid);
  const order = [effects.checkpoint.mock.invocationCallOrder[0], effects.checkpoint.mock.invocationCallOrder[1],
    ...effects.appendMessage.mock.invocationCallOrder, ...effects.track.mock.invocationCallOrder,
    ...effects.addResult.mock.invocationCallOrder, ...effects.recordRun.mock.invocationCallOrder,
    ...effects.formatSummary.mock.invocationCallOrder];
  expect(order).toStrictEqual([...order].sort((a, b) => a - b));
});
