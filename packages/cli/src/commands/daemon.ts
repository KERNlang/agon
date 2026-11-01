import { defineCommand } from 'citty';
import { createDaemonController, daemonCliCommand, HEARTBEAT_MS, HEARTBEAT_STALE_MS, PING_TIMEOUT_MS } from '@kernlang/agon-mod-jobs';
import type { DaemonControllerHost, DaemonPidInfo, DaemonLiveness } from '@kernlang/agon-mod-jobs';
import { mkdirSync, writeFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';

import { join } from 'node:path';

import { createServer, connect } from 'node:net';

import type { Socket, Server } from 'node:net';

import { spawn } from 'node:child_process';

import { ensureAgonHome, loadConfig, agonPath, EngineRegistry, JobService, eventLogAppend, eventLogFlush, eventLogLatestSeq } from '@kernlang/agon-core';

import { encodeDaemonRequest, encodeDaemonResponse, parseDaemonRequest, parseDaemonResponse, splitFrames } from '@kernlang/agon-mod-jobs';

import type { DaemonRequest, DaemonResponse } from '@kernlang/agon-mod-jobs';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { handleDaemonJobRequest, isDaemonJobRequest, type DaemonJobResolver } from '@kernlang/agon-mod-jobs';

import { daemonJobConfig, resolveDaemonWorkflowJob } from '../jobs/workflow-job.js';
import { assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, withProcessSurfaceAuthority } from '../surface-authority-runtime.js';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';

import { header, info, success, warn, bold, dim, green, cyan, yellow, red } from '../blocks/output-format.js';

export { HEARTBEAT_MS, HEARTBEAT_STALE_MS, PING_TIMEOUT_MS };
export type { DaemonPidInfo, DaemonLiveness };

export function createCliDaemonHost(assertAvailable?: () => void): DaemonControllerHost {
  return {
    assertAvailable,
    daemonDirectory: () => agonPath('daemon'),
    ensureHome: ensureAgonHome,
    runServer: signal => runDaemonServer(signal),
    async ping() {
      const reply = await sendDaemonRequest({ type: 'ping' });
      return reply?.type === 'pong' ? reply : null;
    },
    async shutdown() {
      const reply = await sendDaemonRequest({ type: 'shutdown' });
      return reply?.type === 'bye' ? reply : null;
    },
    spawn,
    output: { header, info, success, warn, bold, dim, green, cyan, yellow, red },
  };
}

const controller = createDaemonController(createCliDaemonHost());

export const { daemonDir, pidFilePath, heartbeatPath, socketPath, readPidFile, writePidFile, isProcessAlive, heartbeatAgeMs, probeDaemon, daemonStatus, formatUptime, stopDaemon } = controller;

export async function startDaemon(foreground: boolean, options: { quiet?: boolean; assertAvailable?: () => void } = {}): Promise<void> {
  await createDaemonController(createCliDaemonHost(options.assertAvailable)).startDaemon(foreground, options);
}

/**
 * Connect to the daemon socket, send ONE request, and resolve with the FIRST reply frame (or null if the socket is unreachable / no reply within timeoutMs). Pure transport: encodes via the protocol module, accumulates bytes with splitFrames, parses the first complete line. Used by status (ping), stop (shutdown), the stale-socket probe, and tests. Never throws — a refused/absent socket resolves null so callers branch on 'no live daemon'.
 */
export async function sendDaemonRequest(req: DaemonRequest, timeoutMs?: number): Promise<DaemonResponse | null> {
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : PING_TIMEOUT_MS;
  return await new Promise<DaemonResponse | null>((resolve) => {
    let settled = false;
    let buffer = '';
    const finish = (val: DaemonResponse | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* best-effort */ }
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeout);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    const sock: Socket = connect(socketPath(), () => {
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

/**
 * Run ONE headless single-engine turn for a prompt and append every step to the session ledger, returning the highest seq written (for the ack). The reused plumbing: a user-message event, then a single dispatch of the configured cesarEngine in 'exec' mode (the SAME call `agon ask` makes), then an engine-block (or error) event. AGON_DAEMON_ECHO=1 is a documented TEST SEAM — instead of dispatching a real engine (heavy/non-deterministic for an automated survival test) it echoes the prompt straight into the ledger as an engine-block, so the test can assert the event landed without a live engine. The ledger writes are flushed synchronously before returning so the ack's seq is durable and an attach client sees the turn immediately.
 */
export async function runHeadlessTurn(sessionId: string, text: string, registry: EngineRegistry, cwd: string, parentSignal?: AbortSignal): Promise<number> {
  const assertHostCurrent = captureProcessSurfaceAuthority();
  const assertAvailable = (): void => {
    parentSignal?.throwIfAborted();
    assertHostCurrent();
    assertProcessSurfaceAvailable('cli', 'daemon');
  };
  assertAvailable();
  // 1) Record the user's prompt as a ledger event (mirrors the REPL tee shape).
  eventLogAppend(sessionId, { type: 'user-message', content: text }, { kind: 'daemon' });
  
  // TEST SEAM: AGON_DAEMON_ECHO=1 short-circuits the real engine dispatch.
  // The survival test sets this so it never depends on an installed engine —
  // the turn echoes the prompt into the ledger as an engine-block and acks.
  if (process.env.AGON_DAEMON_ECHO === '1') {
    const seq = eventLogAppend(
      sessionId,
      { type: 'engine-block', engineId: 'echo', content: `echo: ${text}` },
      { kind: 'daemon' },
    );
    eventLogFlush(sessionId);
    return seq;
  }
  
  // 2) Resolve the configured Cesar engine (the single engine that answers a
  //    headless turn). Fall back to forgeFixedStarter / 'claude' like the rest
  //    of the codebase. A missing/unknown engine becomes an error event, not a
  //    crash — the daemon must survive a bad turn.
  const config = loadConfig(cwd) as { cesarEngine?: string; forgeFixedStarter?: string };
  const engineId = config.cesarEngine || config.forgeFixedStarter || 'claude';
  let lastSeq = eventLogLatestSeq(sessionId);
  try {
    const engine = registry.get(engineId);
    const adapter = createCliAdapter(registry);
    const result = await withProcessSurfaceAuthority(parentSignal, assertAvailable, async signal => {
      assertAvailable();
      const output = await adapter.dispatch({
        engine,
        prompt: text,
        cwd,
        mode: 'exec',
        timeout: 120,
        signal,
        // The ledger owns the transcript. Provider files are turn scratch data.
        outputDir: join(daemonDir(), 'turns'),
      });
      signal?.throwIfAborted();
      assertAvailable();
      return output;
    });
    assertAvailable();
    const answer = (result.stdout || '').trim();
    if (result.exitCode === 0 && !result.timedOut && answer.length > 0) {
      lastSeq = eventLogAppend(
        sessionId,
        { type: 'engine-block', engineId, content: answer },
        { kind: 'daemon' },
      );
    } else {
      lastSeq = eventLogAppend(
        sessionId,
        { type: 'error', message: result.timedOut ? `${engineId} timed out` : `${engineId} produced no answer (exit ${result.exitCode})` },
        { kind: 'daemon' },
      );
    }
  } catch (err) {
    lastSeq = eventLogAppend(
      sessionId,
      { type: 'error', message: `turn failed: ${err instanceof Error ? err.message : String(err)}` },
      { kind: 'daemon' },
    );
  }
  eventLogFlush(sessionId);
  return lastSeq;
}

/**
 * Serve the newline-JSON protocol and one prompt at a time.
 * Shutdown cancels work and drains it within the configured deadline.
 * Keep the PID file if work outlives the deadline. This prevents replacement
 * while the old process still owns provider work. Remove the socket either way.
 * Resolution means server cleanup finished, not that overdue work stopped.
 */
export async function runDaemonServer(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const assertHostCurrent = captureProcessSurfaceAuthority();
  ensureAgonHome();
  mkdirSync(daemonDir(), { recursive: true });
  const existing = readPidFile();
  if (existing && isProcessAlive(existing.pid)) {
    throw new Error(`A daemon process already owns this directory (pid ${existing.pid}). Stop it before starting another server.`);
  }
  try { chmodSync(daemonDir(), 0o700); }
  catch (err) { throw new Error(`Cannot secure daemon directory: ${err instanceof Error ? err.message : String(err)}`); }
  
  const startedAtMs = Date.now();
  const sessionId = `daemon-${startedAtMs}`;
  const cwd = process.cwd();
  const jobConfig = daemonJobConfig(cwd);
  const jobs = new JobService({
    eventLimit: jobConfig.jobEventLimit,
    retentionLimit: jobConfig.jobRetentionLimit,
    maxConcurrency: jobConfig.jobMaxConcurrency,
  });
  const assertJobsAvailable = (): void => {
    assertHostCurrent();
    assertProcessSurfaceAvailable('cli', 'job');
  };
  const jobResolver: DaemonJobResolver = {
    resolve(kind, payload) {
      const definition = resolveDaemonWorkflowJob(kind, payload);
      return {
        label: definition.label,
        executor: {
          run: ctx => withProcessSurfaceAuthority(ctx.signal, assertJobsAvailable, async signal => {
            assertJobsAvailable();
            const result = await definition.executor.run({ ...ctx, signal: signal ?? ctx.signal });
            (signal ?? ctx.signal).throwIfAborted();
            assertJobsAvailable();
            return result;
          }),
        },
      };
    },
  };
  
  const registry = new EngineRegistry();
  registry.load(resolveBuiltinEnginesDir());
  
  // Seed the session ledger with a meta + boot event so `agon attach --self`
  // sees a non-empty session immediately, and meta.kind === 'daemon'.
  eventLogAppend(sessionId, { type: 'info', message: `agond session started (pid ${process.pid})` }, { kind: 'daemon' });
  eventLogFlush(sessionId);
  
  const pidInfo: DaemonPidInfo = { pid: process.pid, sessionId, startedAt: new Date(startedAtMs).toISOString() };
  // The socket bind is exclusive. Publish shared state only after it succeeds.
  let ownsSocket = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  
  // One turn at a time — a prompt arriving mid-turn gets {busy}. The check +
  // assignment both run in handleRequest's SYNCHRONOUS prologue (before the first
  // await), so even two prompt frames in one data chunk are mutually exclusive:
  // the second sees activeTurn. No await separates the check and assignment.
  let activeTurn: Promise<number> | undefined;
  const lifetime = new AbortController();
  let shuttingDown = false;
  
  // Track accepted client sockets so cleanup() can destroy them — an open
  // connection would otherwise keep the event loop alive after server.close(),
  // leaving an orphaned daemon (review: sockets-keep-process-alive).
  const openSockets = new Set<Socket>();
  
  return await new Promise<void>((resolve, reject) => {
    let cleanupPromise: Promise<void> | null = null;
    const cleanup = (failure?: Error): Promise<void> => {
      if (cleanupPromise) return cleanupPromise;
      shuttingDown = true;
      cleanupPromise = (async () => {
        lifetime.abort(new Error('daemon shutting down'));
        jobs.cancelAll('daemon shutting down');
        let turnTimer: ReturnType<typeof setTimeout> | undefined;
        const turnDrain = activeTurn ? Promise.race([
          activeTurn.then(() => true, () => true),
          new Promise<boolean>(resolve => { turnTimer = setTimeout(() => resolve(false), jobConfig.jobShutdownTimeoutMs); }),
        ]) : Promise.resolve(true);
        const [drained, turnDrained] = await Promise.all([
          jobs.waitForIdle(jobConfig.jobShutdownTimeoutMs), turnDrain,
        ]).finally(() => { if (turnTimer) clearTimeout(turnTimer); });
        if (!drained) console.warn(`[agond] job drain exceeded ${jobConfig.jobShutdownTimeoutMs}ms; completing shutdown`);
        if (!turnDrained) console.warn(`[agond] prompt drain exceeded ${jobConfig.jobShutdownTimeoutMs}ms; provider cleanup is still pending`);
        if (heartbeat) clearInterval(heartbeat);
        process.off('SIGTERM', onSignal);
        process.off('SIGINT', onSignal);
        signal?.removeEventListener('abort', onAbort);
        try { eventLogFlush(sessionId); } catch { /* best-effort */ }
        try { server.close(); } catch { /* best-effort */ }
        for (const s of openSockets) { try { s.destroy(); } catch { /* best-effort */ } }
        openSockets.clear();
        if (ownsSocket) {
          try { rmSync(socketPath(), { force: true }); } catch { /* best-effort */ }
        }
        // Keep process ownership if a provider still holds this process open.
        const current = readPidFile();
        if (ownsSocket && drained && turnDrained && current?.pid === pidInfo.pid
          && current.sessionId === pidInfo.sessionId && current.startedAt === pidInfo.startedAt) {
          try { rmSync(pidFilePath(), { force: true }); } catch { /* best-effort */ }
        }
        if (failure) reject(failure); else resolve();
      })();
      return cleanupPromise;
    };
  
    const reply = (sock: Socket, msg: DaemonResponse): void => {
      try { sock.write(encodeDaemonResponse(msg)); } catch { /* peer gone */ }
    };
  
    const handleRequest = async (sock: Socket, req: DaemonRequest): Promise<void> => {
      if (shuttingDown && req.type !== 'ping' && req.type !== 'shutdown') {
        reply(sock, { type: 'error', message: 'Daemon is shutting down' });
        return;
      }
      if (isDaemonJobRequest(req)) {
        try {
          assertJobsAvailable();
          const response = handleDaemonJobRequest(req, jobs, jobResolver);
          if (response) reply(sock, response);
        } catch (err) {
          reply(sock, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      switch (req.type) {
        case 'ping':
          reply(sock, { type: 'pong', sessionId, uptime: Date.now() - startedAtMs, capabilities: ['jobs-v1'] });
          return;
        case 'shutdown':
          shuttingDown = true;
          lifetime.abort(new Error('daemon shutting down'));
          reply(sock, { type: 'bye' });
          // Give the bye a tick to flush to the socket before we tear down.
          setTimeout(() => { void cleanup(); }, 10);
          return;
        case 'prompt': {
          assertHostCurrent();
          assertProcessSurfaceAvailable('cli', 'daemon');
          if (activeTurn) { reply(sock, { type: 'busy' }); return; }
          try {
            activeTurn = runHeadlessTurn(sessionId, req.text, registry, cwd, lifetime.signal);
            const seq = await activeTurn;
            reply(sock, { type: 'ack', seq });
          } catch (err) {
            reply(sock, { type: 'error', message: err instanceof Error ? err.message : String(err) });
          } finally {
            activeTurn = undefined;
          }
          return;
        }
        case 'error':
          reply(sock, { type: 'error', message: req.message });
          return;
        default:
          reply(sock, { type: 'error', message: 'unhandled request' });
      }
    };
  
    // A client must never grow the daemon's memory unbounded by streaming
    // bytes with no newline. The configured frame bound drops the connection.
  
    const server: Server = createServer((sock: Socket) => {
      sock.setEncoding('utf-8');
      openSockets.add(sock);
      let buffer = '';
      sock.on('data', (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > jobConfig.daemonFrameMaxBytes) {
          // Oversized un-framed input — refuse and hang up rather than grow.
          try { sock.write(encodeDaemonResponse({ type: 'error', message: 'frame too large' })); } catch { /* best-effort */ }
          try { sock.destroy(); } catch { /* best-effort */ }
          return;
        }
        const { lines, rest } = splitFrames(buffer);
        buffer = rest;
        for (const line of lines) {
          const req = parseDaemonRequest(line);
          // .catch() so a rejection inside the async handler can never become
          // an unhandledRejection that crashes the daemon (review: void-promise).
          if (req) void handleRequest(sock, req).catch((err) => {
            try { reply(sock, { type: 'error', message: err instanceof Error ? err.message : String(err) }); } catch { /* best-effort */ }
          });
        }
      });
      sock.on('error', () => { /* a client hangup is not the daemon's problem */ });
      sock.on('close', () => { openSockets.delete(sock); });
    });
  
    server.on('error', (err: NodeJS.ErrnoException) => {
      // A failed bind owns no shared files. Preserve the existing server.
      console.warn(`[agond] socket server error: ${err.message}`);
      void cleanup(err);
    });
  
    // Clean shutdown on the usual signals so a `kill` (stop's SIGTERM fallback)
    // still removes the socket + pidfile.
    const onSignal = (): void => { void cleanup(); };
    const onAbort = (): void => { void cleanup(); };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
  
    try {
      server.listen(socketPath(), () => {
        ownsSocket = true;
        if (shuttingDown) {
          try { server.close(); } catch { /* already closed */ }
          return;
        }
        // Jobs can mutate a workspace, so a socket permission failure is fatal.
        try { chmodSync(socketPath(), 0o600); }
        catch (err) {
          console.warn(`[agond] cannot secure socket: ${err instanceof Error ? err.message : String(err)}`);
          void cleanup(new Error(`Cannot secure daemon socket: ${err instanceof Error ? err.message : String(err)}`));
          return;
        }
        writePidFile({ ...pidInfo, ready: true });
        try { writeFileSync(heartbeatPath(), ''); } catch { /* best-effort */ }
        heartbeat = setInterval(() => {
          try { utimesSync(heartbeatPath(), new Date(), new Date()); }
          catch { try { writeFileSync(heartbeatPath(), ''); } catch { /* best-effort */ } }
        }, HEARTBEAT_MS);
        heartbeat.unref();
      });
    } catch (err) {
      console.warn(`[agond] listen failed: ${err instanceof Error ? err.message : String(err)}`);
      void cleanup(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export const daemonCommand: any = defineCommand({
  ...daemonCliCommand,
  async run({ args }: { args: { action?: string; foreground?: boolean } }) {
    await controller.runCommand(args);
  },
});
