import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, open, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
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
import { hashInstalledPackagePayload, readBoundedPackageFile, walkBoundedPackage } from '../../packages/mod-kernel/src/folder-mod-bounds.js';
import { artifact, request } from '../helpers/modular-lifecycle.js';

describe('candidate process boundary', () => {
  it.each(['none', 'projection', 'catalog'] as const)('checks surface multiplicity in the activation probe: %s', async duplicate => {
    const root = await mkdtemp(join(tmpdir(), 'agon-projection-count-'));
    try {
      await cp(new URL('../../packages/mod-kernel/src/candidate-activation-runner.mjs', import.meta.url), join(root, 'runner.mjs'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      const contribution = { kind: 'command', id: 'fixture', owner: { id: 'kernel' } };
      const catalog = { ...contribution, registryId: 'fixture', surface: 'cli' };
      const actual = duplicate === 'projection' ? [contribution, contribution] : [contribution];
      const expected = duplicate === 'catalog' ? [catalog, catalog] : [catalog];
      await writeFile(join(root, 'index.js'), `
        export const sha256Canonical = () => 'fixture-hash';
        export const createFirstPartyModCatalog = () => ({ mods: [] });
        export const FIRST_PARTY_SURFACE_CATALOG = ${JSON.stringify(expected)};
        export const KERNEL_MANAGEMENT_SURFACE_CATALOG = [];
        export const bootstrapFirstPartySurfaceGeneration = async () => ({
          activePackageIds: [], disabledOwnerIds: [], externalDiagnostics: [],
          activated: { failedOwnerIds: [], dispose: async () => {},
            generation: { id: 'candidate:fixture-graph', project: surface => ({ entries: surface === 'cli' ? ${JSON.stringify(actual)} : [] }) } }
        });
      `);
      const input = join(root, 'input.json');
      await writeFile(input, JSON.stringify({ plan: { planHash: 'fixture-hash', lock: { graphHash: 'fixture-graph' }, packages: [] }, configurationFiles: {} }));
      const result = await runBoundedCandidateProcess({ executable: process.execPath, args: [join(root, 'runner.mjs'), input],
        cwd: root, env: { HOME: root }, timeoutMs: 2000, maxOutputBytes: 16 * 1024 });
      if (duplicate === 'none') {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain('AGON_CANDIDATE_RESULT:');
      } else {
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('candidate registry mismatch: cli');
        expect(result.stdout).not.toContain('AGON_CANDIDATE_RESULT:');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds empty directories as well as regular files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-payload-directories-'));
    try {
      for (let index = 0; index < 4097; index++) await mkdir(join(root, `directory-${index}`));
      await expect(walkBoundedPackage(root)).rejects.toThrow('entry-count limit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO replacement without waiting for a writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-payload-fifo-'));
    const path = join(root, 'payload');
    await writeFile(path, 'original');
    const before = await lstat(path);
    await unlink(path);
    const fifo = spawnSync('mkfifo', [path]);
    if (fifo.status !== 0) throw new Error(`fixture mkfifo failed: ${String(fifo.stderr)}`);
    const read = readBoundedPackageFile(root, {
      path: 'payload', bytes: before.size, device: before.dev, inode: before.ino,
    }).then(() => 'accepted', () => 'rejected');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed: string;
    try {
      observed = await Promise.race([read, new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('blocked'), 250);
      })]);
    } finally {
      clearTimeout(timer);
      // Release the old blocking implementation before removing this fixture.
      const release = await open(path, constants.O_RDWR | constants.O_NONBLOCK);
      await read;
      await release.close();
      await rm(root, { recursive: true, force: true });
    }
    expect(observed).toBe('rejected');
  });

  it('terminates ignored-pipe descendants after a successful child exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-success-child-'));
    const pidFile = join(root, 'child.pid');
    const marker = join(root, 'late-write');
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 200); setInterval(() => {}, 1000);`;
    const script = `const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); child.unref();`;
    const result = await runBoundedCandidateProcess({ executable: process.execPath, args: ['-e', script], cwd: root,
      timeoutMs: 2000, maxOutputBytes: 64 });
    const pid = Number(await readFile(pidFile, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid fixture descendant PID');
    let gone = false;
    try {
      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      await vi.waitFor(() => {
        try { process.kill(pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; gone = true; }
        expect(gone).toBe(true);
      }, { timeout: 1000, interval: 20 });
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (!gone) {
        try { process.kill(pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    }
  });

  it('distinguishes binary file contents from inventory boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-payload-binary-'));
    const single = join(root, 'single');
    const split = join(root, 'split');
    await mkdir(single);
    await mkdir(split);
    await writeFile(join(single, 'a'), 'x\0b\0y');
    await writeFile(join(split, 'a'), 'x');
    await writeFile(join(split, 'b'), 'y');
    // Raw path/NUL/bytes/NUL concatenation makes these two trees identical.
    expect(await hashInstalledPackagePayload(single)).not.toBe(await hashInstalledPackagePayload(split));
  });

  it('separates npm dependencies without weakening folder-mod inspection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-payload-dependencies-'));
    await writeFile(join(root, 'package.json'), '{}');
    const payload = await hashInstalledPackagePayload(root);
    await mkdir(join(root, 'node_modules', 'dependency'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'dependency', 'index.js'), 'export {};');
    expect(await hashInstalledPackagePayload(root)).toBe(payload);
    expect((await walkBoundedPackage(root)).map(file => file.path)).toContain('node_modules/dependency/index.js');
    await symlink(join(root, 'package.json'), join(root, 'alias.json'));
    await expect(hashInstalledPackagePayload(root)).rejects.toThrow('symbolic links');
  });

  it('bounds descendants that retain output pipes after the direct child exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-descendant-'));
    const pidFile = join(root, 'descendant.pid');
    const script = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const child = spawn(process.execPath, ['-e', "process.stdout.write('descendant-ready'); setInterval(() => {}, 1000)"], { stdio: 'inherit' });
      writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      child.unref();
    `;
    const run = runBoundedCandidateProcess({ executable: process.execPath, args: ['-e', script], cwd: root,
      timeoutMs: 500, maxOutputBytes: 64 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed: Awaited<typeof run> | 'deadline';
    try {
      observed = await Promise.race([run, new Promise<'deadline'>(resolve => {
        timer = setTimeout(() => resolve('deadline'), 2_000);
      })]);
    } finally {
      clearTimeout(timer);
      // Kill only the descendant created by this fixture if the runner leaked it.
      const pid = Number(await readFile(pidFile, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid fixture descendant PID');
      try { process.kill(pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      await run;
    }
    expect(observed).not.toBe('deadline');
    expect(observed).toMatchObject({ timedOut: true, stdout: 'descendant-ready' });
  });

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

  it.each(['success', 'failed-exit', 'spawn-error'] as const)('isolates npm state and cleans owned scratch after %s', async outcome => {
    const root = await mkdtemp(join(tmpdir(), 'agon-npm-isolation-'));
    const cache = join(root, 'explicit-cache');
    await mkdir(cache);
    await writeFile(join(cache, 'keep'), 'operator cache');
    let environment: Readonly<Record<string, string>> | undefined;
    const runner: BoundedProcessRunner = async input => {
      environment = input.env;
      expect(environment?.HOME).toEqual(expect.any(String));
      for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR']) {
        expect(environment?.[key]?.startsWith(`${root}/`)).toBe(true);
        expect((await stat(environment![key]!)).isDirectory()).toBe(true);
      }
      for (const key of ['npm_config_userconfig', 'npm_config_globalconfig']) {
        expect(await readFile(environment![key]!, 'utf8')).toBe('');
      }
      expect(environment?.npm_config_cache).toBe(cache);
      if (outcome === 'spawn-error') throw new Error('fixture spawn failure');
      return { exitCode: outcome === 'failed-exit' ? 1 : 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
    };
    try {
      const plan = await createManagedLifecyclePlan(new DurableModHost(root, { kernelVersion: '1.0.0' }), request([artifact('@test/app')]));
      const install = new NpmCandidateInstaller({ runner, cacheDirectory: cache }).install(plan.packages[0]!, root, {
        ignoreLifecycleScripts: true, networkPolicy: 'frozen-offline',
      });
      if (outcome === 'success') await install;
      else await expect(install).rejects.toThrow(outcome === 'spawn-error' ? 'fixture spawn failure' : 'npm candidate staging failed');
      await expect(stat(environment!.HOME!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(cache, 'keep'), 'utf8')).toBe('operator cache');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
