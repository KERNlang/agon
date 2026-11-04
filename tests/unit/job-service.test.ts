import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import { JobService } from '../../packages/mod-jobs/src/job-service.js';
import { DEFAULT_AGON_CONFIG, JobService as PublicCoreJobService } from '@kernlang/agon-core';
import { JobService as PublicModJobService } from '@kernlang/agon-mod-jobs';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type InspectableJobService = {
  records: Map<string, { executor: unknown }>;
};

const retainedExecutor = (jobs: JobService, id: string) => (
  (jobs as unknown as InspectableJobService).records.get(id)?.executor
);

describe('JobService', () => {
  it('keeps one physical scheduler behind the Core compatibility export', () => {
    expect(PublicCoreJobService).toBe(PublicModJobService);
    expect(existsSync(new URL('../../packages/core/src/jobs/job-service.ts', import.meta.url))).toBe(false);
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-slice5-migration-ledger.json', import.meta.url), 'utf8'));
    const declarations = ledger.assignments.filter((row: { legacyPath: string }) => row.legacyPath === 'packages/core/src/jobs/job-service.ts');
    expect(declarations.map((row: { id: string }) => row.id).sort()).toEqual(['JobEvent', 'JobRecord', 'JobSnapshot']);
    for (const row of declarations) {
      expect(row.implementationPaths).toEqual(['packages/mod-jobs/src/job-service.ts']);
      expect(row.legacyPresent).toBe(false);
      expect(row.removalEvidence).toBe('tests/unit/job-service.test.ts');
    }
  });

  it('preserves configured scheduler defaults after the physical move', async () => {
    const jobs = new JobService();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const submitted = Array.from({ length: DEFAULT_AGON_CONFIG.jobMaxConcurrency + 1 }, () =>
      jobs.submit('fixture', 'defaults', { run: async () => { await gate; } }));
    expect(jobs.list().filter(job => job.state === 'running')).toHaveLength(DEFAULT_AGON_CONFIG.jobMaxConcurrency);
    expect(jobs.list().filter(job => job.state === 'queued')).toHaveLength(1);
    release();
    await Promise.all(submitted.map(job => jobs.wait(job.id)));
    const noisy = jobs.submit('fixture', 'events', { run: async ({ emit }) => {
      for (let index = 0; index < DEFAULT_AGON_CONFIG.jobEventLimit + 10; index++) emit('progress', index);
    } });
    await jobs.wait(noisy.id);
    expect(jobs.events(noisy.id)?.events).toHaveLength(DEFAULT_AGON_CONFIG.jobEventLimit);
    for (let index = 0; index < DEFAULT_AGON_CONFIG.jobRetentionLimit + 1; index++) {
      const job = jobs.submit('fixture', 'retention', { run: async () => index });
      await jobs.wait(job.id);
    }
    await tick();
    expect(jobs.list()).toHaveLength(DEFAULT_AGON_CONFIG.jobRetentionLimit);
  });
  it('runs a submitted job to success with ordered replayable events and a result', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 2 });
    const job = jobs.submit('call', 'safe task', {
      run: async ({ emit }) => {
        emit('progress', { step: 1 });
        return { ok: true };
      },
    });

    expect(job.state).toBe('running');
    await tick();

    expect(jobs.get(job.id)?.state).toBe('succeeded');
    expect(jobs.result(job.id)).toMatchObject({ state: 'succeeded', value: { ok: true } });
    expect(jobs.events(job.id)?.events.map((event) => event.type)).toEqual([
      'queued', 'started', 'progress', 'succeeded',
    ]);
    expect(jobs.events(job.id)?.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(jobs.events(job.id, 2)?.events.map((event) => event.seq)).toEqual([3, 4]);
  });

  it('cancels a running job immediately, aborts its signal, and ignores late success', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    const observed = vi.fn();
    const job = jobs.submit('build', 'cancel me', {
      run: async ({ signal }) => {
        signal.addEventListener('abort', observed, { once: true });
        await new Promise<void>((resolve) => { release = resolve; });
        return 'late success';
      },
    });
    await tick();

    expect(jobs.cancel(job.id, 'user cancelled')).toBe(true);
    expect(jobs.cancel(job.id, 'duplicate')).toBe(false);
    expect(jobs.get(job.id)?.state).toBe('cancelled');
    expect(jobs.result(job.id)).toMatchObject({ state: 'cancelled', error: 'user cancelled' });
    expect(observed).toHaveBeenCalledTimes(1);

    release();
    await tick();
    expect(jobs.get(job.id)?.state).toBe('cancelled');
    expect(jobs.events(job.id)?.events.at(-1)?.type).toBe('cancelled');
  });

  it('cancels queued work before its executor starts', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    jobs.submit('first', 'occupy slot', {
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    await tick();
    const secondRun = vi.fn(async () => 'should not run');
    const second = jobs.submit('second', 'queued', { run: secondRun });

    expect(second.state).toBe('queued');
    expect(jobs.cancel(second.id)).toBe(true);
    release();
    await tick();

    expect(secondRun).not.toHaveBeenCalled();
    expect(jobs.get(second.id)?.state).toBe('cancelled');
  });

  it('keeps an abort-ignoring executor in its concurrency slot until it settles', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    const first = jobs.submit('first', 'ignores abort', {
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const secondRun = vi.fn(async () => 'second');
    const second = jobs.submit('second', 'must remain queued', { run: secondRun });

    jobs.cancel(first.id);
    await tick();
    expect(jobs.get(first.id)?.state).toBe('cancelled');
    expect(jobs.get(second.id)?.state).toBe('queued');
    expect(secondRun).not.toHaveBeenCalled();

    release();
    await tick();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('waits for cancelled executors to actually settle before reporting idle', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    const job = jobs.submit('build', 'drain before shutdown', {
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    await tick();

    expect(jobs.cancelAll('daemon shutting down')).toBe(1);
    expect(jobs.get(job.id)?.state).toBe('cancelled');
    let drained = false;
    const drain = jobs.waitForIdle().then(() => { drained = true; });
    await tick();
    expect(drained).toBe(false);

    release();
    await drain;
    expect(drained).toBe(true);
  });

  it('bounds shutdown draining when an executor ignores cancellation', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    jobs.submit('build', 'ignore cancellation', {
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    await tick();
    jobs.cancelAll('shutdown');

    await expect(jobs.waitForIdle(10)).resolves.toBe(false);
    release();
    await expect(jobs.waitForIdle(100)).resolves.toBe(true);
  });

  it('releases executor references once retained jobs no longer need them', async () => {
    const completedJobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    const completed = completedJobs.submit('done', 'retained success', { run: async () => 'ok' });
    await tick();

    expect(completedJobs.get(completed.id)?.state).toBe('succeeded');
    expect(retainedExecutor(completedJobs, completed.id)).toBeNull();

    const queuedJobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    let release!: () => void;
    queuedJobs.submit('blocker', 'occupy slot', {
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    await tick();
    const queued = queuedJobs.submit('queued', 'cancel before start', { run: async () => 'unused' });

    expect(queuedJobs.cancel(queued.id)).toBe(true);
    expect(retainedExecutor(queuedJobs, queued.id)).toBeNull();
    release();
  });

  it('records failures without converting them into success', async () => {
    const jobs = new JobService({ eventLimit: 8, retentionLimit: 4, maxConcurrency: 1 });
    const job = jobs.submit('review', 'fail', { run: async () => { throw new Error('engine broke'); } });
    await tick();

    expect(jobs.get(job.id)?.state).toBe('failed');
    expect(jobs.result(job.id)).toMatchObject({ state: 'failed', error: 'engine broke' });
  });

  it('bounds retained events while keeping monotonic sequence cursors', async () => {
    const jobs = new JobService({ eventLimit: 3, retentionLimit: 4, maxConcurrency: 1 });
    const job = jobs.submit('call', 'many events', {
      run: async ({ emit }) => {
        emit('progress', 1);
        emit('progress', 2);
        emit('progress', 3);
      },
    });
    await tick();

    const page = jobs.events(job.id)!;
    expect(page.events.map((event) => event.seq)).toEqual([4, 5, 6]);
    expect(page.earliestSeq).toBe(4);
    expect(page.truncated).toBe(true);
    expect(jobs.events(job.id, 4)?.events.map((event) => event.seq)).toEqual([5, 6]);
  });

  it('prunes the oldest terminal job at the configured retention limit', async () => {
    const jobs = new JobService({ eventLimit: 4, retentionLimit: 2, maxConcurrency: 1 });
    const first = jobs.submit('one', 'one', { run: async () => 1 });
    await tick();
    const second = jobs.submit('two', 'two', { run: async () => 2 });
    await tick();
    const third = jobs.submit('three', 'three', { run: async () => 3 });
    await tick();

    expect(jobs.get(first.id)).toBeUndefined();
    expect(jobs.list().map((job) => job.id)).toEqual([second.id, third.id]);
  });

  it('returns defensive snapshots and truthful unknown-id results', () => {
    const jobs = new JobService({ eventLimit: 4, retentionLimit: 2, maxConcurrency: 1 });
    const manual = jobs.createManual('legacy', 'facade');
    const copy = jobs.get(manual.id)!;
    copy.state = 'failed';

    expect(jobs.get(manual.id)?.state).toBe('running');
    expect(jobs.get('missing')).toBeUndefined();
    expect(jobs.result('missing')).toBeUndefined();
    expect(jobs.events('missing')).toBeUndefined();
    expect(jobs.cancel('missing')).toBe(false);
  });
});
