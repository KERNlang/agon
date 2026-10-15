import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modCommand } from '../../packages/cli/src/commands/mod.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, parseDesiredState, resolveDesiredState, sha256Canonical } from '../../packages/mod-kernel/src/index.js';
import { assertSelectedLockPackageClosure, assertSelectedLockIntegrity } from '../../packages/mod-kernel/src/selected-lock-integrity.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

afterEach(() => { delete process.env.AGON_MODULAR_HOST_ROOT; vi.restoreAllMocks(); });

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-first-party-cli-')); const hostRoot = join(root, 'host');
  const desired = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
  const host = new DurableModHost(hostRoot, { kernelVersion: '0.2.5' });
  await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired,
    installedIndex: { packages: [], installationId: 'fixture-installation' }, files: { 'installation.json': '{"fixture":true}\n' } });
  process.env.AGON_MODULAR_HOST_ROOT = hostRoot; return { root, hostRoot, host, desired };
}

async function previewAndApprove(command: any, target: string) {
  const output: string[] = []; vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
  await command.run({ args: { target } }); const preview = JSON.parse(output.at(-1)!); output.length = 0;
  await command.run({ args: { target: preview.planPath, approve: preview.planHash } }); return { preview, applied: JSON.parse(output.at(-1)!) };
}

describe('first-party safe-mode CLI recovery', () => {
  it('reports both retained installations through the built CLI after rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-retention-rollback-'));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const desiredState = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
    const first = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')], { desiredState })), installer, verifier);
    const next = artifact('@test/app', [], { version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}` });
    const second = await service.apply(await createManagedLifecyclePlan(host, request([next], { desiredState, operation: 'update' })), installer, verifier);
    const lease = await host.leaseGeneration(2, 'job:still-on-new-version');
    await service.rollback(1);
    const before = await readFile(host.paths.current);
    const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'mod', 'retention'], {
      env: { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' },
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.selectedGeneration).toBe(1);
    expect(report.installations.map((item: { installationId: string }) => item.installationId).sort())
      .toEqual([first.installation.installationId, second.installation.installationId].sort());
    expect(report.activeLeases).toEqual([lease]);
    expect(await readFile(host.paths.current)).toEqual(before);
    expect(await host.activeGenerationLeases()).toEqual([lease]);
  });

  it('previews exact purge targets through the built CLI and never replays deletion against replacement data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-purge '));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const desiredState = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
    const installed = await new ManagedLifecycleService(host).apply(
      await createManagedLifecyclePlan(host, request([artifact('@test/app')], { desiredState })), installer, verifier);
    const before = await readFile(host.paths.current);
    const data = join(host.root, 'example-data, with spaces');
    const otherData = join(host.root, 'other-data');
    const installationId = 'f'.repeat(32);
    const prefix = join(host.root, 'installations', installationId);
    await mkdir(prefix);
    await writeFile(join(prefix, 'payload'), 'orphan');
    await writeFile(data, 'approved data');
    await writeFile(otherData, 'other approved data');
    const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'mod', 'purge', ...args], {
      env: { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' },
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    for (const args of [[], ['--data', 'relative'], ['--data', host.root],
      ['--installation', installed.installation.installationId]]) {
      const denied = run(...args);
      expect(denied.error).toBeUndefined();
      expect(denied.status, denied.stdout).not.toBe(0);
    }
    const result = run('--installation', installationId, '--data', data, '--data', otherData);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const preview = JSON.parse(result.stdout);
    expect(preview).toMatchObject({ action: 'purge-preview', installationPaths: [prefix], dataPaths: [data, otherData] });
    expect(preview.warning).toContain('irreversible');
    expect(await readFile(data, 'utf8')).toBe('approved data');
    expect(await readFile(join(prefix, 'payload'), 'utf8')).toBe('orphan');
    for (const args of [[preview.planPath], [preview.planPath, '--approve', 'wrong'],
      [preview.planPath, '--approve', preview.planHash, '--data', otherData]]) {
      const denied = run(...args);
      expect(denied.status, denied.stdout).not.toBe(0);
      expect(await readFile(data, 'utf8')).toBe('approved data');
    }
    const planBytes = await readFile(preview.planPath);
    const document = JSON.parse(planBytes.toString());
    for (const targets of [
      { installationPaths: [], dataPaths: ['host/example-data, with spaces'] },
      { installationPaths: [], dataPaths: [] },
    ]) {
      const { planHash: _hash, ...unsigned } = document.preview;
      const changed = { ...unsigned, ...targets };
      const hash = sha256Canonical(changed);
      await writeFile(preview.planPath, JSON.stringify({ ...document, preview: { ...changed, planHash: hash } }));
      const denied = run(preview.planPath, '--approve', hash);
      expect(denied.status, denied.stdout).not.toBe(0);
      expect(await readFile(data, 'utf8')).toBe('approved data');
    }
    await writeFile(preview.planPath, JSON.stringify({ ...document, kind: 'artifact-retention' }));
    expect(run(preview.planPath, '--approve', preview.planHash).status).not.toBe(0);
    await writeFile(preview.planPath, planBytes);
    const applied = run(preview.planPath, '--approve', preview.planHash);
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).deletedPaths).toEqual([prefix, data, otherData]);
    for (const path of [prefix, data, otherData]) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(data, 'replacement must survive');
    const replay = run(preview.planPath, '--approve', preview.planHash);
    expect(replay.status, replay.stderr).toBe(0);
    expect(await readFile(data, 'utf8')).toBe('replacement must survive');
    expect(await readFile(host.paths.current)).toEqual(before);
  });

  it('previews and exactly approves artifact retention and release without deleting data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-artifact-cli-'));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const installed = await new ManagedLifecycleService(host).apply(
      await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    process.env.AGON_MODULAR_HOST_ROOT = host.root;
    const before = await readFile(host.paths.current);
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { output.push(String(value)); });
    const retain = modCommand.subCommands.retention.subCommands?.retain;
    const release = modCommand.subCommands.retention.subCommands?.release;
    expect(retain).toBeDefined();
    expect(release).toBeDefined();
    await retain.run({ args: { target: String(installed.pointer.generation), owner: 'agon.plan', artifact: 'result:example', hash: `sha256:${'a'.repeat(64)}` } });
    const preview = JSON.parse(output.at(-1)!);
    expect(preview.action).toBe('artifact-retain-preview');
    expect(await host.activeArtifactGenerationLeases()).toEqual([]);
    await expect(retain.run({ args: { target: preview.planPath, approve: 'wrong' } })).rejects.toThrow('approval');
    await expect(release.run({ args: { target: preview.planPath, approve: preview.planHash } })).rejects.toThrow('approval');
    await expect(retain.run({ args: { target: preview.planPath, approve: preview.planHash, owner: 'other' } })).rejects.toThrow('replacement flags');
    expect(await host.activeArtifactGenerationLeases()).toEqual([]);
    const originalPlan = await readFile(preview.planPath);
    const plan = JSON.parse(originalPlan.toString());
    const { planHash: _planHash, ...unsigned } = plan.preview;
    const changed = { ...unsigned, generationContentHash: `sha256:${'f'.repeat(64)}` };
    const changedHash = sha256Canonical(changed);
    await writeFile(preview.planPath, JSON.stringify({ ...plan, preview: { ...changed, planHash: changedHash } }));
    await expect(retain.run({ args: { target: preview.planPath, approve: changedHash } })).rejects.toThrow('changed after preview');
    const { requestId: _requestId, ...missingId } = unsigned;
    const missingHash = sha256Canonical(missingId);
    await writeFile(preview.planPath, JSON.stringify({ ...plan, preview: { ...missingId, planHash: missingHash } }));
    await expect(retain.run({ args: { target: preview.planPath, approve: missingHash } })).rejects.toThrow();
    await writeFile(preview.planPath, originalPlan);
    expect(await host.activeArtifactGenerationLeases()).toEqual([]);
    await retain.run({ args: { target: preview.planPath, approve: preview.planHash } });
    const applied = JSON.parse(output.at(-1)!);
    await retain.run({ args: { target: preview.planPath, approve: preview.planHash } });
    expect(JSON.parse(output.at(-1)!).lease).toEqual(applied.lease);
    expect(await host.activeArtifactGenerationLeases()).toEqual([applied.lease]);
    await release.run({ args: { target: applied.lease.leaseId } });
    const releasePreview = JSON.parse(output.at(-1)!);
    expect(await host.activeArtifactGenerationLeases()).toEqual([applied.lease]);
    const leasePath = join(host.paths.leases, `${applied.lease.leaseId}.json`);
    const leaseBytes = await readFile(leasePath);
    await writeFile(leasePath, JSON.stringify({ ...applied.lease, artifactId: 'replacement' }));
    await expect(release.run({ args: { target: releasePreview.planPath, approve: releasePreview.planHash } })).rejects.toThrow('changed after preview');
    expect((await host.activeArtifactGenerationLeases())[0]?.artifactId).toBe('replacement');
    await writeFile(leasePath, leaseBytes);
    await expect(release.run({ args: { target: releasePreview.planPath, approve: 'wrong' } })).rejects.toThrow('approval');
    await release.run({ args: { target: releasePreview.planPath, approve: releasePreview.planHash } });
    const released = JSON.parse(output.at(-1)!);
    await release.run({ args: { target: releasePreview.planPath, approve: releasePreview.planHash } });
    expect(JSON.parse(output.at(-1)!).lease).toEqual(released.lease);
    expect(await host.activeArtifactGenerationLeases()).toEqual([]);
    expect(await readFile(host.paths.current)).toEqual(before);
    await retain.run({ args: { target: preview.planPath, approve: preview.planHash } });
    expect(await host.activeArtifactGenerationLeases()).toEqual([]);
    expect(JSON.parse(await readFile(join(host.root, 'installations', installed.installation.installationId, 'node_modules', '@test/app', 'package.json'), 'utf8')))
      .toEqual({ name: '@test/app', version: '1.0.0' });
  });

  it('reports retention through the built safe-mode CLI without releasing a lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-retention-'));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const desiredState = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
    const installed = await new ManagedLifecycleService(host).apply(
      await createManagedLifecyclePlan(host, request([artifact('@test/app')], { desiredState })), installer, verifier);
    const lease = await host.leaseGeneration(installed.pointer.generation, 'job:live');
    const kernel = new URL('../../packages/mod-kernel/dist/index.js', import.meta.url).href;
    const publisher = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DurableModHost } from ${JSON.stringify(kernel)};
      import { writeSync } from 'node:fs';
      const host = new DurableModHost(process.argv[1], { kernelVersion: '1.0.0' });
      const lease = await host.leaseArtifactGeneration(Number(process.argv[2]),
        { ownerId: 'agon.plan', artifactId: 'result:retained', artifactHash: 'sha256:' + 'a'.repeat(64) });
      writeSync(1, JSON.stringify(lease));
      process.kill(process.pid, 'SIGKILL');
    `, host.root, String(installed.pointer.generation)], {
      env: { ...process.env, HOME: root, AGON_HOME: root }, cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    expect(publisher.error).toBeUndefined();
    expect(publisher.signal, publisher.stderr).toBe('SIGKILL');
    const artifactLease = JSON.parse(publisher.stdout);
    const before = await readFile(host.paths.current);
    const unreferencedId = 'f'.repeat(32);
    await mkdir(join(host.root, 'installations', unreferencedId));
    await writeFile(join(host.root, 'installations', unreferencedId, 'payload'), 'unreferenced');
    await mkdir(join(host.root, 'purge-staging'), { recursive: true });
    await writeFile(join(host.root, 'purge-staging', 'pending'), 'pending');
    const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'mod', 'retention'], {
      env: { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' },
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const prefix = join(host.root, 'installations', installed.installation.installationId);
    const logicalBytes = (await readFile(join(prefix, 'agon-installation.json'))).byteLength
      + Buffer.byteLength(JSON.stringify({ name: '@test/app', version: '1.0.0' }));
    expect(JSON.parse(result.stdout)).toMatchObject({ selectedGeneration: installed.pointer.generation,
      generations: [{ generation: installed.pointer.generation,
        installationId: installed.installation.installationId, committed: true, selected: true,
        logicalBytes: expect.any(Number), processLeaseIds: [lease.leaseId], artifactLeaseIds: [artifactLease.leaseId] }],
      storage: [{ path: 'generations', logicalBytes: expect.any(Number) },
        { path: 'staging', logicalBytes: 0 }, { path: 'installation-staging', logicalBytes: 0 },
        { path: 'purge-staging', logicalBytes: 7 }],
      installations: [{ installationId: installed.installation.installationId, generations: [installed.pointer.generation], logicalBytes }],
      totalInstallationLogicalBytes: logicalBytes, activeLeases: [lease], artifactLeases: [artifactLease],
      unreferencedInstallations: [{ installationId: unreferencedId, logicalBytes: 12 }],
      totalUnreferencedInstallationLogicalBytes: 12 });
    expect(JSON.parse(result.stdout).totalStorageLogicalBytes).toBeGreaterThan(7);
    expect(await readFile(join(host.root, 'purge-staging', 'pending'), 'utf8')).toBe('pending');
    expect(await readFile(join(host.root, 'installations', unreferencedId, 'payload'), 'utf8')).toBe('unreferenced');
    expect(await readFile(host.paths.current)).toEqual(before);
    expect(await host.activeGenerationLeases()).toEqual([lease]);
    expect(await host.activeArtifactGenerationLeases()).toEqual([artifactLease]);
    const invoke = (...args: string[]) => {
      const result = spawnSync(process.execPath, [cli, 'mod', 'retention', ...args], {
        env: { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' },
        cwd: root, encoding: 'utf8', timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    const preview = invoke('retain', String(installed.pointer.generation), '--owner', 'agon.plan', '--artifact', 'cli:result', '--hash', `sha256:${'b'.repeat(64)}`);
    expect(await host.activeArtifactGenerationLeases()).toEqual([artifactLease]);
    const retained = invoke('retain', preview.planPath, '--approve', preview.planHash);
    expect(retained.status).toBe('retained');
    expect(invoke('retain', preview.planPath, '--approve', preview.planHash).lease).toEqual(retained.lease);
    const release = invoke('release', retained.lease.leaseId);
    expect(release.action).toBe('artifact-release-preview');
    expect(invoke('release', release.planPath, '--approve', release.planHash).status).toBe('released');
    expect(invoke('retain', preview.planPath, '--approve', preview.planHash).status).toBe('released');
    expect(await host.activeArtifactGenerationLeases()).toEqual([artifactLease]);
    expect(await readFile(host.paths.current)).toEqual(before);
  });

  it.each(['marker-published', 'writer-removed'])('recovers after SIGKILL of the recovery process at %s', async point => {
    const root = await mkdtemp(join(tmpdir(), 'agon-reclaimer-crash-'));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    await host.initialize();
    await WriterFence.acquire(host.paths.writerLock, 'dead-fixture', { pid: 999999 });
    const env = { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' };
    const code = `import * as fs from 'node:fs/promises';
      import { DurableModHost } from ${JSON.stringify(new URL('../../packages/mod-kernel/dist/index.js', import.meta.url).href)};
      const point = ${JSON.stringify(point)};
      const lock = ${JSON.stringify(host.paths.writerLock)};
      const sync = async path => { const fd = await fs.open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); } };
      const io = { ...fs, syncFile: sync, syncDirectory: sync,
        async writeFile(path, ...args) {
          await fs.writeFile(path, ...args);
          if (point === 'marker-published' && path.startsWith(lock + '.reclaim')) process.kill(process.pid, 'SIGKILL');
        },
        async rm(path, options) {
          await fs.rm(path, options);
          if (point === 'writer-removed' && path === lock) process.kill(process.pid, 'SIGKILL');
        }
      };
      await new DurableModHost(${JSON.stringify(host.root)}, { kernelVersion: '1.0.0', io }).recoverStaleWriter(async () => false);`;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(killed.error).toBeUndefined();
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
    const recovered = spawnSync(process.execPath, [cli, 'mod', 'recover', 'transactions'], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(recovered.error).toBeUndefined();
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({ action: 'transaction-recovery', selectedGeneration: null });
    expect((await readdir(join(host.root, 'locks'))).filter(name => name.includes('.reclaim'))).toEqual([]);
    expect((await host.boot()).pointer).toBeNull();
  });

  it.each([
    ['after-lock', 1], ['after-journal-preparing', 1], ['after-staging', 1],
    ['after-journal-verified', 1], ['after-generation-rename', 1],
    ['after-pointer-switch', 2], ['after-journal-committed', 2],
    ['after-installed-index', 2], ['after-final-journal', 2],
  ] as const)('recovers through the built safe-mode CLI after SIGKILL at %s', async (point, generation) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-real-crash-'));
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const desiredState = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
    const plan = await createManagedLifecyclePlan(host, request([artifact('@test/app')], { desiredState }));
    await new ManagedLifecycleService(host).apply(plan, installer, verifier);
    const input = { operation: 'update', lock: plan.lock, desiredState,
      installedIndex: JSON.parse(await readFile(host.paths.installedIndex, 'utf8')),
      files: { 'installation.json': await readFile(join(host.generationPath(1), 'installation.json'), 'utf8') },
    };
    const env = { ...process.env, HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: host.root, AGON_MOD_SAFE_MODE: '1' };
    const code = `import { DurableModHost } from ${JSON.stringify(new URL('../../packages/mod-kernel/dist/index.js', import.meta.url).href)};
      const host = new DurableModHost(${JSON.stringify(host.root)}, { kernelVersion: '1.0.0',
        fault(point) { if (point === ${JSON.stringify(point)}) process.kill(process.pid, 'SIGKILL'); } });
      await host.commitGeneration(${JSON.stringify(input)});`;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(killed.error).toBeUndefined();
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
    const recovered = spawnSync(process.execPath, [cli, 'mod', 'recover', 'transactions'], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(recovered.error).toBeUndefined();
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({ action: 'transaction-recovery', selectedGeneration: generation });
    expect((await host.boot()).pointer?.generation).toBe(generation);
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    const retried = spawnSync(process.execPath, [cli, 'mod', 'recover', 'transactions'], { env, cwd: root, encoding: 'utf8', timeout: 10_000 });
    expect(retried.status, retried.stderr).toBe(0);
    expect(JSON.parse(retried.stdout)).toMatchObject({ recoveredCommitted: [], recoveredRolledBack: [], selectedGeneration: generation });
  });

  it('recovers abandoned installation transactions and retains the receipt on retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-transaction-recovery-'));
    process.env.AGON_MODULAR_HOST_ROOT = root;
    const transactionId = '11111111-1111-4111-8111-111111111111';
    const installationId = 'a'.repeat(32);
    const staged = join(root, 'installation-staging', transactionId);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, 'partial'), 'unfinished candidate');
    await mkdir(join(root, 'installation-transactions'), { recursive: true });
    await writeFile(join(root, 'installation-transactions', `${transactionId}.json`), JSON.stringify({
      schemaVersion: 1, transactionId, installationId, state: 'preparing',
      planHash: `sha256:${'b'.repeat(64)}`, baseGeneration: 0, selectedGeneration: null,
      startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      fenceToken: 'fixture-fence', steps: [],
    }));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await modCommand.subCommands.recover.run({ args: { target: 'transactions' } });
    expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject({
      action: 'transaction-recovery', recoveredRolledBack: [transactionId], selectedGeneration: null,
    });
    await expect(stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
    const receipt = join(root, 'installation-receipts', `${transactionId}.recovered-rolled-back.json`);
    const bytes = await readFile(receipt, 'utf8');
    await modCommand.subCommands.recover.run({ args: { target: 'transactions' } });
    expect(await readFile(receipt, 'utf8')).toBe(bytes);
    expect(JSON.parse(String(output.mock.calls.at(-1)![0])).recoveredRolledBack).toEqual([]);
  });

  it('refuses transaction recovery while a live host writer owns the state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-recovery-busy-'));
    process.env.AGON_MODULAR_HOST_ROOT = root;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const fence = await WriterFence.acquire(host.paths.writerLock, 'test.live-writer');
    const before = await readFile(host.paths.writerLock, 'utf8');
    try {
      await expect(modCommand.subCommands.recover.run({ args: { target: 'transactions' } })).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(await readFile(host.paths.writerLock, 'utf8')).toBe(before);
    } finally { await fence.release(); }
  });

  it('does not interpret a generation approval as transaction recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-cli-recovery-approval-'));
    process.env.AGON_MODULAR_HOST_ROOT = root;
    await expect(modCommand.subCommands.recover.run({ args: { target: 'transactions', approve: 'wrong-plan' } }))
      .rejects.toThrow('transaction recovery does not accept a generation approval');
    await expect(stat(join(root, 'installation-transactions'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains a bootable closure and exact package identities across disable and re-enable', async () => {
    const { host, desired } = await hostFixture();
    const original = await surfaceLockFor(desired);
    for (const verb of ['disable', 'enable'] as const) {
      await previewAndApprove(modCommand.subCommands[verb], 'agon.think');
      const pointer = (await host.readCurrentPointer())!;
      const root = host.generationPath(pointer.generation);
      const state = parseDesiredState(JSON.parse(await readFile(join(root, 'desired-state.json'), 'utf8')));
      const lock = JSON.parse(await readFile(join(root, 'mods.lock.json'), 'utf8'));
      expect(await readFile(join(root, 'installation.json'), 'utf8')).toBe('{"fixture":true}\n');
      expect(() => assertSelectedLockIntegrity(lock, state)).not.toThrow();
      expect(() => assertSelectedLockPackageClosure(lock, resolveDesiredState(createFirstPartyModCatalog(), state).effectivePackages)).not.toThrow();
      expect(lock.packages.some((entry: { id: string }) => entry.id === 'agon.think')).toBe(verb === 'enable');
      if (verb === 'enable') expect(lock.packages).toEqual(original.packages);
    }
  });

  it('disables a first-party mod through a preview-bound durable generation without importing it', async () => {
    const { host } = await hostFixture(); const result = await previewAndApprove(modCommand.subCommands.disable, 'agon.think');
    expect(result.applied).toMatchObject({ disabled: 'agon.think', generation: 2, restartRequired: true });
    expect(parseDesiredState(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).disabled).toContain('agon.think');
  });

  it('recovers an exact verified generation through two-step approval when the pointer is malformed', async () => {
    const { host, desired } = await hostFixture();
    await host.commitGeneration({ operation: 'update', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: { packages: [] } });
    await writeFile(host.paths.current, '{malformed'); const result = await previewAndApprove(modCommand.subCommands.recover, '1');
    expect(result.applied).toEqual({ recoveredGeneration: 1, restartRequired: true }); expect((await host.boot()).mode).toBe('normal');
  });
});
