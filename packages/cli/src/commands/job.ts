// Facade over ../generated/commands/job.js — edit the source there.
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
