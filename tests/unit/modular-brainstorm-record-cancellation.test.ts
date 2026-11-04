import { expect, it } from 'vitest';
import { createBrainstormSessionRecord } from '../../packages/mod-brainstorm/src/session-record.js';
import type { BrainstormSessionEffects } from '../../packages/mod-brainstorm/src/session-record.js';
import { runBrainstormSession, type BrainstormSessionHost } from '../../packages/mod-brainstorm/src/session-workflow.js';

const writes = ['checkpoint', 'user-message', 'engine-message', 'bid-a', 'bid-b', 'winner', 'result'] as const;

function fixture(abortAfter: string) {
  const controller = new AbortController();
  const reason = new Error('operator cancelled');
  const events: string[] = [];
  const record = (event: string) => {
    events.push(event);
    if (event === abortAfter) controller.abort(reason);
  };
  const effects: BrainstormSessionEffects<string> = {
    now: () => 1000,
    checkpoint: (_id, phase) => { if (phase === 'post-dispatch') record('checkpoint'); },
    appendMessage: message => record(`${message.role}-message`),
    track: (id, exchange) => record(exchange.response === 'answer' ? 'winner' : `bid-${id}`),
    addResult: () => record('result'),
    recordRun: receipt => { record(receipt.completionState); return 'receipt'; },
    formatSummary: () => { record('summary'); return 'summary'; },
  };
  const session = createBrainstormSessionRecord({ question: 'Question', engines: ['a', 'b'], signal: controller.signal }, effects);
  const result = { winner: 'a', response: 'answer', bids: [
    { engineId: 'a', reasoning: 'why a', approach: 'how a' },
    { engineId: 'b', reasoning: 'why b', approach: 'how b' },
  ] };
  return { session, result, events, reason, controller };
}

it.each(writes)('stops later recording writes after cancellation in %s', abortAfter => {
  const { session, result, events, reason } = fixture(abortAfter);
  expect(() => session.complete(result)).toThrow(reason);
  expect(events).toEqual([...writes.slice(0, writes.indexOf(abortAfter) + 1), 'aborted']);
  session.fail();
  session.complete(result);
  expect(events).toEqual([...writes.slice(0, writes.indexOf(abortAfter) + 1), 'aborted']);
});

it('does not relabel an already committed completion when its receipt effect cancels', () => {
  const { session, result, events } = fixture('completed');
  expect(session.complete(result)).toBe('summary');
  session.fail();
  session.complete(result);
  expect(events).toEqual([...writes, 'completed', 'summary']);
});

it('routes cancellation from real recording to failure presentation and cleanup', async () => {
  const { session, result, events, reason, controller } = fixture('user-message');
  const host: BrainstormSessionHost = {
    cwd: () => '/fixture', hasSession: () => true, defaultEngines: () => ['a', 'b'],
    summaryEnabled: () => true, notify: () => { events.push('notify'); },
    createRecord: () => session,
    createPresentation: () => ({
      setEngines: () => {}, onEvent: () => {},
      complete: () => { events.push('present-success'); },
      fail: () => { events.push('present-failure'); },
      dispose: () => { events.push('dispose'); },
    }),
  };
  await expect(runBrainstormSession({ question: 'Question' }, controller.signal, host,
    async () => ({ result: { ...result, question: 'Question',
      bids: result.bids.map(bid => ({ ...bid, confidence: 80 })) } }))).rejects.toBe(reason);
  expect(events).toEqual(['checkpoint', 'user-message', 'aborted', 'present-failure', 'dispose']);
});
