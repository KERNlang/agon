import { expect, it, vi } from 'vitest';
import { runBrainstormSession, type BrainstormSessionHost } from '../../packages/mod-brainstorm/src/session-workflow.js';
import { createBrainstormSessionRecord } from '../../packages/mod-brainstorm/src/session-record.js';

function fixture() {
  const record = { complete: vi.fn(() => undefined), fail: vi.fn() };
  const presentation = { setEngines: vi.fn(), onEvent: vi.fn(), complete: vi.fn(), fail: vi.fn(), dispose: vi.fn() };
  const host: BrainstormSessionHost = {
    cwd: () => '/fixture', hasSession: () => true, defaultEngines: () => ['fixture'],
    summaryEnabled: () => true, notify: vi.fn(),
    createPresentation: () => presentation, createRecord: () => record,
  };
  return { host, record, presentation };
}

it.each([
  { question: 3 }, { winner: 3 }, { response: 3 }, { bids: [null] },
  { dedup: { status: 'invented' } }, { synthesis: { status: 'completed', detail: 3 } },
  { groups: [{ members: ['fixture'], representative: 'fixture', similarity: 'high' }] },
  { panelHealth: { requested: 1, responded: 1, degraded: false, notes: [42], banner: null } },
  { bids: [{ engineId: 'fixture', reasoning: 'why', approach: 'how', confidence: NaN }] },
  { bids: new Array(1) },
  { groups: new Array(1) },
  { groups: [{ members: new Array(1), representative: 'fixture', similarity: 1 }] },
  { panelHealth: { requested: 1, responded: 1, degraded: false, notes: new Array(1), banner: null } },
])('rejects invalid typed result fields: %j', async invalid => {
  const { host, record, presentation } = fixture();
  const result = { question: 'fixture', winner: 'fixture', response: 'answer', bids: [], ...invalid };
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => ({ result }))).rejects.toThrow('Invalid Brainstorm result');
  expect(record.complete).not.toHaveBeenCalled();
  expect(presentation.complete).not.toHaveBeenCalled();
});

it('preserves a complete valid result by identity', async () => {
  const { host, record, presentation } = fixture();
  const result = {
    question: 'fixture', winner: 'fixture', response: 'answer',
    bids: [{ engineId: 'fixture', reasoning: 'why', approach: 'how', confidence: 80, score: 91 }],
    groups: [{ members: ['fixture'], representative: 'fixture', similarity: 1 }],
    dedup: { status: 'applied', detail: 'fixture' }, synthesis: { status: 'completed' },
    panelHealth: { requested: 1, responded: 1, degraded: false, notes: [], banner: null },
  };
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => ({ result }))).resolves.toBe(result);
  expect(record.complete).toHaveBeenCalledWith(result);
  expect(presentation.complete).toHaveBeenCalledWith(result);
});

it('preserves the legacy bare-result executor contract with structural validation', async () => {
  const { host, record } = fixture();
  const result = { exitCode: 0, question: 'fixture', winner: 'fixture', response: 'answer', bids: [] };
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => result)).resolves.toBe(result);
  expect(record.complete).toHaveBeenCalledExactlyOnceWith(result);
});

it.each([undefined, null, {}, { winner: 'fixture', response: 'answer' },
  { winner: 'fixture', response: 'answer', bids: [null] },
  { winner: 3, response: 'answer', bids: [] }])('refuses malformed result %j before success effects', async result => {
  const { host, record, presentation } = fixture();
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => ({ exitCode: 0, result }))).rejects.toThrow('Invalid Brainstorm result');
  expect(record.complete).not.toHaveBeenCalled();
  expect(presentation.complete).not.toHaveBeenCalled();
  expect(record.fail).toHaveBeenCalledOnce();
});

it('records the original failure even if the presentation failure hook throws', async () => {
  const { host, record, presentation } = fixture();
  const original = new Error('execution failed');
  presentation.fail.mockImplementation(() => { throw new Error('renderer failed'); });
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => { throw original; })).rejects.toBe(original);
  expect(record.fail).toHaveBeenCalledOnce();
  expect(presentation.dispose).toHaveBeenCalledOnce();
});

it('preserves the receiver of the presentation event method', async () => {
  const { host, presentation } = fixture();
  presentation.onEvent.mockImplementation(function (this: unknown) {
    expect(this).toBe(presentation);
  });
  await runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host, async (_input, context) => {
    context.onWorkflowEvent({} as Parameters<typeof context.onWorkflowEvent>[0]);
    return { result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } };
  });
  expect(presentation.onEvent).toHaveBeenCalledOnce();
});

it('does not execute after preparation cancels the session', async () => {
  const { host, presentation } = fixture();
  const controller = new AbortController();
  presentation.setEngines.mockImplementation(() => controller.abort(new Error('cancelled during preparation')));
  const execute = vi.fn(async () => ({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } }));
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host, execute)).rejects.toThrow('cancelled during preparation');
  expect(execute).not.toHaveBeenCalled();
});

it('keeps the cancellation reason when an aborted executor returns a failure', async () => {
  const { host } = fixture();
  const controller = new AbortController();
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host, async () => {
    controller.abort(new Error('operator cancelled'));
    return { exitCode: 1, stderr: 'child failure' };
  })).rejects.toThrow('operator cancelled');
});

it('does not create a receipt when context scanning cancels the session', async () => {
  const { host } = fixture();
  const controller = new AbortController();
  const createRecord = vi.spyOn(host, 'createRecord');
  host.scanContext = () => { controller.abort(new Error('scan cancelled')); return ''; };
  const execute = vi.fn(async () => ({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } }));
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host, execute)).rejects.toThrow('scan cancelled');
  expect(createRecord).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it('preserves the abort reason when execution throws a different error', async () => {
  const { host } = fixture();
  const controller = new AbortController();
  const reason = new Error('operator cancellation');
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host, async () => {
    controller.abort(reason);
    throw new Error('child shutdown error');
  })).rejects.toBe(reason);
});

it.each(['presentation', 'receipt', 'diagnostic'])('keeps the execution error when failure %s later cancels', async effect => {
  const { host, presentation, record } = fixture();
  const controller = new AbortController();
  const original = new Error('execution failed first');
  const abort = () => controller.abort(new Error('later cancellation'));
  if (effect === 'presentation') presentation.fail.mockImplementation(abort);
  if (effect === 'receipt') record.fail.mockImplementation(abort);
  if (effect === 'diagnostic') {
    presentation.fail.mockImplementation(() => { throw new Error('renderer failed'); });
    host.notify = abort;
  }
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host,
    async () => { throw original; })).rejects.toBe(original);
});

it('presents the answer after receipt commit even when summary formatting fails', async () => {
  const { host, presentation } = fixture();
  const controller = new AbortController();
  const receipt = vi.fn(() => 'receipt');
  host.createRecord = () => createBrainstormSessionRecord({
    question: 'fixture', engines: ['fixture'], signal: controller.signal,
  }, {
    now: () => 1000, checkpoint: vi.fn(), appendMessage: vi.fn(),
    track: vi.fn(), addResult: vi.fn(), recordRun: receipt,
    formatSummary: () => { throw new Error('format failed after receipt commit'); },
    warn: message => host.notify('warning', message),
  });
  const result = { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] };
  await expect(runBrainstormSession({ question: 'fixture' }, controller.signal, host,
    async () => ({ result }))).resolves.toBe(result);
  expect(receipt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ success: true }));
  expect(presentation.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(presentation.fail).not.toHaveBeenCalled();
  expect(host.notify).toHaveBeenCalledWith('warning', expect.stringContaining('receipt saved'));
});

it('does not mask the original failure when disposal and diagnostics throw', async () => {
  const { host, presentation, record } = fixture();
  const original = new Error('execution failed');
  presentation.fail.mockImplementation(() => { throw new Error('failure display'); });
  presentation.dispose.mockImplementation(() => { throw new Error('dispose'); });
  record.fail.mockImplementation(() => { throw new Error('record'); });
  host.notify = () => { throw new Error('diagnostic'); };
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => { throw original; })).rejects.toBe(original);
  expect(record.fail).toHaveBeenCalledOnce();
});

it('does not turn a recorded success into failure when disposal throws', async () => {
  const { host, presentation, record } = fixture();
  const result = { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] };
  presentation.dispose.mockImplementation(() => { throw new Error('dispose'); });
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => ({ result }))).resolves.toBe(result);
  expect(record.complete).toHaveBeenCalledOnce();
  expect(record.fail).not.toHaveBeenCalled();
  expect(host.notify).toHaveBeenCalledWith('warning', expect.stringContaining('cleanup'));
});

it.each([{ question: '' }, { question: 'fixture', engines: [3] }, { question: 'fixture', engines: [] },
  { question: 'fixture', engines: new Array(1) },
  { question: 'fixture', engines: ['fixture', ...new Array(1)] },
])('validates input without a chat session: %j', async input => {
  const { host } = fixture();
  host.hasSession = () => false;
  const execute = vi.fn(async () => ({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } }));
  await expect(runBrainstormSession(input, new AbortController().signal, host, execute)).rejects.toThrow('Brainstorm requires');
  expect(execute).not.toHaveBeenCalled();
});

it.each([false, true])('normalizes explicit engine arrays with session=%s', async hasSession => {
  const { host } = fixture();
  host.hasSession = () => hasSession;
  const execute = vi.fn(async () => ({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } }));
  await runBrainstormSession({ question: 'fixture', engines: [' fixture ', ' second '] }, new AbortController().signal, host, execute);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ engines: ['fixture', 'second'] }), expect.anything());
});

it('does not present success when success recording fails', async () => {
  const { host, record, presentation } = fixture();
  record.complete.mockImplementation(() => { throw new Error('receipt unavailable'); });
  await expect(runBrainstormSession({ question: 'fixture' }, new AbortController().signal, host,
    async () => ({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } }))).rejects.toThrow('receipt unavailable');
  expect(presentation.complete).not.toHaveBeenCalled();
  expect(record.fail).toHaveBeenCalledOnce();
});
