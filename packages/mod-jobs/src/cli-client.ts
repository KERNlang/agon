import { positiveJobCliInteger, nonNegativeInteger, buildSubmitPayload, jobsCapability, jobOutcomeExitCode, jobSnapshotExitCode, timingFromArgs } from './cli-contract.js';
import type { JobClientTiming, JobClientConnection } from './cli-contract.js';
import type { DaemonJobRequest, DaemonJobResponse } from './daemon-contract.js';
import type { JobEvent, JobOutcome, JobSnapshot } from './job-service.js';

export type JobCliRequest = DaemonJobRequest | { type: 'ping' };
export type JobCliResponse = DaemonJobResponse
  | { type: 'pong'; capabilities?: string[] }
  | { type: 'error'; message: string }
  | { type: 'ack' | 'busy' | 'bye' };

export interface JobCliHost {
  sendRequest(request: JobCliRequest, timeoutMs: number): Promise<JobCliResponse | null>;
  startDaemon(quiet: boolean, assertInvocation?: () => void): Promise<void>;
  log(text: string): void;
  error(text: string): void;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  setExitCode(code: number): void;
}

export function createJobCliClient(host: JobCliHost) {

  async function delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Probe first. Start only when no daemon answers; never replace or stop a live daemon that lacks jobs-v1.
   */
  async function ensureJobDaemon(timing: JobClientTiming, quiet?: boolean): Promise<JobClientConnection> {
    const initial = await host.sendRequest({ type: 'ping' }, timing.requestTimeoutMs);
    if (initial?.type === 'pong') {
      return jobsCapability(initial)
        ? { ok: true }
        : { ok: false, message: 'The live daemon is older and does not advertise jobs-v1. Stop it with `agon daemon stop`, then retry.' };
    }
    if (initial !== null) {
      return { ok: false, message: `Daemon capability probe failed: ${initial.type === 'error' ? initial.message : initial.type}` };
    }

    await host.startDaemon(!!quiet);
    const deadline = Date.now() + timing.connectTimeoutMs;
    while (Date.now() <= deadline) {
      const response = await host.sendRequest({ type: 'ping' }, timing.requestTimeoutMs);
      if (response?.type === 'pong') {
        return jobsCapability(response)
          ? { ok: true }
          : { ok: false, message: 'The daemon started without jobs-v1 support. Rebuild/update Agon and restart the daemon.' };
      }
      await delay(Math.min(timing.pollMs, Math.max(1, deadline - Date.now())));
    }
    return { ok: false, message: `Daemon did not become ready within ${timing.connectTimeoutMs}ms.` };
  }

  function printJson(value: unknown): void {
    host.log(JSON.stringify(value, null, 2));
  }

  function printSnapshot(job: JobSnapshot, json: boolean): void {
    if (json) { printJson(job); return; }
    const detail = job.error ? ` · ${job.error}` : '';
    host.log(`${job.id}  ${job.state.padEnd(9)}  ${job.kind}  ${job.label}${detail}`);
  }

  function printEvent(event: JobEvent, json: boolean): void {
    if (json) { host.log(JSON.stringify(event)); return; }
    const eventText = typeof event.data === 'string'
      ? event.data
      : event.data && typeof event.data === 'object' && typeof (event.data as { text?: unknown }).text === 'string'
        ? (event.data as { text: string }).text
        : null;
    if ((event.type === 'stdout' || event.type === 'stderr') && eventText !== null) {
      const stream = event.type === 'stderr' ? host.stderr : host.stdout;
      stream.write(eventText);
      return;
    }
    const data = event.data === undefined ? '' : ` ${typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}`;
    host.log(`[${event.seq}] ${event.type}${data}`);
  }

  function failClient(message: string, code?: number): void {
    host.error(message);
    host.setExitCode(code ?? 2);
  }

  async function requestOrFail(request: JobCliRequest, timing: JobClientTiming): Promise<JobCliResponse | null> {
    const response = await host.sendRequest(request, timing.requestTimeoutMs);
    if (!response) failClient('The daemon stopped responding. Check `agon daemon status`.');
    else if (response.type === 'error') failClient(response.message);
    return response;
  }

  async function connectFromArgs(args: Record<string, unknown>): Promise<JobClientTiming | null> {
    let timing: JobClientTiming;
    try { timing = timingFromArgs(args); }
    catch (error) { failClient(error instanceof Error ? error.message : String(error)); return null; }
    const connected = await ensureJobDaemon(timing, !!args.json);
    if (!connected.ok) { failClient(connected.message ?? 'Could not connect to the jobs daemon.'); return null; }
    return timing;
  }

  function printOutcome(job: JobSnapshot, outcome: JobOutcome, json: boolean, jsonLines?: boolean): void {
    if (json) {
      if (jsonLines) host.log(JSON.stringify({ type: 'job-result', job, outcome }));
      else printJson({ job, outcome });
    }
    else if (outcome.state === 'succeeded') {
      if (outcome.value !== undefined) {
        host.log(typeof outcome.value === 'string' ? outcome.value : JSON.stringify(outcome.value, null, 2));
      } else printSnapshot(job, false);
    } else {
      host.error(outcome.error || job.error || `Job ${outcome.state}`);
    }
    const code = jobOutcomeExitCode(outcome);
    if (code !== 0) host.setExitCode(code);
  }

  async function pollResult(jobId: string, timing: JobClientTiming, wait: boolean, timeoutMs: number, json: boolean, jsonLines?: boolean): Promise<void> {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    while (true) {
      const response = await requestOrFail({ type: 'job-result', jobId }, timing);
      if (!response || response.type === 'error') return;
      if (response.type === 'job-not-found') { failClient(`Job not found: ${jobId}`); return; }
      if (response.type !== 'job-result') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      if (response.ready && !response.outcome) { failClient('Daemon returned a ready job without a terminal outcome.'); return; }
      if (response.ready && response.outcome) { printOutcome(response.job, response.outcome, json, jsonLines); return; }
      if (!wait) { printSnapshot(response.job, json); return; }
      if (Date.now() >= deadline) { failClient(`Timed out waiting for job ${jobId}.`); return; }
      await delay(Math.min(timing.pollMs, Math.max(1, deadline - Date.now())));
    }
  }

  async function followEvents(jobId: string, timing: JobClientTiming, afterSeq: number, limit: number, follow: boolean, timeoutMs: number, json: boolean): Promise<void> {
    let cursor = afterSeq;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    while (true) {
      const response = await requestOrFail({ type: 'job-events', jobId, afterSeq: cursor, limit }, timing);
      if (!response || response.type === 'error') return;
      if (response.type === 'job-not-found') { failClient(`Job not found: ${jobId}`); return; }
      if (response.type !== 'job-events') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      if (response.truncated && cursor < response.earliestSeq - 1) {
        host.error(`Event history was truncated; resuming at sequence ${response.earliestSeq}.`);
      }
      for (const event of response.events) printEvent(event, json);
      cursor = Math.max(cursor, response.nextSeq);
      if (!follow) return;
      if (response.terminal) { await pollResult(jobId, timing, false, 0, json, json); return; }
      if (Date.now() >= deadline) { failClient(`Timed out following job ${jobId}.`); return; }
      await delay(Math.min(timing.pollMs, Math.max(1, deadline - Date.now())));
    }
  }
  const commands = {
    submit: async (args: Record<string, unknown>): Promise<void> => {
      let timeoutMs = 0;
      try { timeoutMs = nonNegativeInteger(args.waitTimeoutMs, '--wait-timeout-ms'); }
      catch (error) { failClient(error instanceof Error ? error.message : String(error)); return; }
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      let payload: Record<string, unknown>;
      try { payload = buildSubmitPayload(args as Record<string, unknown>); }
      catch (error) { failClient(error instanceof Error ? error.message : String(error)); return; }
      const response = await requestOrFail({ type: 'job-submit', kind: String(args.kind), payload, clientId: 'agon-cli' }, timing);
      if (!response || response.type === 'error') return;
      if (response.type !== 'job-accepted') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      if (!args.wait || !args.json) printSnapshot(response.job, !!args.json);
      if (args.wait) {
        await pollResult(response.job.id, timing, true, timeoutMs, !!args.json);
      }
    },
    list: async (args: Record<string, unknown>): Promise<void> => {
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      const response = await requestOrFail({ type: 'job-list' }, timing);
      if (!response || response.type === 'error') return;
      if (response.type !== 'job-list') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      if (args.json) printJson(response.jobs);
      else if (response.jobs.length === 0) host.log('No retained jobs.');
      else for (const job of response.jobs) printSnapshot(job, false);
    },
    status: async (args: Record<string, unknown>): Promise<void> => {
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      const response = await requestOrFail({ type: 'job-get', jobId: String(args.jobId) }, timing);
      if (!response || response.type === 'error') return;
      if (response.type === 'job-not-found') { failClient(`Job not found: ${args.jobId}`); return; }
      if (response.type !== 'job-snapshot') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      printSnapshot(response.job, !!args.json);
      const code = jobSnapshotExitCode(response.job); if (code !== 0) host.setExitCode(code);
    },
    events: async (args: Record<string, unknown>): Promise<void> => {
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      try {
        await followEvents(String(args.jobId), timing, nonNegativeInteger(args.after, '--after'), positiveJobCliInteger(args.limit, '--limit'), !!args.follow, nonNegativeInteger(args.waitTimeoutMs, '--wait-timeout-ms'), !!args.json);
      } catch (error) { failClient(error instanceof Error ? error.message : String(error)); }
    },
    result: async (args: Record<string, unknown>): Promise<void> => {
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      try { await pollResult(String(args.jobId), timing, !!args.wait, nonNegativeInteger(args.waitTimeoutMs, '--wait-timeout-ms'), !!args.json); }
      catch (error) { failClient(error instanceof Error ? error.message : String(error)); }
    },
    cancel: async (args: Record<string, unknown>): Promise<void> => {
      const timing = await connectFromArgs(args as Record<string, unknown>); if (!timing) return;
      const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : undefined;
      const request: JobCliRequest = { type: 'job-cancel', jobId: String(args.jobId) };
      if (reason) request.reason = reason;
      const response = await requestOrFail(request, timing);
      if (!response || response.type === 'error') return;
      if (response.type === 'job-not-found') { failClient(`Job not found: ${args.jobId}`); return; }
      if (response.type !== 'job-cancelled') { failClient(`Unexpected daemon response: ${response.type}`); return; }
      if (args.json) printJson(response); else { host.log(`${response.status}: ${response.job.id}`); printSnapshot(response.job, false); }
    }
  };
  return { delay, ensureJobDaemon, printJson, printSnapshot, printEvent, failClient, requestOrFail, connectFromArgs, printOutcome, pollResult, followEvents, commands };
}
