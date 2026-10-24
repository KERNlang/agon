import { defineCommand } from 'citty';
import type { ArgsDef } from 'citty';
import { createJobCliClient, jobCliCommands } from '@kernlang/agon-mod-jobs';
import { positiveJobCliInteger, nonNegativeInteger, parsePayload, buildSubmitPayload, jobsCapability, jobOutcomeExitCode, jobSnapshotExitCode, timingFromArgs } from '@kernlang/agon-mod-jobs';
import type { JobClientTiming, JobClientConnection } from '@kernlang/agon-mod-jobs';
export { positiveJobCliInteger, nonNegativeInteger, parsePayload, buildSubmitPayload, jobsCapability, jobOutcomeExitCode, jobSnapshotExitCode, timingFromArgs };
export type { JobClientTiming, JobClientConnection };


import { createCliJobHost } from '../jobs/cli-host.js';
const client = createJobCliClient(createCliJobHost());
export const { delay, ensureJobDaemon, printJson, printSnapshot, printEvent, failClient, requestOrFail, connectFromArgs, printOutcome, pollResult, followEvents } = client;

export { connectionArgs, waitArgs } from '@kernlang/agon-mod-jobs';
export const jobCommand = defineCommand({
  meta: { name: 'job', description: 'Submit, observe, and cancel daemon-owned autonomous jobs' },
  subCommands: Object.fromEntries(Object.entries(jobCliCommands).map(([action, definition]) => [action, defineCommand<ArgsDef>({
    ...definition,
    async run({ args }) { await client.commands[action as keyof typeof client.commands](args); },
  })])),
});
