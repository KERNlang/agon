import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { replay } from '../../packages/core/src/sessions/event-log.js';
import { initializeMcpSurfaceAuthority, disposeMcpSurfaceAuthority, invokeActiveMcpSurfaceTool } from '../../packages/mcp/src/surface-authority.js';
import { handleJobToolCall } from '../../packages/mcp/src/job-tools.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import {
  encodeDaemonRequest,
  parseDaemonResponse,
  splitFrames,
  type DaemonRequest,
  type DaemonResponse,
} from '../../packages/core/src/sessions/daemon-protocol.js';

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
interface RequestTrace {
  request: DaemonRequest['type'];
  reason: string;
  connected: boolean;
  bytes: number;
  elapsedMs: number;
  partialFrame: string;
}
let lastRequestTrace: RequestTrace | undefined;
function sendRequest(sockPath: string, req: DaemonRequest, timeoutMs = 3000): Promise<DaemonResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const startedAt = Date.now();
    let connected = false;
    let bytes = 0;
    const finish = (v: DaemonResponse | null, reason = 'reply'): void => {
      if (settled) return;
      lastRequestTrace = { request: req.type, reason, connected, bytes,
        elapsedMs: Date.now() - startedAt, partialFrame: buffer.slice(0, 200) };
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* best-effort */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs);
    const sock = connect(sockPath, () => {
      connected = true;
      try { sock.write(encodeDaemonRequest(req)); }
      catch (error) { finish(null, `write: ${String(error)}`); }
    });
    sock.setEncoding('utf-8');
    sock.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      buffer += chunk;
      const { lines, rest } = splitFrames(buffer);
      buffer = rest;
      for (const line of lines) {
        const parsed = parseDaemonResponse(line);
        if (parsed) { finish(parsed); return; }
      }
    });
    sock.on('error', (error: NodeJS.ErrnoException) => finish(null, `socket: ${error.code ?? ''} ${error.message}`));
    sock.on('close', hadError => finish(null, `close: hadError=${hadError}`));
  });
}

let home: string;
let pidPath: string;
let sockPath: string;
let previousEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  previousEnvironment = Object.fromEntries(['AGON_HOME', 'AGON_MODULAR_HOST_ROOT', 'AGON_MOD_SAFE_MODE'].map(key => [key, process.env[key]]));
  lastRequestTrace = undefined;
  home = mkdtempSync(join(tmpdir(), 'agon-daemon-survival-'));
  // Point THIS process's AGON_HOME at the same temp home so the test's own
  // replay() reads the ledger the (separately-spawned, env-passed) daemon wrote.
  process.env.AGON_HOME = home;
  process.env.AGON_MODULAR_HOST_ROOT = join(home, 'modular-host');
  delete process.env.AGON_MOD_SAFE_MODE;
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
  // The test commits immutable generations. Permit removal of those fixtures.
  const generations = join(home, 'modular-host', 'generations');
  if (existsSync(generations)) {
    for (const entry of readdirSync(generations, { withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(generations, entry.name), 0o700);
    }
  }
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describeMaybe('agond survival — the daemon outlives its launcher', () => {
  it.each(['cancel', 'shutdown'])('stops detached engine processes on job %s through the real CLI', async action => {
    const ready = join(home, 'fixture-engine.pid');
    const script = join(home, 'fixture-engine.cjs');
    writeFileSync(script, `const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, String(process.pid));
      fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)});
      setTimeout(() => process.exit(0), 15000);`);
    mkdirSync(join(home, 'engines'));
    writeFileSync(join(home, 'engines/load-fixture.json'), JSON.stringify({
      schemaVersion: 3, id: 'load-fixture', displayName: 'Local cancellation fixture',
      binary: process.execPath, isLocal: true, tier: 'user', timeout: 20,
      exec: { args: [script, '{prompt}'] },
    }));
    const daemon = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'run', '--foreground'], {
      env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '0' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let daemonStderr = '';
    daemon.stderr?.setEncoding('utf8');
    daemon.stderr?.on('data', (chunk: string) => { daemonStderr = (daemonStderr + chunk).slice(-8192); });
    let enginePid: number | undefined;
    try {
      expect(await waitFor(() => existsSync(sockPath), 10_000)).toBe(true);
      const accepted = await sendRequest(sockPath, { type: 'job-submit', kind: 'think',
        payload: { input: 'Local cancellation fixture', engine: 'load-fixture', steps: '1', cwd: home } });
      expect(accepted?.type, JSON.stringify({ response: accepted, trace: lastRequestTrace,
        exitCode: daemon.exitCode, signalCode: daemon.signalCode, stderr: daemonStderr })).toBe('job-accepted');
      if (accepted?.type !== 'job-accepted') throw new Error(JSON.stringify(accepted));
      expect(await waitFor(() => existsSync(ready), 10_000)).toBe(true);
      enginePid = Number(readFileSync(ready, 'utf8'));
      expect(Number.isSafeInteger(enginePid) && enginePid > 0).toBe(true);
      if (action === 'cancel') {
        expect(await sendRequest(sockPath, { type: 'job-cancel', jobId: accepted.job.id })).toMatchObject({ type: 'job-cancelled', job: { state: 'cancelled' } });
        expect(await sendRequest(sockPath, { type: 'job-result', jobId: accepted.job.id })).toMatchObject({ type: 'job-result', ready: true, outcome: { state: 'cancelled' } });
      } else {
        expect(await sendRequest(sockPath, { type: 'shutdown' })).toMatchObject({ type: 'bye' });
      }
      expect(await waitFor(() => {
        try { process.kill(enginePid!, 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; return true; }
      }, 3500)).toBe(true);
      if (action === 'cancel') expect(await sendRequest(sockPath, { type: 'ping' })).toMatchObject({ type: 'pong' });
      else expect(await waitFor(() => daemon.exitCode !== null, 10_000)).toBe(true);
    } finally {
      if (existsSync(ready)) enginePid = Number(readFileSync(ready, 'utf8'));
      if (Number.isSafeInteger(enginePid) && enginePid! > 0) {
        try { process.kill(-enginePid!, 'SIGKILL'); } catch { /* Owned fixture already stopped. */ }
      }
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGKILL');
      await waitFor(() => daemon.exitCode !== null || daemon.signalCode !== null);
    }
  }, 30_000);

  it('refuses a second foreground server without damaging the current owner', async () => {
    const env = { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1' };
    const first = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'run', '--foreground'], { env, stdio: 'ignore' });
    let second: ReturnType<typeof spawn> | undefined;
    try {
      expect(await waitFor(() => existsSync(pidPath) && existsSync(sockPath), 10_000)).toBe(true);
      const original = readFileSync(pidPath, 'utf8');
      const owner = JSON.parse(original) as { pid: number; sessionId: string };
      expect(owner.pid).toBe(first.pid);
      expect(await sendRequest(sockPath, { type: 'ping' })).toMatchObject({ type: 'pong', sessionId: owner.sessionId });
      second = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'run', '--foreground'], { env, stdio: 'ignore' });
      expect(await waitFor(() => second!.exitCode !== null, 10_000)).toBe(true);
      expect(second.exitCode).not.toBe(0);
      expect(existsSync(pidPath)).toBe(true);
      expect(readFileSync(pidPath, 'utf8')).toBe(original);
      expect(await sendRequest(sockPath, { type: 'ping' })).toMatchObject({ type: 'pong', sessionId: owner.sessionId });
      expect(first.exitCode).toBeNull();
    } finally {
      // Both processes belong to this test, even if the broken server loses its PID file.
      for (const child of [second, first]) {
        if (child && child.exitCode === null) child.kill('SIGKILL');
      }
      await waitFor(() => first.exitCode !== null || first.signalCode !== null);
      if (second) await waitFor(() => second!.exitCode !== null || second!.signalCode !== null);
    }
  }, 30_000);

  it('reports the failing transport layer without retrying a refused request', async () => {
    expect(await sendRequest(sockPath, { type: 'ping' })).toBeNull();
    expect(lastRequestTrace).toMatchObject({ request: 'ping', connected: false, bytes: 0 });
    expect(lastRequestTrace?.reason).toContain('ENOENT');
  });

  it.each(['close', 'timeout'] as const)('distinguishes a connected socket %s from a refused request', async failure => {
    mkdirSync(join(home, 'daemon'));
    const server = createServer(socket => {
      socket.resume();
      if (failure === 'close') socket.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(sockPath, resolve);
    });
    try {
      expect(await sendRequest(sockPath, { type: 'ping' }, failure === 'timeout' ? 500 : 3000)).toBeNull();
      expect(lastRequestTrace).toMatchObject({ request: 'ping', connected: true, bytes: 0,
        reason: failure === 'close' ? 'close: hadError=false' : 'timeout' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('submits the first job while starting an absent daemon', async () => {
    const child = spawn(
      process.execPath,
      [CLI_ENTRY, 'job', 'submit', 'brainstorm', 'cold-start job', '--wait', '--json'],
      {
        env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1' },
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
    // The physical MCP owner must observe the same daemon job after its CLI exits.
    const originalScript = process.env.AGON_CLI_NODE_SCRIPT;
    process.env.AGON_CLI_NODE_SCRIPT = CLI_ENTRY;
    try {
      await initializeMcpSurfaceAuthority();
      const jobId = JSON.parse(stdout).job.id as string;
      const listed = await invokeActiveMcpSurfaceTool('JobList', {});
      expect(JSON.parse(String(listed))).toEqual(expect.arrayContaining([expect.objectContaining({ id: jobId })]));
      const status = await invokeActiveMcpSurfaceTool('JobStatus', { jobId });
      expect(JSON.parse(String(status))).toMatchObject({ id: jobId, kind: 'brainstorm', state: 'succeeded' });
      const result = await invokeActiveMcpSurfaceTool('JobResult', { jobId });
      expect(JSON.parse(String(result))).toMatchObject({ job: { id: jobId }, outcome: { state: 'succeeded' } });
      const events = await invokeActiveMcpSurfaceTool('JobEvents', { jobId, afterSeq: 2, limit: 20 });
      const replayed = String(events).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      expect(replayed.length).toBeGreaterThan(0);
      expect(replayed.every(event => event.seq > 2)).toBe(true);
      expect(await invokeActiveMcpSurfaceTool('JobEvents', { jobId, afterSeq: replayed.at(-1).seq, limit: 20 })).toBe('');
      const cancelled = await invokeActiveMcpSurfaceTool('JobCancel', { jobId, reason: 'already finished' });
      expect(JSON.parse(String(cancelled))).toMatchObject({ status: 'already-terminal', job: { id: jobId, state: 'succeeded' } });
      const submitted = await invokeActiveMcpSurfaceTool('JobSubmit', {
        kind: 'review', payload: { input: 'uncommitted', cwd: process.cwd() },
      });
      const mcpJob = JSON.parse(String(submitted));
      expect(await sendRequest(sockPath, { type: 'job-get', jobId: mcpJob.id }))
        .toMatchObject({ type: 'job-snapshot', job: { kind: 'review', label: 'uncommitted' } });
      await expect(invokeActiveMcpSurfaceTool('JobSubmit', { kind: 'shell', payload: { input: 'must not execute' } }))
        .rejects.toThrow(/not available|failed/i);
      await expect(invokeActiveMcpSurfaceTool('JobStatus', { jobId: 'missing-job' })).rejects.toThrow(/not found/i);
      const otherWorkspace = join(home, 'other-workspace');
      mkdirSync(otherWorkspace);
      writeFileSync(join(otherWorkspace, '.agon.json'), JSON.stringify({ removedEngines: ['codex'] }));
      const crossWorkspace = JSON.parse(await handleJobToolCall('JobSubmit', {
        kind: 'review', payload: { input: 'uncommitted', engine: 'codex' },
      }, { cwd: otherWorkspace }));
      expect(crossWorkspace).toMatchObject({ ok: false });
      expect(crossWorkspace.error).toMatch(/removed|disabled/i);
    } finally {
      await disposeMcpSurfaceAuthority();
      if (originalScript === undefined) delete process.env.AGON_CLI_NODE_SCRIPT;
      else process.env.AGON_CLI_NODE_SCRIPT = originalScript;
    }
  }, 30_000);

  it('rejects Jobs and prompts after disabling Jobs, then shuts down cleanly', async () => {
    const launcher = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'start'], {
      env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1' }, stdio: 'ignore',
    });
    expect(await waitFor(() => existsSync(pidPath) && existsSync(sockPath), 10_000)).toBe(true);
    expect(await waitFor(() => launcher.exitCode !== null, 10_000)).toBe(true);
    expect(launcher.exitCode).toBe(0);
    const accepted = await sendRequest(sockPath, {
      type: 'job-submit', kind: 'brainstorm', payload: { input: 'before disable', cwd: process.cwd() },
    });
    expect(accepted?.type).toBe('job-accepted');
    if (accepted?.type !== 'job-accepted') throw new Error('baseline job was not accepted');
    const jobId = accepted.job.id;
    const catalog = createFirstPartyModCatalog();
    const daemon = JSON.parse(readFileSync(pidPath, 'utf8')) as { pid: number; sessionId: string };
    const full = createFullCompatDesiredState(catalog, '2026-10-10T10:00:00.000Z');
    const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.jobs' }, '2026-10-10T10:00:01.000Z').nextState;
    const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: '1.0.0', processIdentity: 'daemon-disable-test' });
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    const requests: DaemonRequest[] = [
      { type: 'job-submit', kind: 'brainstorm', payload: { input: 'must not start', cwd: process.cwd() } },
      { type: 'job-list' },
      { type: 'job-get', jobId },
      { type: 'job-result', jobId },
      { type: 'job-events', jobId },
      { type: 'job-cancel', jobId },
      { type: 'prompt', text: 'must not dispatch after disable' },
    ];
    for (const request of requests) {
      expect(await sendRequest(sockPath, request)).toMatchObject({ type: 'error', message: expect.stringMatching(/generation.*changed.*restart/i) });
    }
    // Control traffic must remain usable so the operator can stop the stale host.
    expect(await sendRequest(sockPath, { type: 'ping' })).toMatchObject({ type: 'pong' });
    expect(await sendRequest(sockPath, { type: 'shutdown' })).toMatchObject({ type: 'bye' });
    expect(await waitFor(() => {
      try { process.kill(daemon.pid, 0); return false; } catch { return true; }
    }, 8000)).toBe(true);
    expect(existsSync(sockPath)).toBe(false);
    expect(existsSync(pidPath)).toBe(false);
    expect(JSON.stringify(replay(daemon.sessionId, 0))).not.toContain('must not dispatch after disable');
  }, 30_000);

  it('survives the launching process exiting, serves over the socket, and a prompt lands in the ledger', async () => {
    // 1) Launch the daemon via the real CLI. AGON_DAEMON_ECHO=1 makes a prompt
    //    turn echo into the ledger instead of dispatching a real engine — a
    //    DOCUMENTED test seam so the survival proof never depends on an engine.
    const launcher = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'start'], {
      env: { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1' },
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
    expect(pong?.type, JSON.stringify(lastRequestTrace)).toBe('pong');
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

  it('daemon stop preserves a socket-only server that acknowledges before drain completes', async () => {
    mkdirSync(join(home, 'daemon'), { recursive: true });
    const server = createServer(socket => {
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.once('data', () => socket.end('{"type":"bye"}\n'));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(sockPath, resolve);
    });
    const stopper = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'stop'], {
      env: { ...process.env, AGON_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    stopper.stdout?.on('data', chunk => { output += String(chunk); });
    stopper.stderr?.on('data', chunk => { output += String(chunk); });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        stopper.once('error', reject);
        stopper.once('close', resolve);
      });
      expect(code, output).toBe(0);
      expect(existsSync(sockPath)).toBe(true);
      expect(output).toContain('shutdown is still pending');
      const replacement = createServer();
      try {
        const error = await new Promise<NodeJS.ErrnoException | null>(resolve => {
          replacement.once('error', resolve);
          replacement.listen(sockPath, () => resolve(null));
        });
        expect(error?.code).toBe('EADDRINUSE');
      } finally { replacement.close(); }
    } finally {
      if (stopper.exitCode === null) stopper.kill('SIGKILL');
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('daemon stop stays alive for its bounded poll and exits cleanly', async () => {
    const env = { ...process.env, AGON_HOME: home, AGON_DAEMON_ECHO: '1' };
    const launcher = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'start'], { env, stdio: 'ignore' });
    expect(await waitFor(() => existsSync(pidPath) && existsSync(sockPath), 10_000)).toBe(true);
    expect(await waitFor(() => launcher.exitCode !== null || launcher.killed, 10_000)).toBe(true);

    const stopper = spawn(process.execPath, [CLI_ENTRY, 'daemon', 'stop'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    stopper.stdout?.setEncoding('utf-8');
    stopper.stderr?.setEncoding('utf-8');
    stopper.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    stopper.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      stopper.once('error', reject);
      stopper.once('close', resolve);
    });

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain('agond stopped');
    expect(stderr).not.toContain('unsettled top-level await');
    expect(await waitFor(() => !existsSync(sockPath) && !existsSync(pidPath), 4_000)).toBe(true);
  }, 30_000);
});
