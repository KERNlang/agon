import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobService, type JobTaskContext } from '@kernlang/agon-mod-jobs';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import * as authority from '../../packages/cli/src/surface-authority-runtime.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { replay } from '../../packages/core/src/sessions/event-log.js';

const effects = vi.hoisted(() => ({ execute: vi.fn(), dispatch: vi.fn() }));
vi.mock('@kernlang/agon-adapter-cli', () => ({ createCliAdapter: () => ({ dispatch: effects.dispatch }) }));
vi.mock('../../packages/cli/src/jobs/workflow-job.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../packages/cli/src/jobs/workflow-job.js')>();
  return {
    ...original,
    daemonJobConfig: (cwd: string) => ({ ...original.daemonJobConfig(cwd), jobMaxConcurrency: 1 }),
    resolveDaemonWorkflowJob: (kind: string) => ({ label: kind, executor: {
      run: (ctx: JobTaskContext) => effects.execute(kind, ctx),
    } }),
  };
});
import { runDaemonServer, socketPath, pidFilePath, stopDaemon } from '../../packages/cli/src/commands/daemon.js';

let root: string;
let running: Promise<void> | undefined;
let previous: Record<string, string | undefined>;
function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath(), () => socket.write(JSON.stringify(body) + '\n'));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('fixture request timeout')));
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('fixture socket closed before reply')));
    socket.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.destroy();
      try { resolve(JSON.parse(buffer.split('\n')[0])); } catch (error) { reject(error); }
    });
  });
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ajx-'));
  previous = Object.fromEntries(['AGON_HOME', 'AGON_MODULAR_HOST_ROOT', 'AGON_MOD_SAFE_MODE', 'AGON_DAEMON_ECHO'].map(key => [key, process.env[key]]));
  process.env.AGON_HOME = join(root, 'home');
  process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
  delete process.env.AGON_MOD_SAFE_MODE;
  delete process.env.AGON_DAEMON_ECHO;
  await initializeProcessSurfaceAuthority(join(root, 'host'));
  effects.execute.mockReset();
  effects.dispatch.mockReset();
  running = runDaemonServer();
  await vi.waitFor(() => expect(existsSync(socketPath())).toBe(true));
  expect(await request({ type: 'ping' })).toMatchObject({ type: 'pong' });
});

it.each(['disable', 'replace', 'unchanged', 'replace-after-guard', 'reject-on-abort'] as const)('guards a real socket prompt across %s', async change => {
  let release = () => {};
  const providerFinished = new Promise<void>(resolve => { release = resolve; });
  let providerSignal: AbortSignal | undefined;
  effects.dispatch.mockImplementation(async (options: { signal?: AbortSignal }) => {
    providerSignal = options.signal;
    await providerFinished;
    if (change === 'reject-on-abort') options.signal?.throwIfAborted();
    return { stdout: 'fixture provider answer', exitCode: 0, timedOut: false };
  });
  const pong = await request({ type: 'ping' });
  const originalGuard = authority.withProcessSurfaceAuthority;
  const guard = change === 'replace-after-guard' ? vi.spyOn(authority, 'withProcessSurfaceAuthority').mockImplementation(async (...args) => {
    const value = await originalGuard(...args);
    await disposeProcessSurfaceAuthority();
    await initializeProcessSurfaceAuthority(join(root, 'host'));
    return value;
  }) : undefined;
  const turn = request({ type: 'prompt', text: 'fixture prompt' }).catch(error => ({ failure: String(error) }));
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    if (change === 'disable' || change === 'reject-on-abort') {
      const catalog = createFirstPartyModCatalog();
      const full = createFullCompatDesiredState(catalog, '2026-10-10T10:00:00.000Z');
      const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.jobs' }, '2026-10-10T10:00:01.000Z').nextState;
      const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0', processIdentity: 'daemon-prompt-test' });
      await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    } else if (change === 'replace') {
      await disposeProcessSurfaceAuthority();
      await initializeProcessSurfaceAuthority(join(root, 'host'));
    }
    if (change === 'disable' || change === 'replace' || change === 'reject-on-abort') await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true), { timeout: 500 });
    release();
    const ack = await turn;
    expect(ack).toMatchObject({ type: 'ack' });
    const events = replay(String(pong.sessionId), 0);
    expect(ack).toMatchObject({ seq: events.at(-1)?.seq });
    if (change === 'unchanged') expect(events.at(-1)?.event).toMatchObject({ type: 'engine-block', content: 'fixture provider answer' });
    else {
      expect(events.some(entry => (entry.event as { type?: string }).type === 'engine-block')).toBe(false);
      expect(events.at(-1)?.event).toMatchObject({ type: 'error', message: expect.stringMatching(/generation.*changed.*restart|disposed or replaced/i) });
    }
    expect(await request({ type: 'ping' })).toMatchObject({ type: 'pong' });
    if (change !== 'unchanged') {
      expect(await request({ type: 'prompt', text: 'must not dispatch again' })).toMatchObject({ type: 'error' });
      expect(effects.dispatch).toHaveBeenCalledOnce();
      expect(replay(String(pong.sessionId), 0)).toHaveLength(events.length);
    }
  } finally { release(); await turn; guard?.mockRestore(); }
});
it('cancels an active prompt on shutdown and waits for provider cleanup', async () => {
  let release = () => {};
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  let signal: AbortSignal | undefined;
  effects.dispatch.mockImplementation(async (options: { signal?: AbortSignal }) => {
    signal = options.signal;
    await cleanup;
    return { stdout: 'must not publish after shutdown', exitCode: 0, timedOut: false };
  });
  const pong = await request({ type: 'ping' });
  const turn = request({ type: 'prompt', text: 'active at shutdown' }).catch(error => ({ failure: String(error) }));
  let stopped = false;
  void running?.then(() => { stopped = true; });
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await request({ type: 'shutdown' })).toMatchObject({ type: 'bye' });
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    expect(stopped).toBe(false);
    expect(await request({ type: 'prompt', text: 'must refuse while draining' })).toMatchObject({ type: 'error' });
    expect(await request({ type: 'job-submit', kind: 'fixture', payload: {} })).toMatchObject({ type: 'error' });
    expect(effects.dispatch).toHaveBeenCalledOnce();
    expect(effects.execute).not.toHaveBeenCalled();
    release();
    await running;
    expect(stopped).toBe(true);
    expect(JSON.stringify(replay(String(pong.sessionId), 0))).not.toContain('must not publish after shutdown');
    expect(existsSync(socketPath())).toBe(false);
    running = runDaemonServer();
    await vi.waitFor(() => expect(existsSync(socketPath())).toBe(true));
    const restarted = await request({ type: 'ping' });
    expect(restarted.sessionId).not.toBe(pong.sessionId);
    expect(await request({ type: 'prompt', text: 'fresh daemon turn' })).toMatchObject({ type: 'ack' });
    expect(effects.dispatch).toHaveBeenCalledTimes(2);
    expect(signal?.aborted).toBe(false);
  } finally {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    release(); await turn;
  }
});

it('refuses work in the same socket chunk as shutdown while retaining control replies', async () => {
  const frames = [
    { type: 'shutdown' },
    { type: 'prompt', text: 'must not start' },
    { type: 'job-submit', kind: 'fixture', payload: {} },
    { type: 'ping' },
    { type: 'shutdown' },
  ];
  const replies = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const socket = connect(socketPath(), () => socket.write(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n'));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('fixture batch timeout')));
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('fixture batch closed before replies')));
    socket.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.trim().split('\n');
      if (!buffer.endsWith('\n') || lines.length < frames.length) return;
      socket.destroy();
      try { resolve(lines.map(line => JSON.parse(line))); } catch (error) { reject(error); }
    });
  });
  expect(replies.map(reply => reply.type)).toEqual(['bye', 'error', 'error', 'pong', 'bye']);
  expect(replies[1]).toMatchObject({ message: 'Daemon is shutting down' });
  expect(replies[2]).toMatchObject({ message: 'Daemon is shutting down' });
  expect(effects.dispatch).not.toHaveBeenCalled();
  expect(effects.execute).not.toHaveBeenCalled();
  await running;
  expect(existsSync(socketPath())).toBe(false);
});

it('drains a real foreground server on invocation cancellation and removes its signal handlers', async () => {
  await request({ type: 'shutdown' });
  await running;
  const termHandlers = process.listenerCount('SIGTERM');
  const intHandlers = process.listenerCount('SIGINT');
  const controller = new AbortController();
  let release = () => {};
  const drain = new Promise<void>(resolve => { release = resolve; });
  let providerSignal: AbortSignal | undefined;
  effects.dispatch.mockImplementation(async (options: { signal?: AbortSignal }) => {
    providerSignal = options.signal;
    await drain;
    return { stdout: 'must not survive invocation cancellation', exitCode: 0, timedOut: false };
  });
  running = runDaemonServer(controller.signal);
  await vi.waitFor(() => expect(existsSync(socketPath())).toBe(true));
  const pong = await request({ type: 'ping' });
  const turn = request({ type: 'prompt', text: 'held through cancellation' }).catch(error => ({ failure: String(error) }));
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    controller.abort(new Error('invocation cancelled'));
    expect(providerSignal?.aborted).toBe(true);
    expect(existsSync(pidFilePath())).toBe(true);
    expect(await request({ type: 'prompt', text: 'must refuse during drain' })).toMatchObject({ type: 'error' });
    release();
    await running;
    expect(existsSync(pidFilePath())).toBe(false);
    expect(existsSync(socketPath())).toBe(false);
    expect(process.listenerCount('SIGTERM')).toBe(termHandlers);
    expect(process.listenerCount('SIGINT')).toBe(intHandlers);
    expect(JSON.stringify(replay(String(pong.sessionId), 0))).not.toContain('must not survive invocation cancellation');
  } finally { release(); await turn; }
});

it.each(['SIGTERM', 'SIGINT'] as const)('drains an active prompt on %s without publishing its answer', async signalName => {
  let release = () => {};
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  let providerSignal: AbortSignal | undefined;
  effects.dispatch.mockImplementation(async (options: { signal?: AbortSignal }) => {
    providerSignal = options.signal;
    await cleanup;
    return { stdout: 'late signal answer', exitCode: 0, timedOut: false };
  });
  const pong = await request({ type: 'ping' });
  const turn = request({ type: 'prompt', text: 'hold through signal' }).catch(error => ({ failure: String(error) }));
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    // Invoke this process's handlers without sending a signal to the test runner.
    process.emit(signalName);
    expect(providerSignal?.aborted).toBe(true);
    expect(existsSync(pidFilePath())).toBe(true);
    expect(await request({ type: 'prompt', text: 'refused during signal drain' })).toMatchObject({ type: 'error' });
    release();
    await running;
    expect(existsSync(pidFilePath())).toBe(false);
    expect(JSON.stringify(replay(String(pong.sessionId), 0))).not.toContain('late signal answer');
    expect(effects.dispatch).toHaveBeenCalledOnce();
  } finally { release(); await turn; }
});

it('keeps ownership files when stop returns before a live prompt finishes draining', async () => {
  let release = () => {};
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  effects.dispatch.mockImplementation(async () => {
    await cleanup;
    return { stdout: 'late stop answer', exitCode: 0, timedOut: false };
  });
  const turn = request({ type: 'prompt', text: 'hold provider cleanup' }).catch(error => ({ failure: String(error) }));
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    await stopDaemon();
    expect(existsSync(pidFilePath())).toBe(true);
    expect(existsSync(socketPath())).toBe(true);
  } finally { release(); await running; await turn; }
});

it('reports a prompt drain deadline without publishing the late provider answer', async () => {
  let release = () => {};
  const providerFinished = new Promise<void>(resolve => { release = resolve; });
  effects.dispatch.mockImplementation(async () => {
    await providerFinished;
    return { stdout: 'late provider result', exitCode: 0, timedOut: false };
  });
  effects.execute.mockImplementation(async () => { await providerFinished; return 'late job result'; });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const pong = await request({ type: 'ping' });
  const turn = request({ type: 'prompt', text: 'ignore shutdown until released' }).catch(error => ({ failure: String(error) }));
  try {
    await vi.waitFor(() => expect(effects.dispatch).toHaveBeenCalledOnce());
    expect(await request({ type: 'job-submit', kind: 'held-job', payload: {} })).toMatchObject({ type: 'job-accepted' });
    await vi.waitFor(() => expect(effects.execute).toHaveBeenCalledOnce());
    const started = performance.now();
    expect(await request({ type: 'shutdown' })).toMatchObject({ type: 'bye' });
    await running;
    expect(performance.now() - started).toBeLessThan(18_000);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/job drain exceeded 10000ms/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/prompt drain exceeded 10000ms.*cleanup is still pending/));
    expect(existsSync(socketPath())).toBe(false);
    expect(existsSync(pidFilePath())).toBe(true);
    release();
    await vi.waitFor(() => expect(replay(String(pong.sessionId), 0).at(-1)?.event)
      .toMatchObject({ type: 'error', message: expect.stringContaining('daemon shutting down') }));
    expect(JSON.stringify(replay(String(pong.sessionId), 0))).not.toContain('late provider result');
  } finally { release(); await turn; warn.mockRestore(); }
});

afterEach(async () => {
  try {
    if (running) {
      if (existsSync(socketPath())) await request({ type: 'shutdown' });
      await running;
    }
    await disposeProcessSurfaceAuthority();
  } finally {
    running = undefined;
    const generations = join(root, 'host', 'generations');
    if (existsSync(generations)) for (const entry of readdirSync(generations, { withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(generations, entry.name), 0o700);
    }
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

it.each(['disable', 'replace', 'cancel', 'return-after-revoke'] as const)('enforces daemon execution and cleanup on %s', async change => {
  const submit = vi.spyOn(JobService.prototype, 'submit');
  let cleanupStarted = false;
  let finishCleanup = () => {};
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  effects.execute.mockImplementation(async (_kind: string, ctx: JobTaskContext) => {
    try {
      await new Promise<void>(resolve => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (change !== 'return-after-revoke') ctx.signal.throwIfAborted();
      return 'ignored cancellation';
    } finally { cleanupStarted = true; await cleanup; }
  });
  try {
    const accepted = await request({ type: 'job-submit', kind: 'running', payload: {} });
    expect(accepted).toMatchObject({ type: 'job-accepted' });
    await vi.waitFor(() => expect(effects.execute).toHaveBeenCalledOnce());
    if (change !== 'cancel') expect(await request({ type: 'job-submit', kind: 'queued', payload: {} }))
      .toMatchObject({ type: 'job-accepted', job: { state: 'queued' } });
    if (change === 'disable' || change === 'return-after-revoke') {
      const catalog = createFirstPartyModCatalog();
      const full = createFullCompatDesiredState(catalog, '2026-10-10T10:00:00.000Z');
      const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.jobs' }, '2026-10-10T10:00:01.000Z').nextState;
      const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0', processIdentity: 'daemon-job-test' });
      await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    } else if (change === 'replace') {
      await disposeProcessSurfaceAuthority();
      await initializeProcessSurfaceAuthority(join(root, 'host'));
    } else {
      expect(await request({ type: 'job-cancel', jobId: (accepted.job as { id: string }).id, reason: 'operator stop' }))
        .toMatchObject({ type: 'job-cancelled', status: 'accepted' });
    }
    await vi.waitFor(() => expect(cleanupStarted).toBe(true), { timeout: 2000 });
    expect(effects.execute).toHaveBeenCalledOnce();
    const jobs = submit.mock.contexts[0];
    expect(await jobs.waitForIdle(1)).toBe(false);
    finishCleanup();
    // Let the real scheduler drain before shutdown can cancel queued work itself.
    expect(await jobs.waitForIdle(2000)).toBe(true);
    expect(jobs.list().map(job => job.state)).toEqual(change === 'cancel' ? ['cancelled'] : ['failed', 'failed']);
    if (change !== 'cancel') {
      const jobId = (accepted.job as { id: string }).id;
      const before = jobs.list();
      const submissions = submit.mock.calls.length;
      for (const body of [
        { type: 'job-submit', kind: 'must-not-start', payload: {} },
        { type: 'job-list' },
        { type: 'job-get', jobId },
        { type: 'job-events', jobId },
        { type: 'job-result', jobId },
        { type: 'job-cancel', jobId },
      ]) {
        expect(await request(body), body.type).toMatchObject({
          type: 'error', message: expect.stringMatching(/generation.*changed.*restart|disposed or replaced/i),
        });
      }
      expect(submit).toHaveBeenCalledTimes(submissions);
      expect(jobs.list()).toEqual(before);
    }
    expect(await request({ type: 'ping' })).toMatchObject({ type: 'pong' });
    expect(effects.execute).toHaveBeenCalledOnce();
  } finally { finishCleanup(); submit.mockRestore(); }
});
