import { spawn } from 'node:child_process';
import type { DispatchResult } from './types.js';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Timeout in milliseconds. */
  timeout: number;
  env?: Record<string, string>;
}

/**
 * Spawn a process with timeout and proper cleanup.
 * Kills the entire process group on timeout.
 */
export function spawnWithTimeout(opts: SpawnOptions): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }
    }, opts.timeout);

    child.stdout?.on('data', (data) => {
      stdout += String(data);
    });

    child.stderr?.on('data', (data) => {
      stderr += String(data);
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        timedOut,
      });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        durationMs: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}
