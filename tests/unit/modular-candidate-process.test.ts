import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  NpmCandidateInstaller,
  SubprocessCandidateVerifier,
  runBoundedCandidateProcess,
  type BoundedProcessRunner,
} from '../../packages/mod-kernel/src/candidate-process.js';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, request } from '../helpers/modular-lifecycle.js';

describe('candidate process boundary', () => {
  it('constructs a shell-free, script-disabled, frozen-offline npm invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-command-'));
    const seen: Parameters<BoundedProcessRunner>[0][] = [];
    const runner: BoundedProcessRunner = async (input) => {
      seen.push(input);
      return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
    };
    const entry = artifact('@test/app');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const plan = await createManagedLifecyclePlan(host, request([entry]));
    const prefix = join(root, 'candidate');
    await mkdir(prefix);
    await new NpmCandidateInstaller({ runner, cacheDirectory: join(root, 'cache') }).install(plan.packages[0]!, prefix, {
      ignoreLifecycleScripts: true,
      networkPolicy: 'frozen-offline',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.executable).toBe('npm');
    expect(seen[0]?.args).toEqual([
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save=false', '--prefix', prefix, '--offline', entry.sourceLocator,
    ]);
    expect(seen[0]?.env).toMatchObject({ npm_config_ignore_scripts: 'true' });
  });

  it('never stages into the active process prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-self-'));
    const entry = artifact('@test/app');
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const plan = await createManagedLifecyclePlan(host, request([entry]));
    const installer = new NpmCandidateInstaller({ activeInstallationPrefix: root, runner: vi.fn() });
    await expect(installer.install(plan.packages[0]!, root, { ignoreLifecycleScripts: true, networkPolicy: 'online' }))
      .rejects.toThrow('cannot overwrite its own');
  });

  it.each([
    [{ exitCode: 1, signal: null, stdout: '', stderr: 'bad', timedOut: false, outputTruncated: false }, 'process-exit'],
    [{ exitCode: 1, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: true, outputTruncated: false }, 'process-timeout'],
    [{ exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: true }, 'process-output-bound'],
  ] as const)('turns hostile subprocess state into a failed verification receipt', async (result, failedId) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-verify-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const plan = await createManagedLifecyclePlan(host, request([artifact('@test/app')]));
    const verifier = new SubprocessCandidateVerifier({ executable: 'node', args: [], runner: async () => result });
    const verification = await verifier.verify(root, plan);
    expect(verification.passed).toBe(false);
    expect(verification.checks.find((check) => check.id === failedId)?.passed).toBe(false);
  });

  it('enforces timeout and output bounds in a real sacrificial subprocess', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-real-'));
    const bounded = await runBoundedCandidateProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(10000))"],
      cwd: root,
      timeoutMs: 2_000,
      maxOutputBytes: 64,
    });
    expect(bounded.exitCode).toBe(0);
    expect(bounded.outputTruncated).toBe(true);
    expect(Buffer.byteLength(bounded.stdout)).toBe(64);
    const timed = await runBoundedCandidateProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      timeoutMs: 25,
      maxOutputBytes: 64,
    });
    expect(timed.timedOut).toBe(true);
    expect(timed.signal).toBe('SIGKILL');
  });
});
