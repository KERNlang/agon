import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDaemonController, type DaemonControllerHost } from '@kernlang/agon-mod-jobs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  daemonCommand,
  daemonDir,
  pidFilePath,
  heartbeatPath,
  socketPath,
  readPidFile,
  writePidFile,
  isProcessAlive,
  heartbeatAgeMs,
  formatUptime,
  probeDaemon,
  HEARTBEAT_STALE_MS,
  type DaemonPidInfo,
} from '../../packages/cli/src/commands/daemon.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-daemon-'));
  process.env.AGON_HOME = home;
});

afterEach(() => {
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

// ── path helpers resolve under the (call-time) AGON_HOME ─────────────────────

describe('agon daemon — path helpers honor AGON_HOME at call time', () => {
  it('places pidfile, heartbeat, and socket under $AGON_HOME/daemon', () => {
    expect(daemonDir()).toBe(join(home, 'daemon'));
    expect(pidFilePath()).toBe(join(home, 'daemon', 'agond.pid'));
    expect(heartbeatPath()).toBe(join(home, 'daemon', 'heartbeat'));
    expect(socketPath()).toBe(join(home, 'daemon', 'agond.sock'));
  });

  it('follows a re-pointed AGON_HOME without a re-import (call-time resolution)', () => {
    const other = mkdtempSync(join(tmpdir(), 'agon-daemon-other-'));
    try {
      process.env.AGON_HOME = other;
      expect(daemonDir()).toBe(join(other, 'daemon'));
    } finally {
      process.env.AGON_HOME = home;
      rmSync(other, { recursive: true, force: true });
    }
  });
});

// ── pidfile read/write round-trip + tolerance ────────────────────────────────

describe('agon daemon — pidfile', () => {
  it('writes and reads back the pid / sessionId / startedAt', () => {
    const info: DaemonPidInfo = { pid: 4242, sessionId: 'daemon-9', startedAt: '2026-06-10T00:00:00.000Z' };
    writePidFile(info);
    expect(existsSync(pidFilePath())).toBe(true);
    expect(readPidFile()).toEqual(info);
  });

  it('returns null when the pidfile is absent', () => {
    expect(readPidFile()).toBeNull();
  });

  it('returns null for a corrupt pidfile (so stale-takeover can clean it)', () => {
    mkdirSync(daemonDir(), { recursive: true });
    writeFileSync(pidFilePath(), '{ not json');
    expect(readPidFile()).toBeNull();
  });

  it('returns null when the pid field is missing / non-numeric', () => {
    mkdirSync(daemonDir(), { recursive: true });
    writeFileSync(pidFilePath(), JSON.stringify({ sessionId: 's' }));
    expect(readPidFile()).toBeNull();
  });
});

// ── isProcessAlive ───────────────────────────────────────────────────────────

describe('agon daemon — isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('reports a non-finite / non-positive pid as dead', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(NaN)).toBe(false);
  });

  it('reports an almost-certainly-unused pid as dead', () => {
    // 2^31-ish — far above any real pid on a test host.
    expect(isProcessAlive(2_147_480_000)).toBe(false);
  });
});

// ── heartbeat freshness ──────────────────────────────────────────────────────

describe('agon daemon — heartbeatAgeMs', () => {
  it('is Infinity when the heartbeat file is absent', () => {
    expect(heartbeatAgeMs()).toBe(Infinity);
  });

  it('is small right after a touch and stale after backdating the mtime', () => {
    mkdirSync(daemonDir(), { recursive: true });
    writeFileSync(heartbeatPath(), '');
    expect(heartbeatAgeMs()).toBeLessThan(HEARTBEAT_STALE_MS);

    // Backdate the mtime well past the stale threshold.
    const old = new Date(Date.now() - HEARTBEAT_STALE_MS * 4);
    utimesSync(heartbeatPath(), old, old);
    expect(heartbeatAgeMs()).toBeGreaterThan(HEARTBEAT_STALE_MS);
  });
});

// ── formatUptime ─────────────────────────────────────────────────────────────

describe('agon daemon — formatUptime', () => {
  it('renders seconds, minutes, and hours coarsely', () => {
    expect(formatUptime(5_000)).toBe('5s');
    expect(formatUptime(65_000)).toBe('1m 5s');
    expect(formatUptime(3_725_000)).toBe('1h 2m');
  });

  it('renders "?" for a non-finite / negative input', () => {
    expect(formatUptime(NaN)).toBe('?');
    expect(formatUptime(-1)).toBe('?');
  });
});

// ── probeDaemon — stale-takeover gate ────────────────────────────────────────

describe('agon daemon — probeDaemon stale-takeover', () => {
  it('reports a dead pid as not-live and CLEANS its pidfile (fully stale)', async () => {
    mkdirSync(daemonDir(), { recursive: true });
    // A pid that is almost certainly not a running process on this host.
    writePidFile({ pid: 2_147_480_000, sessionId: 'daemon-dead', startedAt: '' });
    const probe = await probeDaemon();
    expect(probe.live).toBe(false);
    expect(probe.staleCleaned).toBe(true);
    // Dead-pid pidfile is removed so a fresh start is unobstructed.
    expect(existsSync(pidFilePath())).toBe(false);
  });

  it('reports an ALIVE pid with no answering socket as hung and PRESERVES its pidfile', async () => {
    mkdirSync(daemonDir(), { recursive: true });
    // Use THIS process's pid (definitely alive) but bind no socket — the daemon
    // looks hung/half-dead, which start must refuse rather than spawn over.
    writePidFile({ pid: process.pid, sessionId: 'daemon-hung', startedAt: '' });
    const probe = await probeDaemon();
    expect(probe.live).toBe(false);
    expect(probe.hung).toBe(true);
    expect(probe.staleCleaned).toBe(false);
    // A running pid's pidfile is NOT removed — only `stop` may tear it down.
    expect(existsSync(pidFilePath())).toBe(true);
  });

  it('reports no daemon (not-live, nothing cleaned) when there is no pidfile or socket', async () => {
    const probe = await probeDaemon();
    expect(probe.live).toBe(false);
    expect(probe.staleCleaned).toBe(false);
    expect(probe.hung).toBeFalsy();
  });
});

// ── command registration ─────────────────────────────────────────────────────

describe('agon daemon — command registration', () => {
  it('registers as a citty command named "daemon" with action + --foreground', () => {
    expect(daemonCommand?.meta?.name).toBe('daemon');
    expect(daemonCommand?.args?.action?.type).toBe('positional');
    expect(daemonCommand?.args?.foreground?.type).toBe('boolean');
    expect(typeof daemonCommand?.run).toBe('function');
  });
});

describe('Jobs daemon controller host boundary', () => {
  function fixture(name: string) {
    const directory = join(home, name);
    const text = (value: string) => value;
    const host: DaemonControllerHost = {
      daemonDirectory: () => directory,
      ensureHome: vi.fn(),
      runServer: vi.fn(async () => {}),
      ping: vi.fn(async () => null),
      shutdown: vi.fn(async () => null),
      spawn: vi.fn(() => { throw new Error('Unexpected daemon spawn'); }),
      output: {
        header: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(),
        bold: text, dim: text, green: text, cyan: text, yellow: text, red: text,
      },
    };
    return { host, controller: createDaemonController(host) };
  }

  it('keeps independent controller files and callbacks separate', async () => {
    const first = fixture('first');
    const second = fixture('second');
    first.controller.writePidFile({ pid: process.pid, sessionId: 'first', startedAt: 'first' });
    expect(second.controller.readPidFile()).toBeNull();
    second.controller.writePidFile({ pid: process.pid, sessionId: 'second', startedAt: 'second' });
    expect(first.controller.readPidFile()?.sessionId).toBe('first');
    expect(second.controller.readPidFile()?.sessionId).toBe('second');
    await first.controller.probeDaemon();
    expect(first.host.ping).toHaveBeenCalledOnce();
    expect(second.host.ping).not.toHaveBeenCalled();
  });

  it('retains the previous complete PID record when publication fails during write', () => {
    const { controller } = fixture('atomic-publication');
    const original = { pid: process.pid, sessionId: 'original', startedAt: 'original' };
    controller.writePidFile(original);
    const write = fs.writeFileSync;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failWrite = vi.spyOn(fs, 'writeFileSync').mockImplementation((path, _data, options) => {
      write(path, '', options);
      throw new Error('injected write failure after opening file');
    });
    syncBuiltinESMExports();
    try {
      controller.writePidFile({ ...original, sessionId: 'replacement' });
      expect(failWrite).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('injected write failure'));
      expect(controller.readPidFile()).toEqual(original);
      expect(fs.readdirSync(controller.daemonDir())).toEqual(['agond.pid']);
    } finally {
      failWrite.mockRestore();
      warn.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it('preserves ownership published while a socket probe is pending', async () => {
    const { host, controller } = fixture('probe-publication');
    mkdirSync(controller.daemonDir(), { recursive: true });
    writeFileSync(controller.socketPath(), 'old socket');
    vi.mocked(host.ping).mockImplementation(async () => {
      controller.writePidFile({ pid: process.pid, sessionId: 'new-owner', startedAt: 'new' });
      fs.renameSync(controller.socketPath(), join(controller.daemonDir(), 'old.sock'));
      writeFileSync(controller.socketPath(), 'new socket');
      return null;
    });
    const probe = await controller.probeDaemon();
    expect(probe.staleCleaned).toBe(false);
    expect(probe.hung).toBe(true);
    expect(controller.readPidFile()?.sessionId).toBe('new-owner');
    expect(fs.readFileSync(controller.socketPath(), 'utf8')).toBe('new socket');
  });

  it('does not unlink a responding socket because its PID record is stale', async () => {
    const { host, controller } = fixture('stale-pid-live-socket');
    controller.writePidFile({ pid: 2_147_480_000, sessionId: 'old', startedAt: 'old' });
    writeFileSync(controller.socketPath(), 'live socket');
    vi.mocked(host.ping).mockResolvedValue({ type: 'pong', sessionId: 'new', uptime: 1 });
    const probe = await controller.probeDaemon();
    expect(probe).toEqual({ live: true, sessionId: 'new', staleCleaned: false });
    expect(controller.readPidFile()?.sessionId).toBe('old');
    expect(fs.readFileSync(controller.socketPath(), 'utf8')).toBe('live socket');
  });

  it('reports no daemon when another controller completes cleanup during the probe', async () => {
    const { host, controller } = fixture('probe-removed');
    controller.writePidFile({ pid: 2_147_480_000, sessionId: 'old', startedAt: 'old' });
    writeFileSync(controller.socketPath(), 'socket');
    vi.mocked(host.ping).mockImplementation(async () => {
      rmSync(controller.pidFilePath());
      rmSync(controller.socketPath());
      return null;
    });
    expect(await controller.probeDaemon()).toEqual({ live: false, staleCleaned: false });
  });

  it.each(['replaced', 'removed'])('does not signal after ownership is %s during shutdown', async change => {
    const { host, controller } = fixture(`stop-${change}`);
    controller.writePidFile({ pid: process.pid, sessionId: 'old', startedAt: 'old' });
    writeFileSync(controller.socketPath(), 'socket');
    vi.mocked(host.shutdown).mockImplementation(async () => {
      if (change === 'replaced') controller.writePidFile({ pid: process.pid, sessionId: 'new', startedAt: 'new' });
      else rmSync(controller.pidFilePath());
      return null;
    });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      await controller.stopDaemon();
      expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
      expect(fs.readFileSync(controller.socketPath(), 'utf8')).toBe('socket');
      expect(host.output.warn).toHaveBeenCalledWith(expect.stringContaining('ownership changed'));
    } finally { kill.mockRestore(); }
  });

  it('preserves replacement files after an acknowledged shutdown', async () => {
    const { host, controller } = fixture('stop-ack-replacement');
    controller.writePidFile({ pid: 2_147_480_000, sessionId: 'old', startedAt: 'old' });
    writeFileSync(controller.socketPath(), 'old socket');
    vi.mocked(host.shutdown).mockImplementation(async () => {
      controller.writePidFile({ pid: process.pid, sessionId: 'new', startedAt: 'new' });
      writeFileSync(controller.socketPath(), 'new socket');
      return { type: 'bye' };
    });
    await controller.stopDaemon();
    expect(controller.readPidFile()?.sessionId).toBe('new');
    expect(fs.readFileSync(controller.socketPath(), 'utf8')).toBe('new socket');
    expect(host.output.success).not.toHaveBeenCalled();
  });

  it('removes unchanged dead ownership files on stop', async () => {
    const { controller } = fixture('stop-stale');
    controller.writePidFile({ pid: 2_147_480_000, sessionId: 'old', startedAt: 'old' });
    writeFileSync(controller.socketPath(), 'stale socket');
    await controller.stopDaemon();
    expect(existsSync(controller.pidFilePath())).toBe(false);
    expect(existsSync(controller.socketPath())).toBe(false);
  });

  it.each(['probeDaemon', 'stopDaemon'] as const)('%s reports failed stale cleanup instead of success', async operation => {
    const { host, controller } = fixture(`cleanup-failed-${operation}`);
    controller.writePidFile({ pid: 2_147_480_000, sessionId: 'old', startedAt: 'old' });
    mkdirSync(controller.socketPath());
    await expect(controller[operation]()).rejects.toThrow();
    expect(fs.statSync(controller.socketPath()).isDirectory()).toBe(true);
    expect(host.output.success).not.toHaveBeenCalled();
  });

  it('awaits the foreground host and propagates its failure without spawning', async () => {
    const { host, controller } = fixture('foreground');
    let rejectServer!: (error: Error) => void;
    const server = new Promise<void>((_resolve, reject) => { rejectServer = reject; });
    vi.mocked(host.runServer).mockReturnValue(server);
    let settled = false;
    const launch = controller.startDaemon(true).finally(() => { settled = true; });
    const rejected = expect(launch).rejects.toThrow('server fixture failure');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(host.ensureHome).toHaveBeenCalledOnce();
    expect(host.runServer).toHaveBeenCalledOnce();
    rejectServer(new Error('server fixture failure'));
    await rejected;
    expect(host.spawn).not.toHaveBeenCalled();
  });

  it.each([true, false])('refuses a live process before spawning when answering=%s', async answering => {
    const { host, controller } = fixture('existing');
    controller.writePidFile({ pid: process.pid, sessionId: 'existing', startedAt: '' });
    if (answering) vi.mocked(host.ping).mockResolvedValue({ type: 'pong', sessionId: 'existing', uptime: 1 });
    await controller.startDaemon(false);
    expect(host.spawn).not.toHaveBeenCalled();
    expect(host.output.warn).toHaveBeenCalledWith(answering
      ? 'A daemon is already running.'
      : 'A daemon process is alive but not answering its socket.');
    expect(controller.readPidFile()?.sessionId).toBe('existing');
  });
});
