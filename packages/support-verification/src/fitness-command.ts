import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';
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
  return spawnWithTimeout({
    command: '/bin/sh', args: ['-c', command], cwd,
    timeout: Math.max(1, timeoutSeconds) * 1000, signal,
    maxCapturedBytesPerStream: MAX_OUTPUT_BYTES,
  }).then(result => {
    if (result.spawnError) throw result.spawnError;
    return Object.freeze({ command, exitCode: result.exitCode, stdout: result.stdout,
      stderr: result.stderr, timedOut: result.timedOut, aborted: result.aborted ?? false,
      durationMs: result.durationMs, outputTruncated: result.outputTruncated ?? false });
  });
}
