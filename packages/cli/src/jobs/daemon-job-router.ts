import { JobService } from '@kernlang/agon-core';

import type { DaemonRequest, DaemonResponse, JobExecutor, JobTaskContext } from '@kernlang/agon-core';

export interface ResolvedJob {
  label: string;
  executor: JobExecutor;
}

export interface DaemonJobResolver {
  resolve: (kind:string,payload:Record<string,unknown>)=>ResolvedJob;
}

export function isDaemonJobRequest(request: DaemonRequest): boolean {
  return request.type === 'job-submit' || request.type === 'job-list' || request.type === 'job-get'
    || request.type === 'job-events' || request.type === 'job-result' || request.type === 'job-cancel';
}

export function handleDaemonJobRequest(request: DaemonRequest, jobs: JobService, resolver: DaemonJobResolver): DaemonResponse|null {
  switch (request.type) {
    case 'job-submit': {
      const resolved = resolver.resolve(request.kind, request.payload);
      const clientId = request.clientId;
      const executor: JobExecutor = {
        async run(ctx: JobTaskContext): Promise<unknown> {
          if (clientId) ctx.emit('submitted', { clientId });
          return await resolved.executor.run(ctx);
        },
      };
      const job = jobs.submit(request.kind, resolved.label, executor);
      return { type: 'job-accepted', job };
    }
    case 'job-list':
      return { type: 'job-list', jobs: jobs.list() };
    case 'job-get': {
      const job = jobs.get(request.jobId);
      return job ? { type: 'job-snapshot', job } : { type: 'job-not-found', jobId: request.jobId };
    }
    case 'job-events': {
      const page = jobs.events(request.jobId, request.afterSeq, request.limit);
      return page ? { type: 'job-events', ...page } : { type: 'job-not-found', jobId: request.jobId };
    }
    case 'job-result': {
      const job = jobs.get(request.jobId);
      if (!job) return { type: 'job-not-found', jobId: request.jobId };
      const outcome = jobs.result(request.jobId);
      return outcome
        ? { type: 'job-result', job, ready: true, outcome }
        : { type: 'job-result', job, ready: false };
    }
    case 'job-cancel': {
      const before = jobs.get(request.jobId);
      if (!before) return { type: 'job-not-found', jobId: request.jobId };
      if (before.state === 'cancelled') return { type: 'job-cancelled', job: before, status: 'already-cancelled' };
      if (before.state === 'succeeded' || before.state === 'failed') {
        return { type: 'job-cancelled', job: before, status: 'already-terminal' };
      }
      jobs.cancel(request.jobId, request.reason);
      const job = jobs.get(request.jobId) ?? before;
      return { type: 'job-cancelled', job, status: 'accepted' };
    }
    default:
      return null;
  }
}
