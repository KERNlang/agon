import type { JobEvent, JobOutcome, JobSnapshot } from './job-service.js';

export type DaemonJobRequest =
  | { type: 'job-submit'; kind: string; payload: Record<string,unknown>; clientId?: string }
  | { type: 'job-list' }
  | { type: 'job-get'; jobId: string }
  | { type: 'job-events'; jobId: string; afterSeq?: number; limit?: number }
  | { type: 'job-result'; jobId: string }
  | { type: 'job-cancel'; jobId: string; reason?: string };

export type DaemonJobResponse =
  | { type: 'job-accepted'; job: JobSnapshot }
  | { type: 'job-list'; jobs: JobSnapshot[] }
  | { type: 'job-snapshot'; job: JobSnapshot }
  | { type: 'job-events'; jobId: string; events: JobEvent[]; nextSeq: number; earliestSeq: number; terminal: boolean; truncated: boolean }
  | { type: 'job-result'; job: JobSnapshot; ready: boolean; outcome?: JobOutcome }
  | { type: 'job-cancelled'; job: JobSnapshot; status: 'accepted'|'already-cancelled'|'already-terminal' }
  | { type: 'job-not-found'; jobId: string };
