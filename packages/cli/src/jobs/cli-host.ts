import type { JobCliHost } from '@kernlang/agon-mod-jobs';
import { sendDaemonRequest, startDaemon } from '../commands/daemon.js';

export function createCliJobHost(assertAvailable: () => void = () => {}): JobCliHost {
  return {
    async sendRequest(request, timeoutMs) {
      assertAvailable();
      const reply = await sendDaemonRequest(request, timeoutMs);
      assertAvailable();
      return reply;
    },
    async startDaemon(quiet, assertInvocation) {
      const check = assertInvocation ? () => { assertAvailable(); assertInvocation(); } : assertAvailable;
      check();
      await startDaemon(false, { quiet, assertAvailable: check });
      check();
    },
    log: text => { assertAvailable(); console.log(text); },
    error: text => { assertAvailable(); console.error(text); },
    stdout: { write: text => { assertAvailable(); return process.stdout.write(text); } },
    stderr: { write: text => { assertAvailable(); return process.stderr.write(text); } },
    setExitCode: code => { assertAvailable(); process.exitCode = code; },
  };
}
