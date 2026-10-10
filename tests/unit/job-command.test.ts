import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import * as jobsContract from '@kernlang/agon-mod-jobs';
import { createCliJobHost } from '../../packages/cli/src/jobs/cli-host.js';
import { emitChunks } from '@kernlang/agon-mod-jobs';

const daemonMocks = vi.hoisted(() => ({
  sendDaemonRequest: vi.fn(),
  startDaemon: vi.fn(),
}));

vi.mock('../../packages/cli/src/commands/daemon.js', () => daemonMocks);

import {
  buildSubmitPayload,
  ensureJobDaemon,
  jobOutcomeExitCode,
  jobSnapshotExitCode,
  jobsCapability,
  parsePayload,
  timingFromArgs,
  printEvent,
  positiveJobCliInteger,
  nonNegativeInteger,
} from '../../packages/cli/src/commands/job.js';

describe('job command client contract', () => {
  it('uses the physical Jobs owner through the compatibility exports', () => {
    expect(positiveJobCliInteger).toBe(jobsContract.positiveJobCliInteger);
    expect(nonNegativeInteger).toBe(jobsContract.nonNegativeInteger);
    expect(buildSubmitPayload).toBe(jobsContract.buildSubmitPayload);
    expect(parsePayload).toBe(jobsContract.parsePayload);
    expect(timingFromArgs).toBe(jobsContract.timingFromArgs);
    expect(jobsCapability).toBe(jobsContract.jobsCapability);
    expect(jobOutcomeExitCode).toBe(jobsContract.jobOutcomeExitCode);
    expect(jobSnapshotExitCode).toBe(jobsContract.jobSnapshotExitCode);
  });
  it.each([1, 2, 3, 4])('preserves Unicode when chunk limit %s reaches the real event printer', limit => {
    const bytes: Buffer[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      bytes.push(Buffer.from(chunk));
      return true;
    });
    const text = 'a🦒é🦒z';
    try {
      emitChunks({ signal: new AbortController().signal, emit: (type, data) => {
        printEvent({ seq: 1, type, data, ts: Date.now() }, false);
      } }, 'stdout', text, limit);
    } finally { write.mockRestore(); }
    expect(Buffer.concat(bytes).toString('utf8')).toBe(text);
  });

  beforeEach(() => {
    daemonMocks.sendDaemonRequest.mockReset();
    daemonMocks.startDaemon.mockReset();
    daemonMocks.startDaemon.mockResolvedValue(undefined);
  });

  it('builds only structured workflow payload fields', () => {
    expect(buildSubmitPayload({
      input: ' design a cache ',
      cwd: '/tmp/project',
      engines: 'claude,codex',
      timeout: '30',
      payload: '{"rounds":"2"}',
    })).toEqual({
      rounds: '2',
      input: 'design a cache',
      cwd: '/tmp/project',
      engines: 'claude,codex',
      engineTimeout: '30',
    });
  });

  it('rejects malformed and non-object payload JSON', () => {
    expect(() => parsePayload('{')).toThrow(/valid JSON/);
    expect(() => parsePayload('[]')).toThrow(/JSON object/);
  });

  it('binds an omitted working directory to the submitting client', () => {
    expect(buildSubmitPayload({ payload: '{"input":"review changes"}' }).cwd).toBe(process.cwd());
  });

  it('resolves relative directories before sending them to another process', () => {
    expect(buildSubmitPayload({ payload: '{"cwd":"subproject"}' }).cwd).toBe(resolve('subproject'));
    expect(buildSubmitPayload({ cwd: '.', payload: '{"cwd":"other"}' }).cwd).toBe(process.cwd());
  });

  it('preserves invalid directory types for daemon validation', () => {
    expect(buildSubmitPayload({ payload: '{"cwd":42}' }).cwd).toBe(42);
  });

  it('requires the explicit jobs-v1 daemon capability', () => {
    expect(jobsCapability({ type: 'pong', sessionId: 's', uptime: 1, capabilities: ['jobs-v1'] })).toBe(true);
    expect(jobsCapability({ type: 'pong', sessionId: 's', uptime: 1 })).toBe(false);
    expect(jobsCapability(null)).toBe(false);
  });

  it('uses a compatible live daemon without starting another process', async () => {
    daemonMocks.sendDaemonRequest.mockResolvedValue({
      type: 'pong', sessionId: 's', uptime: 1, capabilities: ['jobs-v1'],
    });
    await expect(ensureJobDaemon({ pollMs: 1, connectTimeoutMs: 10, requestTimeoutMs: 10 }))
      .resolves.toEqual({ ok: true });
    expect(daemonMocks.startDaemon).not.toHaveBeenCalled();
  });

  it('refuses a live old daemon instead of replacing it', async () => {
    daemonMocks.sendDaemonRequest.mockResolvedValue({ type: 'pong', sessionId: 'old', uptime: 1 });
    const result = await ensureJobDaemon({ pollMs: 1, connectTimeoutMs: 10, requestTimeoutMs: 10 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/older.*jobs-v1/i);
    expect(daemonMocks.startDaemon).not.toHaveBeenCalled();
  });

  it('starts an absent daemon and waits for jobs-v1 readiness', async () => {
    daemonMocks.sendDaemonRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ type: 'pong', sessionId: 'new', uptime: 1, capabilities: ['jobs-v1'] });
    await expect(ensureJobDaemon({ pollMs: 1, connectTimeoutMs: 20, requestTimeoutMs: 10 }, true))
      .resolves.toEqual({ ok: true });
    expect(daemonMocks.startDaemon).toHaveBeenCalledOnce();
  });

  it('restores console output if quiet startup throws', async () => {
    const originalLog = console.log;
    daemonMocks.sendDaemonRequest.mockResolvedValue(null);
    daemonMocks.startDaemon.mockRejectedValue(new Error('startup failed'));
    await expect(ensureJobDaemon({ pollMs: 1, connectTimeoutMs: 10, requestTimeoutMs: 10 }, true)).rejects.toThrow('startup failed');
    expect(console.log).toBe(originalLog);
  });

  it('does not replace the global logger during overlapping quiet starts', async () => {
    const originalLog = console.log;
    const releases: Array<() => void> = [];
    daemonMocks.startDaemon.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const host = createCliJobHost();
    const first = host.startDaemon(true);
    const second = host.startDaemon(true);
    expect(console.log).toBe(originalLog);
    expect(daemonMocks.startDaemon).toHaveBeenNthCalledWith(1, false, { quiet: true, assertAvailable: expect.any(Function) });
    releases[0](); await first;
    expect(console.log).toBe(originalLog);
    releases[1](); await second;
    expect(console.log).toBe(originalLog);
  });

  it('forwards the invocation authority into daemon startup, not only around it', async () => {
    const check = vi.fn();
    await createCliJobHost(check).startDaemon(true);
    expect(daemonMocks.startDaemon).toHaveBeenCalledWith(false, { quiet: true, assertAvailable: check });
  });

  it('combines host authority and mod invocation guards inside startup', async () => {
    const hostCheck = vi.fn();
    const invocationCheck = vi.fn();
    daemonMocks.startDaemon.mockImplementation(async (_foreground, options) => {
      hostCheck.mockClear(); invocationCheck.mockClear();
      options.assertAvailable();
      expect(hostCheck).toHaveBeenCalledOnce();
      expect(invocationCheck).toHaveBeenCalledOnce();
    });
    await createCliJobHost(hostCheck).startDaemon(true, invocationCheck);
  });

  it('maps failed and cancelled terminal states to truthful nonzero exits', () => {
    expect(jobOutcomeExitCode({ state: 'succeeded' })).toBe(0);
    expect(jobOutcomeExitCode({ state: 'failed', error: 'boom' })).toBe(1);
    expect(jobOutcomeExitCode({ state: 'cancelled', error: 'stop' })).toBe(130);
    const base = { id: 'j', kind: 'review', label: 'review', createdAt: 'now' };
    expect(jobSnapshotExitCode({ ...base, state: 'failed' })).toBe(1);
    expect(jobSnapshotExitCode({ ...base, state: 'cancelled' })).toBe(130);
  });

  it('validates every client timing knob', () => {
    expect(timingFromArgs({ pollMs: '10', connectTimeoutMs: '20', requestTimeoutMs: '30' }))
      .toEqual({ pollMs: 10, connectTimeoutMs: 20, requestTimeoutMs: 30 });
    expect(() => timingFromArgs({ pollMs: '0' })).toThrow(/positive integer/);
  });
});
