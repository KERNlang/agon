import type { CommandResult, InvocationContext, Json } from '@kernlang/agon-mod-api';
import { createJobCliClient } from './cli-client.js';
import type { JobCliHost } from './cli-client.js';
import type { JobCliAction } from './cli-projection.js';
import { createDaemonController } from './daemon-controller.js';
import type { DaemonControllerHost } from './daemon-controller.js';

export interface JobCliInvocationContext extends InvocationContext { jobCli?: JobCliHost; daemonCli?: DaemonControllerHost }

export async function runJobCliContribution(action: JobCliAction | 'parent' | 'daemon', input: Json, context: JobCliInvocationContext, assertActive: () => void): Promise<CommandResult> {
  const check = () => { assertActive(); context.signal.throwIfAborted(); };
  check();
  if (action === 'parent') return { exitCode: 0 };
  if (action === 'daemon') {
    const host = context.daemonCli;
    if (!host) return { exitCode: 2, stderr: 'Daemon lifecycle requires its dedicated host.\n' };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { exitCode: 2, stderr: 'Daemon input must be an object.\n' };
    const controller = createDaemonController({
      ...host,
      assertAvailable() { check(); host.assertAvailable?.(); },
      runServer: () => host.runServer(context.signal),
    });
    await controller.runCommand({ action: typeof input.action === 'string' ? input.action : undefined, foreground: input.foreground === true });
    check();
    return { exitCode: 0 };
  }
  const host = context.jobCli;
  if (!host) return { exitCode: 2, stderr: 'Jobs CLI transport is unavailable in this host.\n' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { exitCode: 2, stderr: 'Job input must be an object.\n' };
  let exitCode = 0;
  const client = createJobCliClient({
    ...host,
    async sendRequest(request, timeout) { check(); const reply = await host.sendRequest(request, timeout); check(); return reply; },
    async startDaemon(quiet) { check(); await host.startDaemon(quiet, check); check(); },
    log(text) { check(); host.log(text); },
    error(text) { check(); host.error(text); },
    stdout: { write(text) { check(); return host.stdout.write(text); } },
    stderr: { write(text) { check(); return host.stderr.write(text); } },
    setExitCode(code) { check(); exitCode = code; },
  });
  await client.commands[action](input);
  check();
  return { exitCode };
}
