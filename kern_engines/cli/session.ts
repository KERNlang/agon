// Generic TS shell that drives a Python pty daemon.
//
// One subprocess per session, JSON-NDJSON over stdin/stdout. Adding a new
// engine on the Python side (configs.REGISTRY) is enough — TS just passes
// the engine id through. No native deps, no terminal emulator.

import {
  spawn as spawnProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createInterface, type Interface as Readline } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

export class PtySessionError extends Error {
  readonly kind: 'spawn' | 'protocol' | 'timeout' | 'engine';
  constructor(kind: 'spawn' | 'protocol' | 'timeout' | 'engine', message: string) {
    super(message);
    this.name = 'PtySessionError';
    this.kind = kind;
  }
}

export type SessionMode = 'exec' | 'agent';

export interface SpawnOptions {
  cols?: number;
  rows?: number;
  pythonBin?: string;     // override "python3" if needed
  daemonTimeoutMs?: number; // hard ceiling on "ready" handshake (default 35s)
  mode?: SessionMode;     // exec (default) or agent (tools + bypass perms)
  /** Working directory for the daemon (and therefore the engine TUI).
   * Defaults to the parent process cwd. Important for agon worktree
   * dispatches — without this, the engine starts in the wrong repo and
   * file edits land outside the intended workspace. */
  cwd?: string;
  /** Extra env vars merged into the daemon's environment. */
  env?: Record<string, string>;
  /** Extra launch flags appended after the engine's config argv — agon uses
   * this to forward a /models model/effort pick (e.g. ['--model','opus',
   * '--effort','high']) to the interactive path, matching the --print fallback.
   * Empty → the engine uses its own config. */
  extraArgv?: string[];
}

interface PendingReply {
  resolve: (text: string) => void;
  reject: (err: PtySessionError) => void;
  onChunk?: (delta: string) => void;
}

type DaemonMessage =
  | { type: 'ready'; engine: string }
  | { type: 'chunk'; id: number; delta: string }
  | {
      type: 'reply';
      id: number;
      ok: true;
      text: string;
    }
  | {
      type: 'reply';
      id: number;
      ok: false;
      kind?: 'timeout' | 'error';
      error: string;
    };

export class PtyCliSession {
  private nextId = 1;
  private readonly pending = new Map<number, PendingReply>();
  private readonly stderrBuf: string[] = [];
  private closed = false;
  private busy = false;
  private readonly readyPromise: Promise<void>;

  private constructor(
    private readonly engineId: string,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly rl: Readline,
  ) {
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    this.readyPromise = new Promise<void>((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });

    rl.on('line', (line) => this.onLine(line, readyResolve));
    child.on('exit', (code, signal) => {
      const detail = `daemon exited code=${code} signal=${signal}`;
      this.failAllPending(new PtySessionError('engine', detail));
      if (!this.closed) {
        readyReject(new PtySessionError('engine', detail));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuf.push(chunk);
      // keep last ~4KB so error messages have useful context
      let total = this.stderrBuf.reduce((n, s) => n + s.length, 0);
      while (total > 4096 && this.stderrBuf.length > 1) {
        total -= this.stderrBuf.shift()!.length;
      }
    });
  }

  static async spawn(engineId: string, opts: SpawnOptions = {}): Promise<PtyCliSession> {
    const py = opts.pythonBin ?? 'python3';
    const args = ['-u', '-m', 'kern_engines.cli.daemon', engineId];
    if (opts.cols) args.push('--cols', String(opts.cols));
    if (opts.rows) args.push('--rows', String(opts.rows));
    if (opts.mode) args.push('--mode', opts.mode);
    // `--extra-arg=VALUE` (not space-separated) so argparse accepts values that
    // themselves start with '-' (e.g. '--model'), which it would otherwise treat
    // as an option and reject with exit code 2.
    for (const a of opts.extraArgv ?? []) args.push(`--extra-arg=${a}`);

    let child: ChildProcessWithoutNullStreams;
    try {
      const env = opts.env
        ? { ...process.env, ...opts.env } as Record<string, string>
        : process.env as Record<string, string>;
      child = spawnProcess(py, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: opts.cwd ?? process.cwd(),
        env,
      });
    } catch (e) {
      throw new PtySessionError(
        'spawn',
        `failed to spawn ${py}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const rl = createInterface({ input: child.stdout });
    const session = new PtyCliSession(engineId, child, rl);

    const timeoutMs = opts.daemonTimeoutMs ?? 35_000;
    const handshake = withTimeout(session.readyPromise, timeoutMs, 'daemon ready');
    try {
      await handshake;
    } catch (e) {
      session.killImmediate();
      if (e instanceof PtySessionError) throw e;
      throw new PtySessionError('timeout', String(e));
    }
    return session;
  }

  async ask(prompt: string, timeoutMs = 60_000): Promise<string> {
    if (this.closed) {
      throw new PtySessionError('engine', 'session is closed');
    }
    if (this.busy) {
      throw new PtySessionError(
        'engine',
        'session is busy (concurrent ask() forbidden)',
      );
    }
    this.busy = true;
    const id = this.nextId++;
    try {
      const replyText = await new Promise<string>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        const msg = JSON.stringify({
          id,
          type: 'ask',
          prompt,
          timeout: timeoutMs / 1000,
        }) + '\n';
        if (!this.child.stdin.write(msg)) {
          this.child.stdin.once('drain', () => undefined);
        }
        // Per-call ceiling slightly above the engine-side timeout to allow
        // for IPC overhead.
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new PtySessionError(
              'timeout',
              `daemon did not reply within ${timeoutMs + 2000}ms`,
            ));
          }
        }, timeoutMs + 2000).unref();
      });
      return replyText;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Send a prompt and stream response deltas as they arrive.
   *
   * Yields zero or more text chunks; the generator's return value is the
   * clean final response (whatever ``ask()`` would have returned). The
   * sum of yielded chunks may include noisy TUI redraws — prefer the
   * return value when you want a clean answer.
   */
  async *askStream(
    prompt: string, timeoutMs = 60_000,
  ): AsyncGenerator<string, string, void> {
    if (this.closed) {
      throw new PtySessionError('engine', 'session is closed');
    }
    if (this.busy) {
      throw new PtySessionError(
        'engine',
        'session is busy (concurrent ask() forbidden)',
      );
    }
    this.busy = true;
    const id = this.nextId++;
    const queue: string[] = [];

    // Single-slot waiter: anyone pushing to the queue or settling the
    // reply wakes the consumer via `signal`. The consumer always
    // re-checks the queue and reply state after waking — no chunk can be
    // lost between "queue.push" and "consumer waits", because the
    // consumer atomically swaps in a new waiter before awaiting again.
    let signal: (() => void) | null = null;
    const wake = () => {
      const s = signal;
      if (s) {
        signal = null;
        s();
      }
    };

    let replyResolve!: (text: string) => void;
    let replyReject!: (err: PtySessionError) => void;
    const replyPromise = new Promise<string>((res, rej) => {
      replyResolve = res;
      replyReject = rej;
    });
    type ReplyState = { ok: true; text: string } | { ok: false; err: PtySessionError };
    let replyState: ReplyState | null = null;
    replyPromise.then(
      (text) => { replyState = { ok: true, text }; wake(); },
      (err) => {
        const e = err instanceof PtySessionError
          ? err
          : new PtySessionError('engine', String(err));
        replyState = { ok: false, err: e };
        wake();
      },
    );

    this.pending.set(id, {
      resolve: replyResolve,
      reject: replyReject,
      onChunk: (delta: string) => {
        queue.push(delta);
        wake();
      },
    });

    const msg = JSON.stringify({
      id, type: 'ask_stream', prompt, timeout: timeoutMs / 1000,
    }) + '\n';
    if (!this.child.stdin.write(msg)) {
      this.child.stdin.once('drain', () => undefined);
    }
    const ceiling = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        replyReject(new PtySessionError(
          'timeout',
          `daemon did not reply within ${timeoutMs + 2000}ms`,
        ));
      }
    }, timeoutMs + 2000);
    ceiling.unref();

    try {
      while (true) {
        // Drain anything already queued.
        while (queue.length > 0) yield queue.shift()!;
        // If reply already settled, finish loop. Drain once more first
        // in case a chunk landed alongside the reply.
        const settled = replyState as ReplyState | null;
        if (settled !== null) {
          while (queue.length > 0) yield queue.shift()!;
          if (settled.ok) return settled.text;
          throw settled.err;
        }
        // Wait for the next event (chunk arrival or reply settle).
        await new Promise<void>((res) => { signal = res; });
      }
    } finally {
      clearTimeout(ceiling);
      this.pending.delete(id);
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.child.stdin.writable) {
        this.child.stdin.write(JSON.stringify({ id: 0, type: 'close' }) + '\n');
        this.child.stdin.end();
      }
    } catch {
      /* best-effort */
    }
    // give the daemon up to 1s to exit cleanly before SIGTERM
    const deadline = Date.now() + 1000;
    while (this.child.exitCode === null && Date.now() < deadline) {
      await delay(50);
    }
    if (this.child.exitCode === null) {
      this.killImmediate();
    }
  }

  private killImmediate(): void {
    try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      if (this.child.exitCode === null) {
        try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 500).unref();
  }

  private failAllPending(err: PtySessionError): void {
    for (const [id, p] of this.pending) {
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private onLine(line: string, readyResolve: () => void): void {
    if (!line.trim()) return;
    let msg: DaemonMessage;
    try {
      msg = JSON.parse(line) as DaemonMessage;
    } catch {
      // garbled — likely a debug print. ignore.
      return;
    }
    if (msg.type === 'ready') {
      readyResolve();
      return;
    }
    if (msg.type === 'chunk') {
      const pending = this.pending.get(msg.id);
      if (!pending || !pending.onChunk) return;
      pending.onChunk(msg.delta);
      return;
    }
    if (msg.type === 'reply') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.text);
      } else {
        const kind = msg.kind === 'timeout' ? 'timeout' : 'engine';
        pending.reject(new PtySessionError(kind, msg.error));
      }
    }
  }

  // exposed for diagnostics
  get id(): string { return this.engineId; }
  get stderrTail(): string { return this.stderrBuf.join(''); }
}

async function withTimeout<T>(
  p: Promise<T>, ms: number, label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(
          () => rej(new PtySessionError('timeout', `${label}: exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
