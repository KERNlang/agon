import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';

import { JobService, type JobTaskContext } from '@kernlang/agon-core';
import { parseDaemonRequest, parseDaemonResponse, encodeDaemonResponse } from '../../packages/core/src/sessions/daemon-protocol.js';
import { handleDaemonJobRequest, isDaemonJobRequest } from '../../packages/mod-jobs/src/daemon-job-router.js';

describe('daemon jobs-v1 router', () => {
  it('retires the CLI-owned router source', () => {
    expect(existsSync(new URL('../../packages/cli/src/jobs/daemon-job-router.ts', import.meta.url))).toBe(false);
  });

  it('recognizes only the six validated Jobs request kinds', () => {
    for (const type of ['job-submit', 'job-list', 'job-get', 'job-events', 'job-result', 'job-cancel']) {
      expect(isDaemonJobRequest({ type })).toBe(true);
    }
    for (const type of ['prompt', 'ping', 'shutdown', 'error', 'job-shell']) {
      expect(isDaemonJobRequest({ type })).toBe(false);
    }
  });

  const resolver = {
    resolve(kind: string) {
      return { label: `run ${kind}`, executor: { run: async (ctx: JobTaskContext) => { ctx.emit('progress', 1); return { ok: true }; } } };
    },
  };

  it('submits, lists, snapshots, replays events, and returns a result', async () => {
    const jobs = new JobService({ maxConcurrency: 1 });
    const accepted = handleDaemonJobRequest({ type: 'job-submit', kind: 'brainstorm', payload: {}, clientId: 'codex' }, jobs, resolver);
    expect(accepted?.type).toBe('job-accepted');
    if (!accepted || accepted.type !== 'job-accepted') throw new Error('Job not accepted');
    const id = accepted.job.id;
    expect(handleDaemonJobRequest({ type: 'job-list' }, jobs, resolver)).toMatchObject({ type: 'job-list' });
    expect(handleDaemonJobRequest({ type: 'job-get', jobId: id }, jobs, resolver)).toMatchObject({ type: 'job-snapshot' });
    await jobs.wait(id);
    const events = handleDaemonJobRequest({ type: 'job-events', jobId: id, afterSeq: 0 }, jobs, resolver);
    expect(events).toMatchObject({ type: 'job-events', terminal: true });
    if (events?.type === 'job-events') expect(events.events.some((event) => event.type === 'submitted')).toBe(true);
    expect(handleDaemonJobRequest({ type: 'job-result', jobId: id }, jobs, resolver)).toMatchObject({
      type: 'job-result', ready: true, outcome: { state: 'succeeded', value: { ok: true } },
    });
  });

  it('reports not-found and idempotent cancellation states', () => {
    const jobs = new JobService({ maxConcurrency: 1 });
    expect(handleDaemonJobRequest({ type: 'job-get', jobId: 'missing' }, jobs, resolver)).toEqual({ type: 'job-not-found', jobId: 'missing' });
    const accepted = handleDaemonJobRequest({ type: 'job-submit', kind: 'review', payload: {} }, jobs, {
      resolve: () => ({ label: 'wait', executor: { run: ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })) } }),
    });
    if (!accepted || accepted.type !== 'job-accepted') throw new Error('Job not accepted');
    const first = handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id, reason: 'stop' }, jobs, resolver);
    expect(first).toMatchObject({ type: 'job-cancelled', status: 'accepted', job: { state: 'cancelled' } });
    expect(handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id }, jobs, resolver))
      .toMatchObject({ type: 'job-cancelled', status: 'already-cancelled' });
  });

  it('returns the same missing-job response for every read and cancel operation', () => {
    const jobs = new JobService();
    for (const type of ['job-get', 'job-events', 'job-result', 'job-cancel'] as const) {
      expect(handleDaemonJobRequest({ type, jobId: 'absent' }, jobs, resolver))
        .toEqual({ type: 'job-not-found', jobId: 'absent' });
    }
  });

  it('routes only parsed Jobs frames and preserves wire normalization', () => {
    const jobs = new JobService();
    const resolve = vi.fn(resolver.resolve);
    for (const frame of ['{"type":"job-submit"}', '{"type":"job-get","jobId":42}', '{"type":"ping"}']) {
      const request = parseDaemonRequest(frame);
      expect(request).not.toBeNull();
      if (request && isDaemonJobRequest(request)) handleDaemonJobRequest(request, jobs, { resolve });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(jobs.list()).toEqual([]);
    const request = parseDaemonRequest('{"type":"job-get","jobId":" absent "}');
    if (!request || !isDaemonJobRequest(request)) throw new Error('Valid request was rejected');
    const response = handleDaemonJobRequest(request, jobs, { resolve });
    if (!response) throw new Error('Missing reply');
    const encoded = encodeDaemonResponse(response);
    expect(encoded).toBe('{"type":"job-not-found","jobId":"absent"}\n');
    expect(parseDaemonResponse(encoded)).toEqual(response);
  });

  it('preserves resolver input, client attribution, bounded replay and failed outcomes', async () => {
    const jobs = new JobService();
    const payload = { input: 'inspect' };
    const resolve = vi.fn(() => ({ label: 'resolved label', executor: {
      run: async (ctx: JobTaskContext) => { ctx.emit('progress', 1); throw new Error('fixture failure'); },
    } }));
    const accepted = handleDaemonJobRequest({ type: 'job-submit', kind: 'review', payload, clientId: 'caller' }, jobs, { resolve });
    if (accepted?.type !== 'job-accepted') throw new Error('Job not accepted');
    expect(resolve).toHaveBeenCalledExactlyOnceWith('review', payload);
    expect(accepted.job.label).toBe('resolved label');
    await jobs.wait(accepted.job.id);
    const events = handleDaemonJobRequest({ type: 'job-events', jobId: accepted.job.id, afterSeq: 2, limit: 1 }, jobs, resolver);
    expect(events).toMatchObject({ type: 'job-events', nextSeq: 3, earliestSeq: 1, terminal: true, truncated: false,
      events: [{ seq: 3, type: 'submitted', data: { clientId: 'caller' } }] });
    expect(events?.type === 'job-events' && events.events).toHaveLength(1);
    expect(handleDaemonJobRequest({ type: 'job-result', jobId: accepted.job.id }, jobs, resolver))
      .toMatchObject({ type: 'job-result', ready: true, outcome: { state: 'failed', error: 'fixture failure' } });
    expect(handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id }, jobs, resolver))
      .toMatchObject({ type: 'job-cancelled', status: 'already-terminal' });
  });

  it('does not create a job if workflow resolution fails', () => {
    const jobs = new JobService();
    expect(() => handleDaemonJobRequest({ type: 'job-submit', kind: 'invalid', payload: {} }, jobs, {
      resolve: () => { throw new Error('not allowed'); },
    })).toThrow('not allowed');
    expect(jobs.list()).toEqual([]);
  });

  it('keeps pending results nonblocking and preserves terminal cancellation', async () => {
    const jobs = new JobService();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const accepted = handleDaemonJobRequest({ type: 'job-submit', kind: 'review', payload: {} }, jobs, {
      resolve: () => ({ label: 'pending', executor: { run: async () => { await ready; return 'done'; } } }),
    });
    expect(accepted?.type).toBe('job-accepted');
    if (accepted?.type !== 'job-accepted') throw new Error('Job not accepted');
    try {
      expect(handleDaemonJobRequest({ type: 'job-result', jobId: accepted.job.id }, jobs, resolver))
        .toMatchObject({ type: 'job-result', ready: false });
    } finally { release(); }
    await jobs.wait(accepted.job.id);
    expect(handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id }, jobs, resolver))
      .toMatchObject({ type: 'job-cancelled', status: 'already-terminal', job: { state: 'succeeded' } });
  });
});
