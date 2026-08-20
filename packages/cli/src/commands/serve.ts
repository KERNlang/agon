import { defineCommand } from 'citty';

import { ensureAgonHome, eventLogFlush } from '@kernlang/agon-core';

import type { BrainClient } from '@kernlang/agon-core';

import type { AgonServe } from '../bridge/agon-serve.js';

import { resolveServeEngine, parseOrigins, recordServeReady, writeServeConnectionFile, removeServeConnectionFile, buildServeRuntime, emitServeConnectionLine } from '../bridge/serve-runtime.js';

import { header, info, success, warn, bold, dim, green, cyan, yellow } from '../blocks/output-format.js';

/**
 * Print the connection card once: URL, bearer token, the 0600 connection-file path, owned session + engine, allowed Origins, and ready-to-paste attach/smoke hints. Warns loudly when the allowlist is empty (no browser can connect until you pass --origin).
 */
function printServeBanner(url: string, token: string, tokenPath: string, sessionId: string, engineId: string, allowedOrigins: string[]): void {
  header('agon serve — bridge up');
  info(`  ${bold('url')}      ${cyan(url)}`);
  info(`  ${bold('token')}    ${green(token)}`);
  info(`  ${bold('file')}     ${dim(tokenPath)}`);
  info(`  ${bold('session')}  ${cyan(sessionId)}  ${dim(`(engine ${engineId})`)}`);
  if (allowedOrigins.length > 0) {
    info(`  ${bold('origins')}  ${allowedOrigins.join(', ')}`);
  } else {
    info(`  ${bold('origins')}  ${yellow('none')} ${dim('— no browser can connect; pass --origin <url> to allow one')}`);
  }
  console.log('');
  info(dim(`  attach   agon attach --self ${sessionId}`));
  info(dim(`  smoke    curl -N -H "Authorization: Bearer ${token}" "${url}/events?from=0"`));
  info(dim('  Ctrl+C to stop.'));
}

/**
 * The foreground command: resolve + validate the engine, assemble the runtime, bind the loopback port, write the 0600 connection file, record the ready/provenance frame, print the connection card, then HOLD the process open until Ctrl+C / SIGTERM — on which it tears down in order (serve.close stops intake + ends SSE → brain.close aborts any in-flight turn → flush ledger → remove the connection file) and resolves. An engine/bind failure sets exit code 2 and returns without starting. stdin is resumed to keep the event loop alive (the bridge's timers are unref'd), then restored on exit, mirroring `agon attach`'s follow loop.
 */
export async function runServe(port: number, engine: string|undefined, allowedOrigins: string[], emitConnection: boolean): Promise<void> {
  ensureAgonHome();
  const cwd = process.cwd();
  const engineId = resolveServeEngine(engine, cwd);
  
  let runtime: { serve: AgonServe; brain: BrainClient; sessionId: string; engineId: string };
  try {
    runtime = await buildServeRuntime({ engineId, cwd, allowedOrigins });
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
    return;
  }
  
  // Bind + post-bind setup, guarded: a listen failure (EADDRINUSE on a pinned
  // --port — AgonServe.start rejects) or a post-bind write failure must NOT leak
  // the already-opened brain (an engine subprocess) or leave a half-open bridge
  // with no valid handoff file. Tear down everything acquired so far and fail
  // CLOSED (exit 2), never an unhandled-rejection crash.
  let started: Awaited<ReturnType<typeof runtime.serve.start>>;
  let tokenPath: string;
  try {
    started = await runtime.serve.start(port);
    tokenPath = writeServeConnectionFile(runtime.sessionId, started.url, started.token, engineId, allowedOrigins);
    // Record the provenance frame BEFORE handing out the URL: a client that reads the
    // machine-readable line and immediately attaches must find the "which brain @ where"
    // frame already in the ledger (the documented verify-before-you-send invariant).
    recordServeReady(runtime.sessionId, engineId, started.url, allowedOrigins);
  } catch (err) {
    warn(`failed to start: ${err instanceof Error ? err.message : String(err)}`);
    try { await runtime.serve.close(); } catch { /* may never have bound */ }
    try { await runtime.brain.close(); } catch { /* best-effort */ }
    removeServeConnectionFile(runtime.sessionId);
    try { eventLogFlush(runtime.sessionId); } catch { /* best-effort */ }
    process.exitCode = 2;
    return;
  }
  
  const stopped = new Promise<void>((resolve) => {
    let tornDown = false;
    const teardown = (): void => {
      if (tornDown) return;
      tornDown = true;
      process.removeListener('SIGINT', teardown);
      process.removeListener('SIGTERM', teardown);
      console.log(dim('\n— stopping —'));
      // Stop intake FIRST (serve.close stops accepting + ends every SSE stream),
      // THEN abort any in-flight turn (brain.close), THEN flush + remove the
      // connection file. Order matters: no new turn can start once intake is shut.
      void Promise.resolve()
        .then(() => runtime.serve.close())
        .then(() => runtime.brain.close())
        .catch((err) => { warn(`shutdown: ${err instanceof Error ? err.message : String(err)}`); })
        .finally(() => {
          try { eventLogFlush(runtime.sessionId); } catch { /* best-effort */ }
          removeServeConnectionFile(runtime.sessionId);
          try { process.stdin.pause(); } catch { /* best-effort */ }
          success('agon serve stopped.');
          resolve();
        });
    };
    // Keep Node alive until a stop signal (bridge timers are unref'd). A resumed
    // stdin is the idiomatic interactive-CLI hold; restored on teardown.
    try { process.stdin.resume(); } catch { /* non-tty / closed stdin */ }
    process.on('SIGINT', teardown);
    process.on('SIGTERM', teardown);
  });
  // Install the stop handlers before the machine-readable readiness line.
  // A controller can send SIGINT as soon as it reads this line.
  if (emitConnection) emitServeConnectionLine(started.url, started.token, runtime.sessionId, engineId, allowedOrigins, tokenPath);
  printServeBanner(started.url, started.token, tokenPath, runtime.sessionId, engineId, allowedOrigins);
  await stopped;
}

export const serveCommand: any = defineCommand({
  meta: {
    name: 'serve',
    description: 'Launch the loopback HTTP bridge so a browser extension / desktop can attach to one agon session (Agon Everywhere MVP)',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port to bind on 127.0.0.1 (default: 0 = ephemeral, printed on start)',
      required: false,
    },
    engine: {
      type: 'string',
      alias: 'e',
      description: 'Engine that answers a served turn (default: configured cesarEngine, else claude)',
      required: false,
    },
    origin: {
      type: 'string',
      alias: 'o',
      description: 'Allowed browser Origin(s) — comma-separated or repeated. Empty = no browser connects (deny-by-default).',
      required: false,
    },
    session: {
      type: 'string',
      description: 'RESERVED — binding an existing session is not supported in v1 (would split-brain writes). Lands as read-only tail later.',
      required: false,
    },
    'emit-connection': {
      type: 'boolean',
      description: 'Print one machine-readable __AGON_CONNECTION__ {json} line on ready (for the native-messaging host). Off by default.',
      required: false,
    },
  },
  async run({ args }: { args: { port?: string; engine?: string; origin?: string | string[]; session?: string; 'emit-connection'?: boolean } }) {
    ensureAgonHome();
    // --session is reserved + refused in v1 (the brainstorm's FORK-1 verdict):
    // a browser turn on an existing session would be answered by THIS single-
    // engine brain, not that session's live Cesar — a split-brain write bug.
    if (typeof args.session === 'string' && args.session.trim()) {
      warn(`--session is reserved but not supported yet: a served turn would be answered by serve's single-engine brain, not session "${args.session.trim()}"'s live Cesar (a split-brain write).`);
      info(dim('  v1 serves a fresh session only; read-only tail of an existing session lands with the full headless Cesar host.'));
      process.exitCode = 2;
      return;
    }
    const rawPort = typeof args.port === 'string' ? Number(args.port) : 0;
    const validPort = Number.isFinite(rawPort) && rawPort >= 0 && rawPort <= 65535;
    if (typeof args.port === 'string' && !validPort) {
      warn(`Invalid --port "${args.port}" — using an ephemeral port instead.`);
    }
    const port = validPort ? Math.floor(rawPort) : 0;
    const allowedOrigins = parseOrigins(args.origin);
    await runServe(port, args.engine, allowedOrigins, args['emit-connection'] === true);
  },
});
