import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
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
} from '../../packages/cli/src/generated/commands/daemon.js';

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
