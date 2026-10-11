import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const effects = vi.hoisted(() => ({ spawn: vi.fn(), success: vi.fn(), warn: vi.fn(), createServer: vi.fn(), hostCurrent: vi.fn(), available: vi.fn(), routeJob: vi.fn(), resolveJob: vi.fn() }));
vi.mock('../../packages/cli/src/jobs/workflow-job.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/jobs/workflow-job.js')>(),
  resolveDaemonWorkflowJob: effects.resolveJob,
}));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/surface-authority-runtime.js')>(),
  captureProcessSurfaceAuthority: () => effects.hostCurrent,
  assertProcessSurfaceAvailable: effects.available,
}));
vi.mock('@kernlang/agon-mod-jobs', async importOriginal => ({
  ...await importOriginal<typeof import('@kernlang/agon-mod-jobs')>(),
  handleDaemonJobRequest: effects.routeJob,
}));
vi.mock('node:net', async importOriginal => ({
  ...await importOriginal<typeof import('node:net')>(), createServer: effects.createServer,
}));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: effects.spawn,
}));
vi.mock('../../packages/cli/src/blocks/output-format.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/blocks/output-format.js')>(),
  success: effects.success, warn: effects.warn, info: vi.fn(),
}));
import { startDaemon, runDaemonServer, pidFilePath, socketPath, heartbeatPath } from '../../packages/cli/src/commands/daemon.js';

let home: string;
let previousHome: string | undefined;
function publish(ready: boolean) {
  writeFileSync(pidFilePath(), JSON.stringify({ pid: process.pid, sessionId: 'daemon-fixture', startedAt: '', ready }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  effects.hostCurrent.mockReset();
  effects.available.mockReset();
  effects.routeJob.mockReset();
  effects.resolveJob.mockReset();
  previousHome = process.env.AGON_HOME;
  home = mkdtempSync(join(tmpdir(), 'agon-start-ready-'));
  process.env.AGON_HOME = home;
  effects.spawn.mockImplementation(() => {
    publish(false);
    return Object.assign(new EventEmitter(), { pid: process.pid, unref: vi.fn() });
  });
});
afterEach(() => {
  vi.useRealTimers();
  if (previousHome === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

it('does not report startup until the spawned daemon publishes socket readiness', async () => {
  let finished = false;
  const launch = startDaemon(false).then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(100);
  expect(effects.spawn).toHaveBeenCalledOnce();
  expect(effects.success).not.toHaveBeenCalled();
  expect(finished).toBe(false);
  publish(true);
  await vi.advanceTimersByTimeAsync(50);
  await launch;
  expect(effects.success).toHaveBeenCalledExactlyOnceWith('agond started.');
});

it('does not claim success when a live child never becomes ready', async () => {
  const launch = startDaemon(false);
  await vi.advanceTimersByTimeAsync(2000);
  await launch;
  expect(effects.success).not.toHaveBeenCalled();
  expect(effects.warn).toHaveBeenCalledOnce();
});

it('does not accept readiness from a different process', async () => {
  effects.spawn.mockImplementation(() => {
    publish(true);
    return Object.assign(new EventEmitter(), { pid: 2_147_480_000, unref: vi.fn() });
  });
  const launch = startDaemon(false);
  await vi.advanceTimersByTimeAsync(2000);
  await launch;
  expect(effects.success).not.toHaveBeenCalled();
  expect(effects.warn).toHaveBeenCalledOnce();
});

it('publishes readiness only after listening and securing the socket', async () => {
  let listening: () => void = () => { throw new Error('listen was not called'); };
  const server = Object.assign(new EventEmitter(), {
    listen: (_path: string, callback: () => void) => { listening = callback; },
    close: vi.fn(),
  });
  effects.createServer.mockReturnValue(server);
  const stopped = new Error('fixture shutdown');
  const running = runDaemonServer();
  const outcome = expect(running).rejects.toBe(stopped);
  try {
    expect(existsSync(pidFilePath())).toBe(false);
    expect(existsSync(heartbeatPath())).toBe(false);
    writeFileSync(socketPath(), 'fixture socket');
    // A socket path alone does not prove that the server can accept requests.
    expect(existsSync(socketPath())).toBe(true);
    expect(existsSync(pidFilePath())).toBe(false);
    listening();
    expect(JSON.parse(readFileSync(pidFilePath(), 'utf8')).ready).toBe(true);
    expect(existsSync(heartbeatPath())).toBe(true);
  } finally {
    server.emit('error', stopped);
    await outcome;
  }
});

it('never publishes readiness when socket permission setup fails', async () => {
  let listening: () => void = () => { throw new Error('listen was not called'); };
  const server = Object.assign(new EventEmitter(), {
    listen: (_path: string, callback: () => void) => { listening = callback; },
    close: vi.fn(),
  });
  effects.createServer.mockReturnValue(server);
  const running = runDaemonServer();
  const outcome = expect(running).rejects.toThrow('Cannot secure daemon socket');
  // No socket exists: chmod must fail and readiness must remain false.
  listening();
  expect(existsSync(pidFilePath())).toBe(false);
  await outcome;
  expect(server.close).toHaveBeenCalledOnce();
});

it('preserves a competing server publication when listen loses the race', async () => {
  const server = Object.assign(new EventEmitter(), { listen: vi.fn(), close: vi.fn() });
  effects.createServer.mockReturnValue(server);
  const collision = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
  const running = runDaemonServer();
  const outcome = expect(running).rejects.toBe(collision);
  const competing = JSON.stringify({ pid: process.pid, sessionId: 'competing', startedAt: 'competing', ready: true });
  writeFileSync(pidFilePath(), competing);
  writeFileSync(socketPath(), 'competing socket');
  writeFileSync(heartbeatPath(), 'competing heartbeat');
  server.emit('error', collision);
  await outcome;
  expect(readFileSync(pidFilePath(), 'utf8')).toBe(competing);
  expect(readFileSync(socketPath(), 'utf8')).toBe('competing socket');
  expect(readFileSync(heartbeatPath(), 'utf8')).toBe('competing heartbeat');
});

it('does not publish readiness or restart heartbeat when listen completes after shutdown', async () => {
  let listening: () => void = () => { throw new Error('listen was not called'); };
  const server = Object.assign(new EventEmitter(), {
    listen: (_path: string, callback: () => void) => { listening = callback; },
    close: vi.fn(),
  });
  effects.createServer.mockReturnValue(server);
  const running = runDaemonServer();
  process.emit('SIGTERM');
  await running;
  writeFileSync(socketPath(), 'late socket');
  listening();
  expect(existsSync(pidFilePath())).toBe(false);
  expect(existsSync(heartbeatPath())).toBe(false);
  expect(server.close).toHaveBeenCalledTimes(2);
});

it.each(['host', 'owner'])('rejects before the Jobs router when the %s guard fails', async guard => {
  const denied = new Error(`${guard} authority denied`);
  (guard === 'host' ? effects.hostCurrent : effects.available).mockImplementation(() => { throw denied; });
  const server = Object.assign(new EventEmitter(), { listen: vi.fn(), close: vi.fn() });
  effects.createServer.mockReturnValue(server);
  const stopped = new Error('fixture shutdown');
  const running = runDaemonServer();
  const outcome = expect(running).rejects.toBe(stopped);
  const socket = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), write: vi.fn(), destroy: vi.fn() });
  try {
    effects.createServer.mock.calls[0][0](socket);
    socket.emit('data', JSON.stringify({ type: 'job-list' }) + '\n');
    expect(socket.write).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.write.mock.calls[0][0])).toEqual({ type: 'error', message: denied.message });
    expect(effects.routeJob).not.toHaveBeenCalled();
    if (guard === 'owner') expect(effects.available).toHaveBeenCalledWith('cli', 'job');
    else expect(effects.available).not.toHaveBeenCalled();
  } finally {
    server.emit('error', stopped);
    await outcome;
  }
});

it.each(['host', 'owner'])('rechecks %s authority when an admitted job starts later', async guard => {
  const execute = vi.fn(async () => 'must not execute');
  effects.resolveJob.mockReturnValue({ label: 'queued fixture', executor: { run: execute } });
  const server = Object.assign(new EventEmitter(), { listen: vi.fn(), close: vi.fn() });
  effects.createServer.mockReturnValue(server);
  const stopped = new Error('fixture shutdown');
  const running = runDaemonServer();
  const outcome = expect(running).rejects.toBe(stopped);
  const socket = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), write: vi.fn(), destroy: vi.fn() });
  try {
    effects.createServer.mock.calls[0][0](socket);
    socket.emit('data', JSON.stringify({ type: 'job-submit', kind: 'review', payload: {} }) + '\n');
    expect(effects.routeJob).toHaveBeenCalledOnce();
    const resolver = effects.routeJob.mock.calls[0][2];
    const admitted = resolver.resolve('review', {});
    const denied = new Error(`${guard} authority revoked`);
    (guard === 'host' ? effects.hostCurrent : effects.available).mockImplementation(() => { throw denied; });
    await expect(admitted.executor.run({ signal: new AbortController().signal, emit: vi.fn() }))
      .rejects.toBe(denied);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    server.emit('error', stopped);
    await outcome;
  }
});
