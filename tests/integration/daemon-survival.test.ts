import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { replay } from '../../packages/core/src/generated/sessions/event-log.js';
import {
  encodeDaemonRequest,
  parseDaemonResponse,
  splitFrames,
  type DaemonRequest,
  type DaemonResponse,
} from '../../packages/core/src/generated/sessions/daemon-protocol.js';

// The built CLI entry the daemon re-spawns itself from. The test drives the
// REAL binary so it exercises the detached + unref survival path end-to-end.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI_ENTRY = join(HERE, '..', '..', 'packages', 'cli', 'dist', 'index.js');
const cliBuilt = existsSync(CLI_ENTRY);

// Skip if the CLI hasn't been built (the gate builds before tests; this guard
// keeps a from-source `vitest` run from failing spuriously, mirroring how the
// agy-probe e2e gates on an installed binary).
const describeMaybe = cliBuilt ? describe : describe.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs = 8000, stepMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await sleep(stepMs);
  }
  return pred();
}

// Minimal socket client: send ONE request, resolve the FIRST reply frame.
function sendRequest(sockPath: string, req: DaemonRequest, timeoutMs = 3000): Promise<DaemonResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const finish = (v: DaemonResponse | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* best-effort */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const sock = connect(sockPath, () => {
      try { sock.write(encodeDaemonRequest(req)); } catch { finish(null); }
    });
    sock.setEncoding('utf-8');
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      const { lines, rest } = splitFrames(buffer);
      buffer = rest;
      for (const line of lines) {
        const parsed = parseDaemonResponse(line);
        if (parsed) { finish(parsed); return; }
      }
    });
    sock.on('error', () => finish(null));
    sock.on('close', () => finish(null));
  });
}

let home: string;
let pidPath: string;
let sockPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-daemon-survival-'));
  // Point THIS process's AGON_HOME at the same temp home so the test's own
  // replay() reads the ledger the (separately-spawned, env-passed) daemon wrote.
  process.env.AGON_HOME = home;
  pidPath = join(home, 'daemon', 'agond.pid');
  sockPath = join(home, 'daemon', 'agond.sock');
});

afterEach(async () => {
  // Best-effort: make sure no daemon is left running between tests, even if an
  // assertion threw before the explicit stop.
  try {
    if (existsSync(sockPath)) await sendRequest(sockPath, { type: 'shutdown' }, 1500);
  } catch { /* ignore */ }
  try {
    if (existsSync(pidPath)) {
      const info = JSON.parse(readFileSync(pidPath, 'utf-8')) as { pid?: number };
      if (typeof info.pid === 'number') { try { process.kill(info.pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  } catch { /* ignore */ }
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGON_HOME;
});

describeMaybe('agond survival — the daemon outlives its launcher', () => {
  it('submits the first job while starting an absent daemon', async () => {
    const child = spawn(
      process.execPath,
      [CLI_ENTRY, 'job', 'submit', 'brainstorm', 'cold-start job', '--wait', '--json'],
      {
        env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1', AGON_NO_STACK_TRACE_MAPPER: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      job: { kind: 'brainstorm', label: 'cold-start job', state: 'succeeded' },
      outcome: {
        state: 'succeeded',
        value: { ok: true, kind: 'brainstorm', label: 'cold-start job' },
      },
    });
  }, 30_000);

  it('survives the launching process exiting, serves over the socket, and a prompt lands in the ledger', async () => {
    // 1) Launch the daemon via the real CLI. AGON_DAEMON_ECHO=1 makes a prompt
    //    turn echo into the ledger instead of dispatching a real engine — a
    //    DOCUMENTED test seam so the survival proof never depends on an engine.
    const launcher = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'start'], {
      env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1', AGON_NO_STACK_TRACE_MAPPER: '1' },
      stdio: 'ignore',
    });

    // 2) Wait for the detached daemon to write its pidfile + bind its socket.
    const ready = await waitFor(() => existsSync(pidPath) && existsSync(sockPath), 10_000);
    expect(ready).toBe(true);

    const info = JSON.parse(readFileSync(pidPath, 'utf-8')) as { pid: number; sessionId: string };
    expect(info.pid).toBeGreaterThan(0);
    expect(info.sessionId).toMatch(/^daemon-/);
    const daemonPid = info.pid;
    const sessionId = info.sessionId;

    // 3) Wait for the LAUNCHER to fully exit, then assert the DAEMON is still
    //    alive — this is the survival proof: detached + unref means the daemon's
    //    lifetime is independent of the process that spawned it.
    const launcherGone = await waitFor(() => launcher.exitCode !== null || launcher.killed, 10_000);
    expect(launcherGone).toBe(true);
    // The launcher's pid is NOT the daemon's pid (it re-spawned a detached child).
    expect(daemonPid).not.toBe(launcher.pid);
    // The daemon is still alive after its launcher is gone.
    expect(() => process.kill(daemonPid, 0)).not.toThrow();

    // 4) Ping over the socket — the daemon answers though its launcher is dead.
    const pong = await sendRequest(sockPath, { type: 'ping' });
    expect(pong?.type).toBe('pong');
    if (pong?.type === 'pong') {
      expect(pong.sessionId).toBe(sessionId);
      expect(pong.uptime).toBeGreaterThanOrEqual(0);
      expect(pong.capabilities).toContain('jobs-v1');
    }

    // 5) Submit a daemon-owned autonomous job through the real jobs-v1 socket.
    // The same echo seam keeps this deterministic after the safe workflow
    // allowlist/payload validation boundary.
    const accepted = await sendRequest(sockPath, {
      type: 'job-submit', kind: 'brainstorm', payload: { input: 'job survives too', cwd: process.cwd() }, clientId: 'integration-test',
    });
    expect(accepted?.type).toBe('job-accepted');
    if (!accepted || accepted.type !== 'job-accepted') throw new Error('job was not accepted');
    let jobResult: DaemonResponse | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      jobResult = await sendRequest(sockPath, { type: 'job-result', jobId: accepted.job.id });
      if (jobResult?.type === 'job-result' && jobResult.ready) break;
      await sleep(25);
    }
    expect(jobResult).toMatchObject({
      type: 'job-result', ready: true,
      outcome: { state: 'succeeded', value: { ok: true, kind: 'brainstorm', label: 'job survives too' } },
    });
    const jobEvents = await sendRequest(sockPath, { type: 'job-events', jobId: accepted.job.id, afterSeq: 0, limit: 20 });
    expect(jobEvents).toMatchObject({ type: 'job-events', terminal: true });
    if (jobEvents?.type === 'job-events') {
      expect(jobEvents.events.some((event) => event.type === 'submitted')).toBe(true);
      expect(jobEvents.events.some((event) => event.type === 'stdout')).toBe(true);
    }

    // 6) Send a prompt — the echo seam appends it to the session ledger and acks
    //    with the highest written seq.
    const ack = await sendRequest(sockPath, { type: 'prompt', text: 'survive and echo me' });
    expect(ack?.type).toBe('ack');
    if (ack?.type === 'ack') expect(ack.seq).toBeGreaterThan(0);

    // 7) Replay the ledger from disk (the M1/M2 read seam) and assert the turn
    //    landed: a user-message + an echo engine-block. This is the cross-process
    //    proof — the daemon WROTE the ledger, this test process READS it.
    const events = replay(sessionId, 0);
    const types = events.map((e) => (e.event as { type?: string } | null)?.type);
    expect(types).toContain('user-message');
    expect(types).toContain('engine-block');
    const echoBlock = events.find(
      (e) => (e.event as { type?: string } | null)?.type === 'engine-block',
    );
    expect((echoBlock?.event as { content?: string } | undefined)?.content).toContain('survive and echo me');

    // 8) A second prompt while idle still works (one-turn-at-a-time, not broken
    //    after the first), and seq advances monotonically.
    const ack2 = await sendRequest(sockPath, { type: 'prompt', text: 'second turn' });
    expect(ack2?.type).toBe('ack');
    if (ack?.type === 'ack' && ack2?.type === 'ack') {
      expect(ack2.seq).toBeGreaterThan(ack.seq);
    }

    // 9) Stop the daemon and assert it cleans up its socket + pidfile, and the
    //    process actually exits.
    const bye = await sendRequest(sockPath, { type: 'shutdown' });
    expect(bye?.type).toBe('bye');

    const exited = await waitFor(() => {
      try { process.kill(daemonPid, 0); return false; } catch { return true; }
    }, 8_000);
    expect(exited).toBe(true);

    const cleaned = await waitFor(() => !existsSync(sockPath) && !existsSync(pidPath), 4_000);
    expect(cleaned).toBe(true);
  }, 60_000);
});
