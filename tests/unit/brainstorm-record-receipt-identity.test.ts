import { expect, it, vi } from 'vitest';
import { createBrainstormSessionRecord } from '../../packages/mod-brainstorm/src/session-record.js';

it('uses the checkpoint identity for every terminal receipt attempt', () => {
  const checkpoint = vi.fn();
  const receipts: Array<Record<string, unknown>> = [];
  const session = createBrainstormSessionRecord({ question: 'fixture', engines: ['fixture'], signal: new AbortController().signal }, {
    now: () => 1000, checkpoint, appendMessage: () => {}, track: () => {}, addResult: () => {},
    recordRun: result => { receipts.push(result); if (result.success) throw new Error('after publication'); return 'receipt'; },
    formatSummary: () => 'summary',
  });
  expect(() => session.complete({ winner: 'fixture', response: 'answer', bids: [] })).toThrow('after publication');
  session.fail();
  const id = checkpoint.mock.calls[0][0];
  expect(typeof id).toBe('string');
  expect(receipts).toHaveLength(2);
  expect(receipts.map(receipt => receipt.id)).toEqual([id, id]);
});

it('does not repeat history effects after a partial recording failure', () => {
  const appendMessage = vi.fn();
  const session = createBrainstormSessionRecord({ question: 'fixture', engines: ['fixture'], signal: new AbortController().signal }, {
    now: () => 1000, checkpoint: () => {}, appendMessage, track: () => {},
    addResult: () => { throw new Error('result store unavailable'); },
    recordRun: () => 'receipt', formatSummary: () => 'summary',
  });
  const result = { winner: 'fixture', response: 'answer', bids: [] };
  expect(() => session.complete(result)).toThrow('result store unavailable');
  expect(() => session.complete(result)).toThrow('already started');
  expect(appendMessage).toHaveBeenCalledTimes(2);
  session.fail();
});

it('retries failed failure recording with the same identity and then settles', () => {
  const recordRun = vi.fn().mockImplementationOnce(() => { throw new Error('disk unavailable'); }).mockReturnValue('receipt');
  const appendMessage = vi.fn();
  const session = createBrainstormSessionRecord({ question: 'fixture', engines: ['fixture'], signal: new AbortController().signal }, {
    now: () => 1000, checkpoint: () => {}, appendMessage, track: () => {}, addResult: () => {},
    recordRun, formatSummary: () => 'summary',
  });
  expect(() => session.fail()).toThrow('disk unavailable');
  session.fail();
  session.fail();
  expect(recordRun).toHaveBeenCalledTimes(2);
  expect(recordRun.mock.calls[0][0].id).toBe(recordRun.mock.calls[1][0].id);
  expect(appendMessage).not.toHaveBeenCalled();
});

it.each(['checkpoint', 'user', 'engine', 'bid', 'winner', 'result'])('stops recording after cancellation at %s', phase => {
  const controller = new AbortController();
  const events: string[] = [];
  const write = (name: string) => { events.push(name); if (name === phase) controller.abort(new Error('cancelled')); };
  const session = createBrainstormSessionRecord({ question: 'fixture', engines: ['fixture'], signal: controller.signal }, {
    now: () => 1000,
    checkpoint: (_id, checkpointPhase) => { if (checkpointPhase === 'post-dispatch') write('checkpoint'); },
    appendMessage: message => write(message.role), track: (_id, exchange) => write(exchange.response === 'answer' ? 'winner' : 'bid'),
    addResult: () => write('result'), recordRun: result => { write(result.completionState); return 'receipt'; },
    formatSummary: () => 'summary',
  });
  expect(() => session.complete({ winner: 'fixture', response: 'answer', bids: [{ engineId: 'fixture', reasoning: 'why', approach: 'how' }] })).toThrow('cancelled');
  const phases = ['checkpoint', 'user', 'engine', 'bid', 'winner', 'result'];
  expect(events).toEqual([...phases.slice(0, phases.indexOf(phase) + 1), 'aborted']);
  session.fail();
  expect(events.filter(event => event === 'aborted')).toHaveLength(1);
});
