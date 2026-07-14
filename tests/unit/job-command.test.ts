import { beforeEach, describe, expect, it, vi } from 'vitest';

const daemonMocks = vi.hoisted(() => ({
  sendDaemonRequest: vi.fn(),
  startDaemon: vi.fn(),
}));

vi.mock('../../packages/cli/src/generated/commands/daemon.js', () => daemonMocks);

import {
  buildSubmitPayload,
  ensureJobDaemon,
  jobOutcomeExitCode,
  jobSnapshotExitCode,
  jobsCapability,
  parsePayload,
  timingFromArgs,
} from '../../packages/cli/src/generated/commands/job.js';

describe('job command client contract', () => {
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
