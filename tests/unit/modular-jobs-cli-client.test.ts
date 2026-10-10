import { describe, expect, it, vi } from 'vitest';
import { createJobCliClient } from '@kernlang/agon-mod-jobs';
import type { JobCliHost, JobCliResponse, JobSnapshot } from '@kernlang/agon-mod-jobs';

const job: JobSnapshot = { id: 'fixture', kind: 'review', label: 'review changes', state: 'succeeded', createdAt: 'now' };
const timing = { pollMs: '1', connectTimeoutMs: '10', requestTimeoutMs: '10', waitTimeoutMs: '0', json: true };

function clientWith(...responses: Array<JobCliResponse | null>) {
  const sendRequest = vi.fn<JobCliHost['sendRequest']>();
  sendRequest.mockResolvedValueOnce({ type: 'pong', capabilities: ['jobs-v1'] });
  for (const response of responses) sendRequest.mockResolvedValueOnce(response);
  const host: JobCliHost = {
    sendRequest, startDaemon: vi.fn(), log: vi.fn(), error: vi.fn(),
    stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, setExitCode: vi.fn(),
  };
  return { host, client: createJobCliClient(host) };
}

describe('physical Jobs CLI client', () => {
  it('submits a structured workflow and prints only the waited JSON result', async () => {
    const outcome = { state: 'succeeded' as const, value: 'done' };
    const { host, client } = clientWith({ type: 'job-accepted', job }, { type: 'job-result', job, ready: true, outcome });
    await client.commands.submit({ ...timing, kind: 'review', input: ' changes ', cwd: '/fixture', payload: '{"base":"main"}', wait: true });
    expect(host.sendRequest).toHaveBeenNthCalledWith(2, {
      type: 'job-submit', kind: 'review', payload: { base: 'main', input: 'changes', cwd: '/fixture' }, clientId: 'agon-cli',
    }, 10);
    expect(host.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ job, outcome }, null, 2));
    expect(host.startDaemon).not.toHaveBeenCalled();
  });

  it('lists daemon jobs instead of a factory-local scheduler', async () => {
    const { host, client } = clientWith({ type: 'job-list', jobs: [job] });
    await client.commands.list(timing);
    expect(host.sendRequest).toHaveBeenLastCalledWith({ type: 'job-list' }, 10);
    expect(host.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify([job], null, 2));
  });

  it('reports failed status and cancelled results with their existing exit codes', async () => {
    const failed = { ...job, state: 'failed' as const, error: 'failed' };
    const status = clientWith({ type: 'job-snapshot', job: failed });
    await status.client.commands.status({ ...timing, jobId: job.id });
    expect(status.host.setExitCode).toHaveBeenCalledWith(1);
    const result = clientWith({ type: 'job-result', job, ready: true, outcome: { state: 'cancelled', error: 'stopped' } });
    await result.client.commands.result({ ...timing, jobId: job.id });
    expect(result.host.setExitCode).toHaveBeenCalledWith(130);
  });

  it('follows ordered JSONL events and preserves the terminal result record', async () => {
    const event = { seq: 5, ts: 1, type: 'stdout', data: '🦒' };
    const outcome = { state: 'succeeded' as const, value: 'done' };
    const { host, client } = clientWith(
      { type: 'job-events', jobId: job.id, events: [event], nextSeq: 5, earliestSeq: 5, terminal: true, truncated: true },
      { type: 'job-result', job, ready: true, outcome },
    );
    await client.commands.events({ ...timing, jobId: job.id, after: '0', limit: '10', follow: true });
    expect(host.sendRequest).toHaveBeenNthCalledWith(2, { type: 'job-events', jobId: job.id, afterSeq: 0, limit: 10 }, 10);
    expect(host.error).toHaveBeenCalledWith('Event history was truncated; resuming at sequence 5.');
    expect(host.log).toHaveBeenNthCalledWith(1, JSON.stringify(event));
    expect(host.log).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'job-result', job, outcome }));
  });

  it('cancels through the daemon and preserves its idempotency status', async () => {
    const response = { type: 'job-cancelled' as const, job, status: 'already-terminal' as const };
    const { host, client } = clientWith(response);
    await client.commands.cancel({ ...timing, jobId: job.id, reason: ' operator request ' });
    expect(host.sendRequest).toHaveBeenLastCalledWith({ type: 'job-cancel', jobId: job.id, reason: 'operator request' }, 10);
    expect(host.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(response, null, 2));
  });

  it('polls pending results and advances the event cursor', async () => {
    vi.useFakeTimers();
    try {
      const outcome = { state: 'succeeded' as const, value: 'done' };
      const result = clientWith({ type: 'job-result', job, ready: false }, { type: 'job-result', job, ready: true, outcome });
      const waiting = result.client.commands.result({ ...timing, jobId: job.id, wait: true });
      await vi.runAllTimersAsync();
      await waiting;
      expect(result.host.sendRequest).toHaveBeenCalledTimes(3);
      expect(result.host.setExitCode).not.toHaveBeenCalled();
      const events = clientWith(
        { type: 'job-events', jobId: job.id, events: [], nextSeq: 7, earliestSeq: 1, terminal: false, truncated: false },
        { type: 'job-events', jobId: job.id, events: [], nextSeq: 8, earliestSeq: 1, terminal: true, truncated: false },
        { type: 'job-result', job, ready: true, outcome },
      );
      const following = events.client.commands.events({ ...timing, jobId: job.id, after: '0', limit: '10', follow: true });
      await vi.runAllTimersAsync();
      await following;
      expect(events.host.sendRequest).toHaveBeenNthCalledWith(3, { type: 'job-events', jobId: job.id, afterSeq: 7, limit: 10 }, 10);
    } finally { vi.useRealTimers(); }
  });

  it.each(['result', 'events'] as const)('bounds %s polling by the requested timeout', async action => {
    vi.useFakeTimers();
    try {
      const { host, client } = clientWith();
      vi.mocked(host.sendRequest).mockResolvedValue(action === 'result'
        ? { type: 'job-result', job, ready: false }
        : { type: 'job-events', jobId: job.id, events: [], nextSeq: 0, earliestSeq: 1, terminal: false, truncated: false });
      const pending = client.commands[action]({ ...timing, jobId: job.id, wait: true, follow: true, after: '0', limit: '10', waitTimeoutMs: '2' });
      await vi.runAllTimersAsync();
      await pending;
      expect(host.error).toHaveBeenCalledWith(expect.stringMatching(/Timed out/));
      expect(host.setExitCode).toHaveBeenCalledWith(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('keeps plain stream chunks exact and separate from line output', () => {
    const { host, client } = clientWith();
    client.printEvent({ seq: 1, ts: 1, type: 'stdout', data: '🦒' }, false);
    client.printEvent({ seq: 2, ts: 1, type: 'stderr', data: { text: 'error' } }, false);
    expect(host.stdout.write).toHaveBeenCalledExactlyOnceWith('🦒');
    expect(host.stderr.write).toHaveBeenCalledExactlyOnceWith('error');
    expect(host.log).not.toHaveBeenCalled();
  });

  it('preserves human-readable rows, empty lists, cancellation and outcomes', async () => {
    const { host, client } = clientWith({ type: 'job-list', jobs: [] });
    await client.commands.list({ ...timing, json: false });
    expect(host.log).toHaveBeenLastCalledWith('No retained jobs.');
    client.printSnapshot({ ...job, state: 'failed', error: 'broken' }, false);
    expect(host.log).toHaveBeenLastCalledWith('fixture  failed     review  review changes · broken');
    client.printOutcome(job, { state: 'succeeded', value: 'answer' }, false);
    expect(host.log).toHaveBeenLastCalledWith('answer');
    client.printEvent({ seq: 2, ts: 1, type: 'progress', data: { value: 1 } }, false);
    expect(host.log).toHaveBeenLastCalledWith('[2] progress {"value":1}');
    const cancelled = clientWith({ type: 'job-cancelled', job, status: 'already-terminal' });
    await cancelled.client.commands.cancel({ ...timing, json: false, jobId: job.id });
    expect(cancelled.host.log).toHaveBeenNthCalledWith(1, 'already-terminal: fixture');
    expect(cancelled.host.log).toHaveBeenNthCalledWith(2, 'fixture  succeeded  review  review changes');
  });

  it.each([true, false])('forwards quiet startup %s and bounds an unready daemon', async quiet => {
    vi.useFakeTimers();
    try {
      const { host, client } = clientWith();
      vi.mocked(host.sendRequest).mockReset().mockResolvedValue(null);
      const pending = client.ensureJobDaemon({ pollMs: 1, connectTimeoutMs: 2, requestTimeoutMs: 1 }, quiet);
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ ok: false, message: 'Daemon did not become ready within 2ms.' });
      expect(host.startDaemon).toHaveBeenCalledExactlyOnceWith(quiet);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([null, { type: 'error', message: 'blocked' }, { type: 'bye' }] as Array<JobCliResponse | null>)('fails honestly on a missing or wrong reply: %j', async response => {
    const { host, client } = clientWith(response);
    await client.commands.list(timing);
    expect(host.error).toHaveBeenCalledOnce();
    expect(host.setExitCode).toHaveBeenCalledWith(2);
    expect(host.log).not.toHaveBeenCalled();
  });
});
