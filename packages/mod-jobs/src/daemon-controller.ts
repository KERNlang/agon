import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, lstatSync, openSync, closeSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { spawn } from 'node:child_process';

/** CLI bindings. The controller uses the current Node process, filesystem, and diagnostic streams. */
export interface DaemonControllerHost {
  assertAvailable?(): void;
  daemonDirectory(): string;
  ensureHome(): void;
  runServer(signal?: AbortSignal): Promise<void>;
  ping(): Promise<{ type: 'pong'; sessionId: string; uptime: number } | null>;
  shutdown(): Promise<{ type: 'bye' } | null>;
  spawn: typeof spawn;
  output: {
    header(text: string): void; info(text: string): void; success(text: string): void; warn(text: string): void;
    bold(text: string): string; dim(text: string): string; green(text: string): string;
    cyan(text: string): string; yellow(text: string): string; red(text: string): string;
  };
}



/**
 * Process identity and readiness are published after listen and permission
 * setup. Older pidfiles lack the readiness field;
 * status and stop still use their identity and the live socket probe.
 */
export interface DaemonPidInfo {
  pid: number;
  sessionId: string;
  startedAt: string;
  /** Published only after the socket is listening and its permissions are set. */
  ready?: boolean;
}


/**
 * A live socket prevents startup. A hung process or changed ownership also
 * prevents startup. staleCleaned means this probe removed stale files.
 */
export interface DaemonLiveness {
  live: boolean;
  hung?: boolean;
  pid?: number;
  sessionId?: string;
  staleCleaned: boolean;
}


/**
 * How often the running daemon touches the heartbeat file's mtime. 2s, matching the spec; the timer is unref'd so it never keeps the process alive past its real work.
 */
export const HEARTBEAT_MS: number = 2000;


/**
 * A daemon whose heartbeat mtime is older than this is considered DEAD by `status` even if its pid still kill(0)-checks (e.g. hung). 5s = > 2 missed beats.
 */
export const HEARTBEAT_STALE_MS: number = 5000;


/**
 * How long a client waits for a {type:'pong'} (or any reply) before declaring the socket unreachable. Bounds `status`/`stop`/stale-probe so a wedged socket never hangs the CLI.
 */
export const PING_TIMEOUT_MS: number = 1500;
export function createDaemonController(host: DaemonControllerHost) {
  const { header, info, success, warn, bold, dim, green, cyan, yellow, red } = host.output;
  const check = () => host.assertAvailable?.();


  /**
   * The $AGON_HOME/daemon/ directory that holds the pidfile, heartbeat, and socket. Resolved at call time (not a frozen const) so a test that sets AGON_HOME after module load points the daemon at its temp home.
   */
  function daemonDir(): string {
    return host.daemonDirectory();
  }


  /**
   * Path to the daemon pidfile ($AGON_HOME/daemon/agond.pid). Holds JSON { pid, sessionId, startedAt } so `status`/`stop` can find the process AND name its session without opening the socket.
   */
  function pidFilePath(): string {
    return join(daemonDir(), 'agond.pid');
  }


  /**
   * Path to the heartbeat file ($AGON_HOME/daemon/heartbeat). The server touches its mtime every HEARTBEAT_MS; `status` reads the mtime age to decide liveness even if the socket is wedged.
   */
  function heartbeatPath(): string {
    return join(daemonDir(), 'heartbeat');
  }


  /**
   * Path to the unix domain socket the daemon listens on ($AGON_HOME/daemon/agond.sock). Newline-JSON protocol (see daemon-protocol.kern). Cleaned on clean exit; a stale file from a crash is probed-then-removed on the next start/stop.
   */
  function socketPath(): string {
    return join(daemonDir(), 'agond.sock');
  }


  /**
   * Parse the pidfile into { pid, sessionId, startedAt }, or null when it is absent/unreadable/malformed. Never throws — a corrupt pidfile reads as 'no daemon' so stale-takeover can clean it.
   */
  function readPidFile(): DaemonPidInfo | null {
    try {
      const raw = readFileSync(pidFilePath(), 'utf-8');
      const obj = JSON.parse(raw) as Partial<DaemonPidInfo>;
      if (typeof obj?.pid !== 'number' || !Number.isFinite(obj.pid)) return null;
      return {
        pid: obj.pid,
        sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
        startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : '',
        ...(typeof obj.ready === 'boolean' ? { ready: obj.ready } : {}),
      };
    } catch {
      return null;
    }
  }


  /**
   * Publish one complete PID record by rename. A failed write retains the old
   * record and reports the error. This does not promise power-loss durability.
   */
  function writePidFile(info: DaemonPidInfo): void {
    let temporary: string | undefined;
    try {
      const target = pidFilePath();
      mkdirSync(dirname(target), { recursive: true });
      const candidate = `${target}.${randomUUID()}.tmp`;
      const fd = openSync(candidate, 'wx', 0o600);
      temporary = candidate;
      try {
        writeFileSync(fd, JSON.stringify(info, null, 2) + '\n');
      } finally {
        closeSync(fd);
      }
      renameSync(candidate, target);
    } catch (err) {
      console.warn(`[agond] could not write pidfile: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (temporary) {
        try { rmSync(temporary, { force: true }); }
        catch (err) { console.warn(`[agond] could not remove staged pidfile: ${err instanceof Error ? err.message : String(err)}`); }
      }
    }
  }


  /**
   * True if a process with this pid exists and is signalable by us (kill(pid, 0) does not actually send a signal — it only checks existence/permission). EPERM means the process EXISTS but we can't signal it → still alive. ESRCH means it's gone. A non-finite/<=0 pid is dead.
   */
  function isProcessAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM: the process exists but is owned by another user — alive.
      // ESRCH: no such process — dead.
      return (err as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }


  /**
   * Milliseconds since the heartbeat file was last touched, or Infinity when it's absent/unreadable (treated as maximally stale). `status` compares this against HEARTBEAT_STALE_MS to catch a hung daemon whose pid still exists.
   */
  function heartbeatAgeMs(): number {
    try {
      const st = statSync(heartbeatPath());
      return Date.now() - st.mtimeMs;
    } catch {
      return Infinity;
    }
  }


  function ownershipFiles(): readonly (string | null)[] {
    return [pidFilePath(), socketPath()].map(path => {
      try {
        const stat = lstatSync(path, { bigint: true });
        return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    });
  }

  function ownershipUnchanged(before: readonly (string | null)[], allowRemoval = false): boolean {
    return ownershipFiles().every((current, index) => current === before[index] || (allowRemoval && current === null));
  }

  /** Preserve files when a live socket answers or ownership changes during a probe. */
  async function probeDaemon(): Promise<DaemonLiveness> {
    check();
    const before = ownershipFiles();
    const info = readPidFile();
    const alive = info !== null && isProcessAlive(info.pid);
    const pong = alive || before[1] !== null ? await host.ping() : null;
    check();
    if (!ownershipUnchanged(before)) {
      if (ownershipFiles().every(stamp => stamp === null)) {
        return { live: false, staleCleaned: false };
      }
      return { live: false, hung: true, staleCleaned: false };
    }
    if (pong?.type === 'pong') {
      return {
        live: true,
        ...(alive && info?.sessionId === pong.sessionId ? { pid: info.pid } : {}),
        sessionId: pong.sessionId,
        staleCleaned: false,
      };
    }
    if (alive && info) {
      return { live: false, hung: true, pid: info.pid, sessionId: info.sessionId, staleCleaned: false };
    }
    const staleCleaned = before.some(stamp => stamp !== null);
    if (staleCleaned) {
      rmSync(pidFilePath(), { force: true });
      rmSync(socketPath(), { force: true });
    }
    return { live: false, ...(info ? { pid: info.pid, sessionId: info.sessionId } : {}), staleCleaned };
  }


  /**
   * Start the daemon. In --foreground (also the internal `daemon run` mode) this RUNS the server loop in THIS process (awaits runDaemonServer, never returns until shutdown). Otherwise it RE-SPAWNS this binary as `daemon run --foreground` with detached:true + stdio:'ignore' + unref(), so the child outlives this launcher and the terminal — then prints the session id + attach hint and returns. Refuses to start over a LIVE daemon (prints status); cleans a STALE pidfile/socket first (stale-takeover).
   */
  async function startDaemon(foreground: boolean, options: { quiet?: boolean } = {}): Promise<void> {
    check();
    const silent = () => { };
    const report = options.quiet ? { info: silent, warn: silent, success: silent } : { info, warn, success };
    host.ensureHome();
    mkdirSync(daemonDir(), { recursive: true });

    if (foreground) {
      // We ARE the daemon. Run the server loop until shutdown.
      await host.runServer();
      check();
      return;
    }

    // Stale-takeover gate: refuse over a live OR hung daemon, clean a dead one.
    const probe = await probeDaemon();
    check();
    if (probe.live) {
      report.warn('A daemon is already running.');
      report.info(dim(`  pid ${probe.pid ?? '?'} · session ${probe.sessionId ?? '?'}`));
      report.info(dim('  Stop it with `agon daemon stop`, or attach with ' + (probe.sessionId ? `\`agon attach --self ${probe.sessionId}\`` : '`agon attach --self`')));
      return;
    }
    if (probe.hung) {
      if (probe.pid === undefined) {
        report.warn('Daemon ownership changed during the check. Retry `agon daemon start`.');
        return;
      }
      // A pid is ALIVE but its socket doesn't answer (hung or still booting).
      // Refuse rather than spawn a SECOND daemon over a running pid (review #1
      // blocking): two daemons would race the same pidfile/heartbeat/socket.
      report.warn('A daemon process is alive but not answering its socket.');
      report.info(dim(`  pid ${probe.pid ?? '?'} · session ${probe.sessionId ?? '?'}`));
      report.info(dim('  If it is wedged, `agon daemon stop` will terminate it; then start again.'));
      return;
    }
    if (probe.staleCleaned) {
      report.info(dim('Cleaned up a stale daemon (pidfile/socket) before starting.'));
    }

    // Re-spawn THIS binary as the detached daemon. process.argv[1] is the CLI
    // entry (dist/index.js); execPath is the node binary. detached + stdio
    // 'ignore' + unref() = the child has its own session leader and is not tied
    // to our stdio or lifetime.
    const entry = process.argv[1] ? resolve(process.argv[1]) : '';
    if (!entry) throw new Error('Cannot start daemon: CLI entry path is unavailable');
    check();
    const child = host.spawn(process.execPath, [entry, 'daemon', 'run', '--foreground'], {
      detached: true,
      stdio: 'ignore',
      // Carry AGON_HOME explicitly so a test's temp home reaches the child even
      // if the inherited env somehow lost it; harmless in production.
      env: { ...process.env },
    });
    // Surface a spawn failure (bad execPath / ENOENT) instead of silently
    // swallowing it — otherwise the poll below just times out into a misleading
    // "has not reported a session yet" (review: no child error handler).
    const spawnErr: { msg: string | null } = { msg: null };
    child.on('error', (err: Error) => { spawnErr.msg = err.message; });
    child.unref();

    // The initial PID proves process ownership, not readiness. Wait for this
    // child's post-listen publication within the existing startup budget.
    let info0: DaemonPidInfo | null = null;
    let ready = false;
    for (let i = 0; i < 40; i += 1) {
      check();
      if (spawnErr.msg) break;
      info0 = readPidFile();
      ready = !!info0 && info0.pid === child.pid && info0.ready === true && isProcessAlive(info0.pid);
      if (ready) break;
      await new Promise<void>((r) => { setTimeout(r, 50); });
    }

    check();
    if (spawnErr.msg) {
      // The child process couldn't be spawned at all (e.g. bad entry path).
      console.error(red(`Failed to start daemon: ${spawnErr.msg}`));
      return;
    }
    if (ready && info0?.sessionId) {
      report.success('agond started.');
      report.info(`  ${bold('session')}  ${cyan(info0.sessionId)}  ${dim(`(pid ${info0.pid})`)}`);
      report.info(`  ${bold('attach')}   ${dim(`agon attach --self ${info0.sessionId}`)}`);
      report.info(`  ${bold('stop')}     ${dim('agon daemon stop')}`);
    } else {
      // A booting or failed child is not a ready daemon.
      report.warn('Started a detached daemon but its socket is not ready.');
      report.info(dim('  Check `agon daemon status` in a moment.'));
    }
  }


  /**
   * Report whether a daemon is running for this AGON_HOME and how healthy it is, across THREE independent signals: the pidfile pid (kill -0 alive?), the heartbeat mtime freshness (< HEARTBEAT_STALE_MS?), and a live socket ping (pong?). Prints the owned session id + an attach hint when up. Does NOT clean stale files — it's read-only diagnosis (start/stop own the cleanup).
   */
  async function daemonStatus(): Promise<void> {
    check();
    host.ensureHome();
    const info = readPidFile();
    header('agond status');
    if (!info) {
      if (existsSync(socketPath())) {
        const pong = await host.ping();
        check();
        if (pong && pong.type === 'pong') {
          success('running (socket only — no pidfile)');
          info0(`  session ${cyan(pong.sessionId)} · uptime ${formatUptime(pong.uptime)}`);
          return;
        }
      }
      info0(dim('not running.'));
      info0(dim('  Start it with `agon daemon start`.'));
      return;
    }

    const alive = isProcessAlive(info.pid);
    const hbAge = heartbeatAgeMs();
    const hbFresh = hbAge < HEARTBEAT_STALE_MS;
    const pong = await host.ping();
    check();
    const answering = !!(pong && pong.type === 'pong');

    const line = (label: string, ok: boolean, detail: string): void => {
      info0(`  ${ok ? green('●') : red('○')} ${bold(label.padEnd(10))} ${ok ? green(detail) : yellow(detail)}`);
    };
    line('process', alive, alive ? `pid ${info.pid} alive` : `pid ${info.pid} dead`);
    line('heartbeat', hbFresh, hbFresh ? `${Math.round(hbAge)}ms ago` : (Number.isFinite(hbAge) ? `stale (${Math.round(hbAge)}ms)` : 'absent'));
    line('socket', answering, answering ? 'answering' : 'no reply');

    if (alive && answering) {
      const sid = (pong && pong.type === 'pong' && pong.sessionId) ? pong.sessionId : info.sessionId;
      const up = (pong && pong.type === 'pong') ? formatUptime(pong.uptime) : '?';
      console.log('');
      success(`running · session ${cyan(sid)} · uptime ${up}`);
      info0(dim(`  attach with \`agon attach --self ${sid}\``));
    } else {
      console.log('');
      warn('not healthy — start may stale-clean and restart it.');
    }
  }


  /**
   * Thin alias for the output-format `info` printer, used inside daemonStatus where a local variable named `info` (the pidfile struct) shadows the imported function.
   */
  function info0(text: string): void {
    info(text);
  }


  /**
   * Render a millisecond uptime as a coarse human string (e.g. '42s', '3m', '2h 5m'). Used by status/pong reporting. Defensive: a non-finite/negative input renders '?'.
   */
  function formatUptime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '?';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }


  /**
   * Stop the daemon. First try a graceful {shutdown} over the socket (the daemon replies {bye} and self-cleans its socket + pidfile). If the socket is unreachable but a pid is alive, fall back to SIGTERM via the pidfile. Then poll until the pid is gone, and finally sweep any leftover socket/pidfile so a crash that left files behind doesn't block the next start. Idempotent: 'stop' with nothing running just reports so.
   */
  async function stopDaemon(): Promise<void> {
    check();
    host.ensureHome();
    const before = ownershipFiles();
    const info = readPidFile();
    const sockExists = existsSync(socketPath());
    if (!info && !sockExists) {
      info0(dim('No daemon running.'));
      return;
    }

    // 1) Graceful shutdown over the socket.
    let acked = false;
    if (sockExists) {
      const bye = await host.shutdown();
      check();
      acked = !!(bye && bye.type === 'bye');
    }

    // The acknowledgement precedes drain. Only the server can release its socket.
    if (acked) {
      for (let i = 0; i < 40; i += 1) {
        check();
        if (!ownershipUnchanged(before, true)) {
          warn('Daemon ownership changed during stop; leaving the current daemon untouched.');
          return;
        }
        if (ownershipFiles().every(stamp => stamp === null)) {
          success('agond stopped (graceful shutdown).');
          return;
        }
        await new Promise<void>(resolve => { setTimeout(resolve, 50); });
      }
      check();
      warn('agond shutdown is still pending; keeping its ownership files.');
      return;
    }

    // Do not signal from an observation that changed during socket shutdown.
    if (!ownershipUnchanged(before)) {
      warn('Daemon ownership changed during stop; leaving the current daemon untouched.');
      return;
    }

    // 2) Fallback SIGTERM if the socket didn't ack but a pid is alive.
    if (info && isProcessAlive(info.pid)) {
      try { process.kill(info.pid, 'SIGTERM'); } catch { /* already gone */ }
    }

    // 3) Wait for the pid to actually exit (bounded), so cleanup doesn't race a
    //    daemon mid-teardown.
    if (info) {
      for (let i = 0; i < 40; i += 1) {
        check();
        if (!isProcessAlive(info.pid)) break;
        await new Promise<void>((r) => { setTimeout(r, 50); });
      }
    }

    check();
    if (info && isProcessAlive(info.pid)) {
      warn('agond shutdown is still pending; keeping its ownership files.');
      return;
    }
    const current = readPidFile();
    if (!ownershipUnchanged(before, true) || (current && (!info || current.pid !== info.pid || current.sessionId !== info.sessionId || current.startedAt !== info.startedAt))) {
      warn('Daemon ownership changed during stop; leaving the current daemon untouched.');
      return;
    }

    // 4) Sweep leftover files (the daemon self-cleans on a graceful exit, but a
    //    SIGKILL'd or crashed one won't — make `stop` idempotent + leave a clean
    //    slate for the next start).
    rmSync(socketPath(), { force: true });
    rmSync(pidFilePath(), { force: true });

    success('agond stopped (signaled / swept).');
  }
  async function runCommand(args: { action?: string; foreground?: boolean }): Promise<void> {
    check();
    host.ensureHome();
    const action = (typeof args.action === 'string' ? args.action : 'status').trim().toLowerCase();
    switch (action) {
      case 'start': await startDaemon(!!args.foreground); break;
      case 'run': await host.runServer(); break;
      case 'stop': await stopDaemon(); break;
      case 'status':
      case '': await daemonStatus(); break;
      default: warn(`Unknown action "${action}". Use: start | stop | status`);
    }
    check();
  }
  return { daemonDir, pidFilePath, heartbeatPath, socketPath, readPidFile, writePidFile, isProcessAlive, heartbeatAgeMs, probeDaemon, startDaemon, daemonStatus, formatUptime, stopDaemon, runCommand };
}
