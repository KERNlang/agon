// Claude pty-driven session, TS surface.
//
// Engine-specific config lives in kern_engines/cli/configs.py. This module
// is intentionally a thin wrapper so new engines can ship by writing one
// EngineConfig in Python and one wrapper file like this one in TS.

import {
  PtyCliSession,
  PtySessionError,
  type SpawnOptions,
} from './session.js';

export {
  PtySessionError as ClaudeSessionError,
  // back-compat alias — same class, distinguish kind === 'timeout' for the
  // timeout case
};
export class ClaudeSessionTimeout extends PtySessionError {}

export interface ClaudeSpawnOptions extends SpawnOptions {
  // currently nothing claude-specific — kept for future tuning
}

export class ClaudeCliSession {
  private constructor(private readonly inner: PtyCliSession) {}

  static async spawn(opts: ClaudeSpawnOptions = {}): Promise<ClaudeCliSession> {
    const inner = await PtyCliSession.spawn('claude', opts);
    return new ClaudeCliSession(inner);
  }

  ask(prompt: string, timeoutMs = 60_000): Promise<string> {
    return this.inner.ask(prompt, timeoutMs);
  }

  askStream(prompt: string, timeoutMs = 60_000): AsyncGenerator<string, string, void> {
    return this.inner.askStream(prompt, timeoutMs);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

// Convenience for adapter-cli's "one-shot" path: spawn → ask → close.
// Used when a caller just wants a single round-trip and doesn't want to
// manage the session lifecycle themselves.
export async function askOnce(
  prompt: string,
  opts: ClaudeSpawnOptions & { timeoutMs?: number } = {},
): Promise<string> {
  const session = await ClaudeCliSession.spawn(opts);
  try {
    return await session.ask(prompt, opts.timeoutMs ?? 60_000);
  } finally {
    await session.close();
  }
}
