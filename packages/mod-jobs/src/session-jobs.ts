import type { CommandResult, InvocationContext, Json } from '@kernlang/agon-mod-api';

export interface SessionJob {
  id: string;
  type: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  label: string;
  error?: string;
}

export type SessionJobEvent =
  | { type: 'info' | 'error' | 'success'; message: string }
  | { type: 'header'; title: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

export interface SessionJobsHost {
  readonly manager?: {
    list?(): SessionJob[];
    get?(id: string): SessionJob | undefined;
    cancel?(id: string, reason: string): boolean;
  };
  dispatch(event: SessionJobEvent): void;
}

export interface SessionJobsInvocationContext extends InvocationContext {
  readonly sessionJobs?: SessionJobsHost;
}

/** Use the session's existing jobs. This action does not create another job. */
export function runSessionJobAction(action: 'list' | 'focus' | 'cancel', jobId: string | undefined, host: SessionJobsHost): void {
  if (action === 'cancel') {
    if (!jobId) {
      host.dispatch({ type: 'info', message: 'Usage: /jobs cancel <job-id>' });
      return;
    }
    const cancelled = host.manager?.cancel?.(jobId, 'Cancelled by user') ?? false;
    if (!cancelled) {
      const existing = host.manager?.get?.(jobId);
      host.dispatch({ type: existing ? 'info' : 'error', message: existing ? `Job ${jobId} is already ${existing.state}.` : `Job not found: ${jobId}` });
    } else {
      host.dispatch({ type: 'success', message: `Cancelled job ${jobId}.` });
    }
    return;
  }
  if (action === 'focus') {
    if (!jobId) { host.dispatch({ type: 'info', message: 'Usage: /focus <job-id>' }); return; }
    const job = host.manager?.get?.(jobId);
    if (!job) { host.dispatch({ type: 'error', message: `Job not found: ${jobId}` }); return; }
    host.dispatch({ type: 'info', message: `Job ${job.id}: ${job.type} — ${job.state} — ${job.label}` });
    if (job.error && job.state === 'failed') host.dispatch({ type: 'error', message: job.error });
    return;
  }
  const allJobs = host.manager?.list?.() ?? [];
  if (allJobs.length === 0) {
    host.dispatch({ type: 'info', message: 'No jobs.' });
  } else {
    host.dispatch({ type: 'header', title: 'Jobs' });
    const rows = allJobs.map(job => [job.id, job.type, job.state, job.label.slice(0, 40), job.startedAt.slice(11, 19)]);
    host.dispatch({ type: 'table', headers: ['ID', 'Type', 'State', 'Label', 'Started'], rows });
  }
}

export function runSessionJobContribution(action: 'list' | 'focus', input: Json, context: SessionJobsInvocationContext): CommandResult {
  context.signal.throwIfAborted();
  if (!context.sessionJobs) return { exitCode: 2, stderr: 'No interactive Jobs session is available.\n' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Job input must be an object');
  const jobId = typeof input.jobId === 'string' ? input.jobId : undefined;
  runSessionJobAction(action === 'list' && input.action === 'cancel' ? 'cancel' : action, jobId, context.sessionJobs);
  return { exitCode: 0 };
}
