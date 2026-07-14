import { describe, expect, it } from 'vitest';

import { JobService, type JobTaskContext } from '@kernlang/agon-core';
import { handleDaemonJobRequest } from '../../packages/cli/src/generated/jobs/daemon-job-router.js';

describe('daemon jobs-v1 router', () => {
  const resolver = {
    resolve(kind: string) {
      return { label: `run ${kind}`, executor: { run: async (ctx: JobTaskContext) => { ctx.emit('progress', 1); return { ok: true }; } } };
    },
  };

  it('submits, lists, snapshots, replays events, and returns a result', async () => {
    const jobs = new JobService({ maxConcurrency: 1 });
    const accepted = handleDaemonJobRequest({ type: 'job-submit', kind: 'brainstorm', payload: {}, clientId: 'codex' }, jobs, resolver);
    expect(accepted?.type).toBe('job-accepted');
    if (!accepted || accepted.type !== 'job-accepted') return;
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
    if (!accepted || accepted.type !== 'job-accepted') return;
    const first = handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id, reason: 'stop' }, jobs, resolver);
    expect(first).toMatchObject({ type: 'job-cancelled', status: 'accepted', job: { state: 'cancelled' } });
    expect(handleDaemonJobRequest({ type: 'job-cancel', jobId: accepted.job.id }, jobs, resolver))
      .toMatchObject({ type: 'job-cancelled', status: 'already-cancelled' });
  });
});
