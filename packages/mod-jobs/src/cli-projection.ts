import type { Json, CommandContribution } from '@kernlang/agon-mod-api';
export type JobCliArgument = { required?: boolean; description: string; alias?: string } & (
  | { type: 'string' | 'positional'; default?: string }
  | { type: 'boolean'; default?: boolean }
);
export const connectionArgs: Record<string, JobCliArgument> = ({
  pollMs: { type: 'string', description: 'Polling interval in milliseconds', default: '500' },
  connectTimeoutMs: { type: 'string', description: 'Daemon startup timeout in milliseconds', default: '5000' },
  requestTimeoutMs: { type: 'string', description: 'Socket request timeout in milliseconds', default: '2000' },
});
export const waitArgs: Record<string, JobCliArgument> = ({
  waitTimeoutMs: { type: 'string', description: 'Overall wait/follow timeout; 0 means no deadline', default: '0' },
  json: { type: 'boolean', description: 'Print machine-readable JSON', default: false },
});
export const jobCliCommands = {
  submit: {
    meta: { name: 'submit', description: 'Submit a safe registered workflow to the daemon' },
    args: {
      kind: { type: 'positional', required: true, description: 'Registered workflow kind (for example brainstorm, forge, review)' },
      input: { type: 'positional', required: false, description: 'Prompt, task, topic, or review target' },
      payload: { type: 'string', description: 'Additional structured workflow options as a JSON object' },
      cwd: { type: 'string', description: 'Working directory' },
      engines: { type: 'string', alias: 'e', description: 'Comma-separated engine roster' },
      timeout: { type: 'string', description: 'Per-engine timeout in seconds' },
      wait: { type: 'boolean', description: 'Wait for the terminal result', default: false },
      ...waitArgs, ...connectionArgs,
    }
  },
  list: {
    meta: { name: 'list', description: 'List retained daemon jobs' },
    args: { json: waitArgs.json, ...connectionArgs }
  },
  status: {
    meta: { name: 'status', description: 'Show one job snapshot' },
    args: { jobId: { type: 'positional', required: true, description: 'Job ID' }, json: waitArgs.json, ...connectionArgs }
  },
  events: {
    meta: { name: 'events', description: 'Replay job events and optionally follow until terminal' },
    args: {
      jobId: { type: 'positional', required: true, description: 'Job ID' },
      after: { type: 'string', description: 'Replay events after this sequence', default: '0' },
      limit: { type: 'string', description: 'Maximum events per request', default: '100' },
      follow: { type: 'boolean', alias: 'f', description: 'Poll until the job is terminal', default: false },
      ...waitArgs, ...connectionArgs,
    }
  },
  result: {
    meta: { name: 'result', description: 'Read or wait for a job result' },
    args: {
      jobId: { type: 'positional', required: true, description: 'Job ID' },
      wait: { type: 'boolean', alias: 'w', description: 'Poll until the result is ready', default: false },
      ...waitArgs, ...connectionArgs,
    }
  },
  cancel: {
    meta: { name: 'cancel', description: 'Request idempotent cancellation of a job' },
    args: {
      jobId: { type: 'positional', required: true, description: 'Job ID' },
      reason: { type: 'string', description: 'Cancellation reason' },
      json: waitArgs.json, ...connectionArgs,
    }
  }
} satisfies Record<string, { meta: { name: string; description: string }; args: Record<string, JobCliArgument> }>;
export type JobCliAction = keyof typeof jobCliCommands;
export const daemonCliCommand = {
  meta: {
    name: 'daemon',
    description: 'Run a long-lived agon session host (agond) you can attach to (client/server split M3): start | stop | status',
  },
  args: {
    action: {
      type: 'positional',
      description: 'start | stop | status | run (run is the internal foreground loop the detached child uses)',
      required: false,
    },
    foreground: {
      type: 'boolean',
      description: 'Run the server loop in THIS process instead of detaching (used by `daemon run` internally; also for debugging)',
      default: false,
    },
  },
} satisfies { meta: { name: string; description: string }; args: Record<string, JobCliArgument> };

export function jobCliProjection(action: JobCliAction | 'parent' | 'daemon'): Pick<CommandContribution, 'description' | 'inputSchema' | 'cli'> {
  const definition = action === 'parent' ? { meta: { description: 'Submit, observe, and cancel daemon-owned autonomous jobs' }, args: {} }
    : action === 'daemon' ? daemonCliCommand : jobCliCommands[action];
  const args: Record<string, JobCliArgument> = definition.args;
  const properties: Record<string, Json> = {};
  const positionals: string[] = [];
  const aliases: Record<string, string> = {};
  const required: string[] = [];
  for (const [name, arg] of Object.entries(args)) {
    properties[name] = { type: arg.type === 'boolean' ? 'boolean' : 'string', description: arg.description, ...(arg.default === undefined ? {} : { default: arg.default }) };
    if (arg.type === 'positional') positionals.push(name);
    if (arg.alias) aliases[name] = arg.alias;
    if (arg.required) required.push(name);
  }
  return { description: definition.meta.description, inputSchema: { type: 'object', additionalProperties: false, properties, required }, cli: { positionals, aliases } };
}
