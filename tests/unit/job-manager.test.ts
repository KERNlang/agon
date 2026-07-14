import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../packages/cli/src/generated/signals/job-manager.js';

describe('JobManager', () => {
  let jm: JobManager;

  beforeEach(() => {
    jm = new JobManager();
  });

  it('creates a job with unique incrementing ID', () => {
    const j1 = jm.create('forge', 'Fix auth bug');
    const j2 = jm.create('tribunal', 'REST vs GraphQL');
    expect(j1.id).toBe('1');
    expect(j2.id).toBe('2');
  });

  it('creates job in running state', () => {
    const job = jm.create('forge', 'Test task');
    expect(job.state).toBe('running');
    expect(job.type).toBe('forge');
    expect(job.label).toBe('Test task');
    expect(job.startedAt).toBeTruthy();
  });

  it('completes a running job', () => {
    const job = jm.create('forge', 'Test');
    jm.complete(job.id);
    expect(jm.get(job.id)?.state).toBe('done');
  });

  it('fails a running job with error', () => {
    const job = jm.create('forge', 'Test');
    jm.fail(job.id, 'Engine crashed');
    const updated = jm.get(job.id);
    expect(updated?.state).toBe('failed');
    expect(updated?.error).toBe('Engine crashed');
  });

  it('cancels a running job', () => {
    const job = jm.create('forge', 'Test');
    jm.cancel(job.id);
    expect(jm.get(job.id)?.state).toBe('cancelled');
  });

  it('does not change state of completed job', () => {
    const job = jm.create('forge', 'Test');
    jm.complete(job.id);
    jm.fail(job.id, 'Should not change');
    expect(jm.get(job.id)?.state).toBe('done');
  });

  it('lists all jobs', () => {
    jm.create('forge', 'Job 1');
    jm.create('tribunal', 'Job 2');
    jm.create('brainstorm', 'Job 3');
    expect(jm.list()).toHaveLength(3);
  });

  it('filters running jobs', () => {
    const j1 = jm.create('forge', 'Running');
    const j2 = jm.create('tribunal', 'Also running');
    jm.complete(j1.id);
    expect(jm.running()).toHaveLength(1);
    expect(jm.running()[0].id).toBe(j2.id);
  });

  it('returns undefined for non-existent job', () => {
    expect(jm.get('999')).toBeUndefined();
  });

  it('handles multiple concurrent jobs', () => {
    const jobs = Array.from({ length: 5 }, (_, i) => jm.create('forge', `Job ${i}`));
    expect(jm.running()).toHaveLength(5);
    jm.complete(jobs[0].id);
    jm.complete(jobs[2].id);
    jm.fail(jobs[4].id, 'error');
    expect(jm.running()).toHaveLength(2);
    expect(jm.list()).toHaveLength(5);
  });

  it('runs work through JobService and reports terminal success', async () => {
    const job = jm.run('agent', 'Autonomous task', async () => {});
    expect(job.state).toBe('running');
    expect((await jm.wait(job.id))?.state).toBe('done');
  });

  it('returns the terminal job even when core retention prunes it immediately', async () => {
    const tiny = new JobManager({ retentionLimit: 1 });
    const first = tiny.run('one', 'first', async () => {});
    await tiny.wait(first.id);
    const second = tiny.run('two', 'second', async () => {});
    await tiny.wait(second.id);
    const third = tiny.run('three', 'third', async () => {});

    expect(await tiny.wait(third.id)).toMatchObject({ id: third.id, state: 'done' });
    expect(tiny.list()).toHaveLength(1);
  });

  it('forwards cancellation to a running executor AbortSignal', async () => {
    let release!: () => void;
    const aborted = vi.fn();
    const job = jm.run('agent', 'Cancel task', async (signal) => {
      signal.addEventListener('abort', aborted, { once: true });
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(jm.cancel(job.id, 'stop')).toBe(true);
    expect(jm.get(job.id)?.state).toBe('cancelled');
    expect(aborted).toHaveBeenCalledTimes(1);
    release();
  });
});
