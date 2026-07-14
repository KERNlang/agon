// Re-export from KERN-generated job command (source: kern/commands/job.kern)
export {
  jobCommand,
  buildSubmitPayload,
  ensureJobDaemon,
  followEvents,
  jobOutcomeExitCode,
  jobSnapshotExitCode,
  jobsCapability,
  parsePayload,
  pollResult,
  timingFromArgs,
} from '../generated/commands/job.js';
export type { JobClientConnection, JobClientTiming } from '../generated/commands/job.js';
