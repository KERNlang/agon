import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
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
  /** Portable signal name reported by the candidate subprocess, when any. */
  readonly signal: string | null;
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
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let groupTerminated = false;
    const terminateOwnedGroup = () => {
      if (groupTerminated) return;
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      } else if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      groupTerminated = true;
    };
    child.stdout.on('data', (chunk: Buffer) => appendBounded(stdout, chunk, outputState, request.maxOutputBytes));
    child.stderr.on('data', (chunk: Buffer) => appendBounded(stderr, chunk, outputState, request.maxOutputBytes));
    const timer = setTimeout(() => {
      timedOut = true;
      try { terminateOwnedGroup(); }
      catch (error) { settled = true; reject(error); }
      // Descendants can keep inherited pipes open after the direct child exits.
      child.stdout.destroy();
      child.stderr.destroy();
    }, request.timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { terminateOwnedGroup(); }
      catch (cleanupError) { reject(new AggregateError([error, cleanupError], 'candidate process failed and cleanup failed')); return; }
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // An exited child can leave descendants with ignored output pipes.
      try { terminateOwnedGroup(); }
      catch (error) { reject(error); return; }
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
  readonly omitOptional?: boolean;
}

/** Keep npm state outside the operator home. Remove only the owned scratch tree. */
export async function runIsolatedNpmCandidateProcess(
  request: Omit<BoundedProcessRequest, 'env'>,
  options: { readonly runner?: BoundedProcessRunner; readonly cacheDirectory?: string } = {},
): Promise<BoundedProcessResult> {
  const home = await mkdtemp(join(request.cwd, '.npm-staging-'));
  try {
    const env: Record<string, string> = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_STATE_HOME: join(home, 'state'),
      TMPDIR: join(home, 'tmp'),
      npm_config_ignore_scripts: 'true',
      npm_config_userconfig: join(home, 'user.npmrc'),
      npm_config_globalconfig: join(home, 'global.npmrc'),
      npm_config_cache: options.cacheDirectory ?? join(home, 'npm-cache'),
    };
    for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR']) {
      await mkdir(env[key]!, { mode: 0o700 });
    }
    await writeFile(env.npm_config_userconfig!, '', { mode: 0o600 });
    await writeFile(env.npm_config_globalconfig!, '', { mode: 0o600 });
    return await (options.runner ?? runBoundedCandidateProcess)({ ...request, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
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
      ...(this.#options.omitOptional ? ['--omit=optional'] : []),
      ...(context.networkPolicy === 'frozen-offline' ? ['--offline'] : []),
      packagePlan.sourceLocator,
    ];
    const result = await runIsolatedNpmCandidateProcess({
      executable: this.#options.npmExecutable ?? 'npm',
      args,
      cwd: prefix,
      timeoutMs: this.#options.timeoutMs ?? 300_000,
      maxOutputBytes: this.#options.maxOutputBytes ?? 1024 * 1024,
    }, { runner: this.#runner, cacheDirectory: this.#options.cacheDirectory });
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
