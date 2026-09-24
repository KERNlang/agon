import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface FitnessCommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly durationMs: number;
  readonly outputTruncated: boolean;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Runs the operator-supplied fitness command inside an isolated candidate. */
export function runFitnessCommand(command: string, cwd: string, timeoutSeconds: number, signal?: AbortSignal): Promise<FitnessCommandResult> {
  if (!command.trim()) throw new Error('Fitness command is required');
  if (!existsSync(cwd)) throw new Error(`Fitness working directory does not exist: ${cwd}`);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    let timedOut = false;
    let aborted = false;
    const append = (current: string, chunk: Buffer): string => {
      const used = Buffer.byteLength(current);
      if (used >= MAX_OUTPUT_BYTES) { outputTruncated = true; return current; }
      const remaining = MAX_OUTPUT_BYTES - used;
      if (chunk.length > remaining) outputTruncated = true;
      return current + chunk.subarray(0, remaining).toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const stop = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, timeoutSeconds) * 1000);
    const onAbort = () => { aborted = true; stop(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(Object.freeze({ command, exitCode: code ?? 1, stdout, stderr, timedOut, aborted, durationMs: Date.now() - started, outputTruncated }));
    });
  });
}
