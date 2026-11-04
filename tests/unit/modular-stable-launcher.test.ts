import { chmod, cp, mkdir, mkdtemp, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { opendirSync, type Dir } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { DurableModHost, ManagedLifecycleService, createManagedLifecyclePlan, runBoundedCandidateProcess, WriterFence, previewManagedGenerationCollection } from '../../packages/mod-kernel/src/index.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { publishStableLauncher } from '../../packages/cli/src/stable-launcher-publication.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';
import { buildStableLauncherForTest } from '../helpers/stable-launcher.js';
import { hashBootstrapPayload } from '../../packages/cli/src/stable-launcher-payload.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, opendirSync: vi.fn(actual.opendirSync) };
});

async function fixture(cliSource = 'console.log("fixture-recovery-entry");') {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'agon-stable-launcher-')));
  const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: '1.0.0' });
  const installGeneration = async () => {
    const plan = await createManagedLifecyclePlan(host, request([artifact('@kernlang/agon-mod-think')], {
      operation: await host.readCurrentPointer() ? 'update' : 'install',
    }));
    return new ManagedLifecycleService(host).apply(plan, { async install(entry, prefix, context) {
      await installer.install(entry, prefix, context);
      const cli = join(prefix, 'node_modules/@kernlang/agon/dist');
      await mkdir(cli, { recursive: true });
      await writeFile(join(cli, 'index.js'), cliSource);
      const dependency = join(prefix, 'node_modules/fixture-dependency');
      await mkdir(dependency, { recursive: true });
      await writeFile(join(dependency, 'index.js'), 'export const value = 1;');
    } }, verifier);
  };
  const result = await installGeneration();
  const source = await buildStableLauncherForTest();
  const publish = (selectedHost = host) => publishStableLauncher(selectedHost, result.pointer, result.installation.prefix, source, async () => true);
  const launch = () => runBoundedCandidateProcess({ executable: process.execPath, args: [join(home, 'bin/agon')], cwd: home,
    env: { HOME: home, AGON_HOME: home, AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 5000, maxOutputBytes: 32768 });
  return { home, host, result, publish, launch, installGeneration, source };
}

describe('stable launcher recovery bootstrap', () => {
  it('stops an oversized directory iterator at the entry budget and closes it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'agon-bootstrap-entry-limit-')));
    const readEntry = vi.fn(() => ({ name: 'synthetic-entry' }));
    const closeDirectory = vi.fn();
    vi.mocked(opendirSync).mockReturnValueOnce({ readSync: readEntry, closeSync: closeDirectory } as unknown as Dir);
    expect(() => hashBootstrapPayload(root)).toThrow('verification entry limit');
    expect(readEntry).toHaveBeenCalledTimes(100_000);
    expect(closeDirectory).toHaveBeenCalledOnce();
  });
  it.each(['live', 'malformed'] as const)('does not reclaim a %s writer during explicit recovery', async scenario => {
    const { home, host, publish } = await fixture();
    await publish();
    if (scenario === 'live') await WriterFence.acquire(host.paths.writerLock, 'fixture.live-writer');
    else await writeFile(host.paths.writerLock, '{broken lock');
    const before = await readFile(host.paths.writerLock);
    try {
      const result = await runBoundedCandidateProcess({ executable: process.execPath,
        args: [join(home, 'bin/agon'), 'mod', 'recover', 'transactions'], cwd: home,
        env: { HOME: home, AGON_HOME: home, AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 8000, maxOutputBytes: 32768 });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(scenario === 'live' ? 'still alive' : 'malformed');
      expect(await readFile(host.paths.writerLock)).toEqual(before);
      expect(result.stdout).not.toContain('fixture-recovery-entry');
    } finally { await nodeHostIo.rm(host.paths.writerLock, { force: true }); }
  });
  it('recovers a dead generation writer without waiting for its own reader lease', async () => {
    const { home, host, publish } = await fixture();
    await publish();
    const dead = spawnSync(process.execPath, ['-e', ''], { timeout: 3000 });
    expect(dead.status).toBe(0);
    await WriterFence.acquire(host.paths.writerLock, 'fixture.dead-writer', { pid: dead.pid });
    try {
      const result = await runBoundedCandidateProcess({ executable: process.execPath,
        args: [join(home, 'bin/agon'), 'mod', 'recover', 'transactions'], cwd: home,
        env: { HOME: home, AGON_HOME: home, AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 8000, maxOutputBytes: 32768 });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).action).toBe('transaction-recovery');
      await expect(readFile(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await nodeHostIo.rm(host.paths.writerLock, { force: true }); }
  });
  it('bounds directory depth before scanning a deeply nested payload', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'agon-bootstrap-depth-')));
    await mkdir(join(root, ...Array.from({ length: 65 }, () => 'child')), { recursive: true });
    expect(() => hashBootstrapPayload(root)).toThrow('verification depth limit');
  });
  it('pins a running recovery reader across launcher replacement and collection', async () => {
    const { home, host, result, publish, launch, installGeneration, source } = await fixture(
      'const fs = require("node:fs"); const p = require("node:path"); const home = process.env.AGON_HOME; '
      + 'fs.writeFileSync(p.join(home, "reader-ready"), "ready"); '
      + 'const timer = setInterval(() => { if(fs.existsSync(p.join(home, "reader-release"))) { clearInterval(timer); } }, 10);');
    await publish();
    const running = launch();
    try {
      const deadline = Date.now() + 4000;
      for (;;) {
        try { await readFile(join(home, 'reader-ready')); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= deadline) throw error; }
        await delay(10);
      }
      const next = await installGeneration();
      await publishStableLauncher(host, next.pointer, next.installation.prefix, source, async () => true);
      expect(await host.activeGenerationLeases()).toEqual(expect.arrayContaining([
        expect.objectContaining({ generation: result.pointer.generation, ownerId: 'agon.kernel.stable-launcher.reader' }),
      ]));
      await expect(previewManagedGenerationCollection(host, { generations: [result.pointer.generation], rollbackWindowMs: 0 })).rejects.toThrow();
    } finally {
      await writeFile(join(home, 'reader-release'), 'release');
      expect((await running).exitCode).toBe(0);
    }
    expect(await host.activeGenerationLeases()).toHaveLength(0);
  });

  it('requires the new bin directory entry to be durable in its parent', async () => {
    const { home, host, publish } = await fixture();
    const faulty = new DurableModHost(host.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      async syncDirectory(path) { if (path === home) throw new Error('fixture parent sync failure'); await nodeHostIo.syncDirectory(path); },
    } });
    await expect(publish(faulty)).rejects.toThrow('fixture parent sync failure');
  });
  it('enters retained code without reading a corrupt current pointer and reuses its lease', async () => {
    const { host, publish, launch } = await fixture();
    await publish();
    const original = await host.activeArtifactGenerationLeases();
    expect(original).toHaveLength(1);
    await publish();
    expect(await host.activeArtifactGenerationLeases()).toEqual(original);
    await writeFile(host.paths.current, '{broken');
    const result = await launch();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('fixture-recovery-entry');
    expect(await readFile(host.paths.current, 'utf8')).toBe('{broken');
  });

  it('refuses changed executable bytes before executing them', async () => {
    const { host, result, publish, launch } = await fixture();
    await publish();
    const target = join(host.root, result.installation.prefix, 'node_modules/@kernlang/agon/dist/index.js');
    await chmod(target, 0o600);
    await writeFile(target, 'console.log("UNTRUSTED_EXECUTED");');
    const refused = await launch();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('qualified identity');
    expect(refused.stdout).not.toContain('UNTRUSTED_EXECUTED');
  });

  it('keeps recovery retained when directory sync fails after publication', async () => {
    const { home, host, publish, launch } = await fixture();
    const faulty = new DurableModHost(host.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      async syncDirectory(path) { if (path === join(home, 'bin')) throw new Error('fixture sync failure'); await nodeHostIo.syncDirectory(path); },
    } });
    await expect(publish(faulty)).rejects.toThrow('fixture sync failure');
    expect(await host.activeArtifactGenerationLeases()).toHaveLength(1);
    expect((await launch()).exitCode).toBe(0);
    await publish();
    expect(await host.activeArtifactGenerationLeases()).toHaveLength(1);
  });

  it('refuses publication while lifecycle mutation holds its fence', async () => {
    const { host, publish } = await fixture();
    const fence = await WriterFence.acquire(join(host.root, 'locks/lifecycle-writer.json'), 'fixture.writer');
    try { await expect(publish()).rejects.toThrow('another modular host writer'); }
    finally { await fence.release(); }
    expect(await host.activeArtifactGenerationLeases()).toHaveLength(0);
  });

  it.each(['changed', 'missing', 'extra', 'symlink', 'revoked'] as const)('refuses %s recovery dependencies or retention', async scenario => {
    const { home, host, result, publish, launch } = await fixture();
    await publish();
    const dependency = join(host.root, result.installation.prefix, 'node_modules/fixture-dependency');
    const path = join(dependency, 'index.js');
    await chmod(dependency, 0o700);
    await chmod(path, 0o600);
    if (scenario === 'changed') await writeFile(path, 'export const value = 2;');
    if (scenario === 'missing') await unlink(path);
    if (scenario === 'extra') await writeFile(join(dependency, 'extra.js'), 'export {};');
    if (scenario === 'symlink') {
      const outside = join(home, 'outside.js');
      await cp(path, outside);
      await unlink(path);
      await symlink(outside, path);
    }
    if (scenario === 'revoked') {
      const [lease] = await host.activeArtifactGenerationLeases();
      await host.releaseArtifactGenerationLease(lease!.leaseId, {
        ownerId: lease!.ownerId, artifactId: lease!.artifactId, artifactHash: lease!.artifactHash,
      });
    }
    const refused = await launch();
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).not.toContain('fixture-recovery-entry');
    expect(refused.stderr).toContain('Recovery did not finish');
  });

  it('replaces retention only after durable publication and refuses the old wrapper', async () => {
    const { home, host, publish, launch, installGeneration, source } = await fixture();
    await publish();
    const oldLauncher = join(home, 'bin/old-agon');
    await cp(join(home, 'bin/agon'), oldLauncher);
    const [oldLease] = await host.activeArtifactGenerationLeases();
    const next = await installGeneration();
    await publishStableLauncher(host, next.pointer, next.installation.prefix, source, async () => true);
    const retained = await host.activeArtifactGenerationLeases();
    expect(retained).toHaveLength(1);
    expect(retained[0]!.generation).toBe(next.pointer.generation);
    expect((await host.readArtifactGenerationLease(oldLease!.leaseId)).releasedAt).not.toBeNull();
    expect((await launch()).exitCode).toBe(0);
    const stale = await runBoundedCandidateProcess({ executable: process.execPath, args: [oldLauncher], cwd: home,
      env: { HOME: home, AGON_HOME: home, AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 5000, maxOutputBytes: 32768 });
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout).not.toContain('fixture-recovery-entry');
    expect(stale.stderr).toContain('Retry the current launcher');
  });
});
