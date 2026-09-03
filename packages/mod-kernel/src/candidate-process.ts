import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { DurableHostError } from './host-errors.js';
import type {
  CandidateInstaller,
  CandidateVerificationResult,
  CandidateVerifier,
  ManagedLifecyclePackagePlan,
  ManagedLifecyclePlan,
  ManagedNetworkPolicy,
} from './managed-lifecycle.js';

export interface BoundedProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface BoundedProcessResult {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
}

export type BoundedProcessRunner = (request: BoundedProcessRequest) => Promise<BoundedProcessResult>;

function appendBounded(current: Buffer[], chunk: Buffer, state: { bytes: number; truncated: boolean }, limit: number): void {
  if (state.bytes >= limit) { state.truncated = true; return; }
  const remaining = limit - state.bytes;
  const accepted = chunk.subarray(0, remaining);
  current.push(accepted);
  state.bytes += accepted.byteLength;
  if (accepted.byteLength !== chunk.byteLength) state.truncated = true;
}

export const runBoundedCandidateProcess: BoundedProcessRunner = async (request) => {
  if (!request.executable.trim() || request.args.some((argument) => argument.includes('\0'))) throw new TypeError('candidate process command is malformed');
  if (!isAbsolute(request.cwd)) throw new TypeError('candidate process cwd must be absolute');
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 15 * 60_000) throw new TypeError('candidate timeout is out of bounds');
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1 || request.maxOutputBytes > 16 * 1024 * 1024) throw new TypeError('candidate output bound is invalid');
  return new Promise<BoundedProcessResult>((resolveResult, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outputState = { bytes: 0, truncated: false };
    let timedOut = false;
    let settled = false;
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: { PATH: process.env.PATH ?? '', ...request.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => appendBounded(stdout, chunk, outputState, request.maxOutputBytes));
    child.stderr.on('data', (chunk: Buffer) => appendBounded(stderr, chunk, outputState, request.maxOutputBytes));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(Object.freeze({
        exitCode: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        outputTruncated: outputState.truncated,
      }));
    });
  });
};

export interface NpmCandidateInstallerOptions {
  readonly runner?: BoundedProcessRunner;
  readonly npmExecutable?: string;
  readonly cacheDirectory?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly activeInstallationPrefix?: string | null;
}

export class NpmCandidateInstaller implements CandidateInstaller {
  readonly #runner: BoundedProcessRunner;
  readonly #options: NpmCandidateInstallerOptions;

  constructor(options: NpmCandidateInstallerOptions = {}) {
    this.#runner = options.runner ?? runBoundedCandidateProcess;
    this.#options = options;
  }

  async install(
    packagePlan: ManagedLifecyclePackagePlan,
    candidatePrefix: string,
    context: { readonly ignoreLifecycleScripts: true; readonly networkPolicy: ManagedNetworkPolicy },
  ): Promise<void> {
    const prefix = resolve(candidatePrefix);
    if (this.#options.activeInstallationPrefix && resolve(this.#options.activeInstallationPrefix) === prefix) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'active process cannot overwrite its own installation prefix');
    }
    const args = [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save=false',
      '--prefix',
      prefix,
      ...(context.networkPolicy === 'frozen-offline' ? ['--offline'] : []),
      packagePlan.sourceLocator,
    ];
    const result = await this.#runner({
      executable: this.#options.npmExecutable ?? 'npm',
      args,
      cwd: prefix,
      env: {
        npm_config_ignore_scripts: 'true',
        ...(this.#options.cacheDirectory ? { npm_config_cache: this.#options.cacheDirectory } : {}),
      },
      timeoutMs: this.#options.timeoutMs ?? 300_000,
      maxOutputBytes: this.#options.maxOutputBytes ?? 1024 * 1024,
    });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', `npm candidate staging failed: ${packagePlan.id}`, {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputTruncated: result.outputTruncated,
      });
    }
  }
}

export interface SubprocessCandidateVerifierOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly runner?: BoundedProcessRunner;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export class SubprocessCandidateVerifier implements CandidateVerifier {
  readonly #runner: BoundedProcessRunner;
  readonly #options: SubprocessCandidateVerifierOptions;

  constructor(options: SubprocessCandidateVerifierOptions) {
    this.#runner = options.runner ?? runBoundedCandidateProcess;
    this.#options = options;
  }

  async verify(candidatePrefix: string, plan: ManagedLifecyclePlan): Promise<CandidateVerificationResult> {
    const root = resolve(candidatePrefix);
    const canonical = await realpath(root);
    const result = await this.#runner({
      executable: this.#options.executable,
      args: [...this.#options.args],
      cwd: canonical,
      env: {
        AGON_CANDIDATE_PREFIX: canonical,
        AGON_CANDIDATE_PLAN_HASH: plan.planHash,
        ...this.#options.env,
      },
      timeoutMs: this.#options.timeoutMs ?? 120_000,
      maxOutputBytes: this.#options.maxOutputBytes ?? 1024 * 1024,
    });
    const checks = Object.freeze([
      Object.freeze({ id: 'process-exit', passed: result.exitCode === 0, detail: `exit=${result.exitCode}` }),
      Object.freeze({ id: 'process-timeout', passed: !result.timedOut, detail: result.timedOut ? 'killed at timeout' : 'within bound' }),
      Object.freeze({ id: 'process-output-bound', passed: !result.outputTruncated, detail: result.outputTruncated ? 'output truncated' : 'within bound' }),
      Object.freeze({ id: 'process-signal', passed: result.signal === null, detail: result.signal ?? 'none' }),
    ]);
    return Object.freeze({ passed: checks.every((check) => check.passed), checks });
  }
}
