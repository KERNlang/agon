import { chmod, mkdir, mkdtemp, readdir, readFile, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { applyManagedPurge, ManagedRetentionInspector, previewManagedPurge, referencedInstallations } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';
import { hostLock } from '../helpers/modular-host.js';

describe('managed purge generation retention', () => {
  it('accounts for owned staging and generation metadata without deleting payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-storage-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    for (const directory of ['staging', 'installation-staging', 'purge-staging']) {
      await mkdir(join(root, directory, 'pending'), { recursive: true });
      await writeFile(join(root, directory, 'pending', 'payload'), directory);
    }
    const report = await new ManagedRetentionInspector(host).inspect();
    expect(report).toMatchObject({ storage: [
      { path: 'generations', logicalBytes: 0 },
      { path: 'staging', logicalBytes: 7 },
      { path: 'installation-staging', logicalBytes: 20 },
      { path: 'purge-staging', logicalBytes: 13 },
    ], totalStorageLogicalBytes: 40 });
    for (const directory of ['staging', 'installation-staging', 'purge-staging']) {
      expect(await readFile(join(root, directory, 'pending', 'payload'), 'utf8')).toBe(directory);
    }
  });

  it.each(['linked', 'unreadable', 'disappeared', 'overflow', 'special'] as const)
    ('refuses unsafe owned storage accounting: %s', async defect => {
      const root = await mkdtemp(join(tmpdir(), 'agon-retention-storage-invalid-'));
      const target = join(root, 'purge-staging', 'payload');
      await mkdir(join(root, 'purge-staging'));
      await writeFile(join(root, 'outside'), 'retained');
      if (defect === 'linked') await symlink(join(root, 'outside'), target);
      else await writeFile(target, 'retained');
      const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
        stat: async path => {
          if (path !== target) return nodeHostIo.stat(path);
          if (defect === 'unreadable' || defect === 'disappeared') {
            throw Object.assign(new Error(defect), { code: defect === 'unreadable' ? 'EACCES' : 'ENOENT' });
          }
          if (defect === 'overflow') return { size: Number.MAX_SAFE_INTEGER + 1, isFile: () => true, isDirectory: () => false };
          if (defect === 'special') return { size: 0, isFile: () => false, isDirectory: () => false };
          return nodeHostIo.stat(path);
        },
      } });
      await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
      expect(await readFile(join(root, 'outside'), 'utf8')).toBe('retained');
      await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('reports retained installations after rollback and re-entry without changing selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-rollback-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const first = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const next = artifact('@test/app', [], { version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}` });
    const second = await service.apply(await createManagedLifecyclePlan(host, request([next], { operation: 'update' })), installer, verifier);
    const inspector = new ManagedRetentionInspector(host);
    for (const generation of [1, 2]) {
      const selected = await service.rollback(generation);
      expect(selected.pointer.transactionId).not.toBe((await host.validateGeneration(generation)).transactionId);
      const before = await readFile(host.paths.current);
      const report = await inspector.inspect();
      expect(report.selectedGeneration).toBe(generation);
      expect(report.installations.map(item => item.installationId).sort()).toEqual([
        first.installation.installationId, second.installation.installationId,
      ].sort());
      expect(report.unreferencedInstallations).toEqual([]);
      expect(report.totalInstallationLogicalBytes).toBeGreaterThan(0);
      expect(await readFile(host.paths.current)).toEqual(before);
      expect((await service.readSelectedInstallation())?.packages[0]?.version).toBe(generation === 1 ? '1.0.0' : '2.0.0');
    }
  });

  it.each(['transaction', 'operation', 'generation', 'lock', 'rolled-back', 'preparing', 'missing', 'malformed', 'linked', 'graph'] as const)
    ('refuses an invalid rollback selection in retention: %s', async defect => {
      const root = await mkdtemp(join(tmpdir(), 'agon-retention-selection-'));
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
      await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {} });
      const selected = await rollbackGeneration(host, 1);
      const path = host.journalPath(selected.pointer.transactionId);
      const journal = { ...selected.journal };
      if (defect === 'transaction') journal.transactionId = randomUUID();
      if (defect === 'operation') journal.operation = 'update';
      if (defect === 'generation') journal.candidateGeneration = 2;
      if (defect === 'lock') journal.candidateLockHash = `sha256:${'0'.repeat(64)}`;
      if (defect === 'rolled-back' || defect === 'preparing') journal.state = defect;
      await writeFile(path, JSON.stringify(journal));
      if (defect === 'missing') await unlink(path);
      if (defect === 'malformed') await writeFile(path, '{broken');
      if (defect === 'linked') {
        const alternate = join(root, 'journal-copy.json');
        await writeFile(alternate, await readFile(path));
        await unlink(path);
        await symlink(alternate, path);
      }
      if (defect === 'graph') await writeFile(host.paths.current, JSON.stringify({ ...selected.pointer, graphHash: `sha256:${'0'.repeat(64)}` }));
      const before = await readFile(host.paths.current);
      await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_POINTER_CORRUPT' });
      expect(await readFile(host.paths.current)).toEqual(before);
      await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('reports an interrupted rollback selection without applying recovery itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-interrupted-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: { profile: 'old' }, installedIndex: {} });
    await host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: { profile: 'new' }, installedIndex: {} });
    await expect(rollbackGeneration(host, 1, { faultAfterPointer: () => { throw new Error('fixture interrupted'); } }))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    const before = await readFile(host.paths.desiredState);
    expect((await new ManagedRetentionInspector(host).inspect()).selectedGeneration).toBe(1);
    expect(await readFile(host.paths.desiredState)).toEqual(before);
    expect((await host.boot()).pointer?.generation).toBe(1);
    expect(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).toEqual({ profile: 'old' });
  });

  it('reports unreferenced prefixes separately without reading or deleting their contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-unreferenced-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const installed = await new ManagedLifecycleService(host).apply(
      await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const before = await readFile(host.paths.current);
    for (const [id, bytes] of [['f'.repeat(32), 'older'], ['0'.repeat(32), 'x']] as const) {
      await mkdir(join(root, 'installations', id, 'nested'), { recursive: true });
      await writeFile(join(root, 'installations', id, 'nested', 'payload'), bytes);
    }
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async path => {
        if (path.startsWith(join(root, 'installations') + '/')) throw new Error('must not read payloads');
        return nodeHostIo.readFile(path);
      },
    } });
    const report = await new ManagedRetentionInspector(reader).inspect();
    expect(report.unreferencedInstallations).toEqual([
      { installationId: '0'.repeat(32), logicalBytes: 1 },
      { installationId: 'f'.repeat(32), logicalBytes: 5 },
    ]);
    expect(report.totalUnreferencedInstallationLogicalBytes).toBe(6);
    expect(report.installations.map(item => item.installationId)).toEqual([installed.installation.installationId]);
    expect(report.totalInstallationLogicalBytes).toBe(report.installations[0]!.logicalBytes);
    expect(await readFile(host.paths.current)).toEqual(before);
    expect(await readFile(join(root, 'installations', 'f'.repeat(32), 'nested', 'payload'), 'utf8')).toBe('older');
  });

  it.each(['invalid-id', 'linked-prefix', 'file-prefix', 'denied-inventory'] as const)
    ('refuses an incomplete unreferenced inventory: %s', async failure => {
      const root = await mkdtemp(join(tmpdir(), 'agon-retention-unreferenced-invalid-'));
      const directory = join(root, 'installations');
      await mkdir(directory);
      const prefix = join(directory, failure === 'invalid-id' ? 'unexpected' : 'a'.repeat(32));
      if (failure === 'linked-prefix') await symlink(root, prefix);
      else if (failure === 'file-prefix') await writeFile(prefix, 'not a prefix');
      else await mkdir(prefix);
      const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
        readdir: async (path, options) => {
          if (path === directory && failure === 'denied-inventory') throw Object.assign(new Error('denied'), { code: 'EACCES' });
          return nodeHostIo.readdir(path, options);
        },
      } });
      await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
      await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('reports zero bytes for an empty host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-empty-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    expect(await new ManagedRetentionInspector(host).inspect()).toEqual({
      schemaVersion: 1, selectedGeneration: null, installations: [], activeLeases: [], artifactLeases: [], totalInstallationLogicalBytes: 0,
      unreferencedInstallations: [], totalUnreferencedInstallationLogicalBytes: 0,
      storage: ['generations', 'staging', 'installation-staging', 'purge-staging'].map(path => ({ path, logicalBytes: 0 })),
      totalStorageLogicalBytes: 0,
    });
  });

  it.each(['inventory', 'prefix', 'payload'] as const)('refuses disappearance during an established inventory: %s', async failure => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-disappearing-'));
    const directory = join(root, 'installations');
    const prefix = join(directory, 'a'.repeat(32));
    const payload = join(prefix, 'payload');
    await mkdir(prefix, { recursive: true });
    await writeFile(payload, 'unchanged');
    const missing = () => Object.assign(new Error('disappeared after enumeration'), { code: 'ENOENT' });
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readdir: async (path, options) => {
        if (failure === 'inventory' && path === directory) throw missing();
        return nodeHostIo.readdir(path, options);
      },
      stat: async path => {
        if ((failure === 'prefix' && path === prefix) || (failure === 'payload' && path === payload)) throw missing();
        return nodeHostIo.stat(path);
      },
    } });
    await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(payload, 'utf8')).toBe('unchanged');
  });

  it.each([false, true])('refuses a linked installation root, including a dangling link: %s', async dangling => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-linked-root-'));
    await symlink(dangling ? join(root, 'absent') : root, join(root, 'installations'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses overflow across individually measurable unreferenced prefixes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-unreferenced-overflow-'));
    for (const id of ['a', 'b']) {
      const prefix = join(root, 'installations', id.repeat(32));
      await mkdir(prefix, { recursive: true });
      await writeFile(join(prefix, 'payload'), 'x');
    }
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      stat: async path => path.endsWith('/payload')
        ? { size: Number.MAX_SAFE_INTEGER, isFile: () => true, isDirectory: () => false }
        : nodeHostIo.stat(path),
    } });
    await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT',
      details: { cause: 'unreferenced installation total exceeds safe integer bounds' } });
  });

  it.each([false, true])('sums distinct installations and rejects total overflow: %s', async overflow => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-total-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const first = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const next = artifact('@test/app', [], { version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}` });
    const second = await service.apply(await createManagedLifecyclePlan(host,
      request([next], { operation: 'update', lock: lifecycleLock([next], '9') })), installer, verifier);
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      stat: async path => {
        const info = await nodeHostIo.stat(path);
        if (overflow && path.startsWith(`${root}/installations/`) && info.isFile()) {
          return { size: Math.floor(Number.MAX_SAFE_INTEGER / 3), isFile: () => true, isDirectory: () => false };
        }
        return info;
      },
    } });
    const inspector = new ManagedRetentionInspector(reader);
    if (overflow) {
      await expect(inspector.inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT', message: 'retained installation total exceeds safe integer bounds' });
    } else {
      const expected = [];
      for (const [installed, version] of [[first, '1.0.0'], [second, '2.0.0']] as const) {
        const prefix = join(root, 'installations', installed.installation.installationId);
        expected.push((await readFile(join(prefix, 'agon-installation.json'))).byteLength
          + Buffer.byteLength(JSON.stringify({ name: '@test/app', version })));
      }
      const report = await inspector.inspect();
      expect(report.installations).toHaveLength(2);
      expect(report.installations.map(item => item.logicalBytes).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
      expect(report.totalInstallationLogicalBytes).toBe(expected[0] + expected[1]);
    }
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['missing', 'symlink', 'unreadable', 'negative-size', 'overflow', 'special-entry'] as const)
    ('refuses an incomplete or unsafe size inventory: %s', async failure => {
      const root = await mkdtemp(join(tmpdir(), 'agon-retention-bytes-'));
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      const first = await new ManagedLifecycleService(host).apply(
        await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
      const prefix = join(root, 'installations', first.installation.installationId);
      const target = join(prefix, 'node_modules', '@test', 'app', 'package.json');
      const before = await readFile(host.paths.current);
      const original = await readFile(target);
      if (failure === 'missing') {
        await chmod(prefix, 0o700);
        await rename(prefix, join(root, 'moved-installation'));
      }
      if (failure === 'symlink') {
        await chmod(join(prefix, 'node_modules', '@test', 'app'), 0o700);
        await unlink(target);
        await writeFile(join(root, 'outside'), original);
        await symlink(join(root, 'outside'), target);
      }
      const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
        stat: async path => {
          if (path !== target) return nodeHostIo.stat(path);
          if (failure === 'unreadable') throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
          if (failure === 'negative-size') return { size: -1, isFile: () => true, isDirectory: () => false };
          if (failure === 'overflow') return { size: Number.MAX_SAFE_INTEGER, isFile: () => true, isDirectory: () => false };
          if (failure === 'special-entry') return { size: 0, isFile: () => false, isDirectory: () => false };
          return nodeHostIo.stat(path);
        },
      } });
      await expect(new ManagedRetentionInspector(reader).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
      expect(await readFile(host.paths.current)).toEqual(before);
      await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      if (failure === 'symlink') expect(await readFile(join(root, 'outside'))).toEqual(original);
    });

  it('reports every shared generation and active lease without changing state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-report-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const first = await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), {
      async install(plan, prefix, context) {
        await installer.install(plan, prefix, context);
        await mkdir(join(prefix, 'nested', 'payload'), { recursive: true });
        await writeFile(join(prefix, 'nested', 'payload', 'example'), 'retained bytes');
      },
    }, verifier);
    const installation = await readFile(join(host.generationPath(1), 'installation.json'), 'utf8');
    const second = await host.commitGeneration({ operation: 'enable', lock: lifecycleLock([artifact('@test/app')]),
      desiredState: {}, installedIndex: {}, files: { 'installation.json': installation } });
    const active = await host.leaseGeneration(1, 'job:running');
    const released = await host.leaseGeneration(2, 'job:finished');
    await host.releaseGenerationLease(released.leaseId);
    const before = await readFile(host.paths.current);
    const prefix = join(root, 'installations', first.installation.installationId);
    const logicalBytes = (await readFile(join(prefix, 'agon-installation.json'))).byteLength
      + Buffer.byteLength(JSON.stringify({ name: '@test/app', version: '1.0.0' })) + Buffer.byteLength('retained bytes');
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async path => {
        if (path.startsWith(`${prefix}/`)) throw new Error('size reporting must not read installed contents');
        return nodeHostIo.readFile(path);
      },
    } });
    const report = await new ManagedRetentionInspector(reader).inspect();
    const generationEntries = await readdir(host.paths.generations, { recursive: true });
    const generationSizes = await Promise.all(generationEntries.map(async path => {
      const info = await stat(join(host.paths.generations, path));
      return info.isFile() ? info.size : 0;
    }));
    const generationBytes = generationSizes.reduce((sum, size) => sum + size, 0);
    expect(generationBytes).toBeGreaterThan(0);
    expect(report).toEqual({ schemaVersion: 1, selectedGeneration: second.pointer.generation,
      storage: [{ path: 'generations', logicalBytes: generationBytes },
        ...['staging', 'installation-staging', 'purge-staging'].map(path => ({ path, logicalBytes: 0 }))],
      totalStorageLogicalBytes: generationBytes,
      installations: [{ installationId: first.installation.installationId, generations: [1, 2], hasCommittedGeneration: true, logicalBytes }],
      totalInstallationLogicalBytes: logicalBytes,
      unreferencedInstallations: [], totalUnreferencedInstallationLogicalBytes: 0,
      activeLeases: [active], artifactLeases: [] });
    expect(await readFile(host.paths.current)).toEqual(before);
    expect(await host.activeGenerationLeases()).toEqual([active]);
    expect(await readFile(join(host.generationPath(1), 'installation.json'), 'utf8')).toBe(installation);
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['process', 'artifact'] as const)('refuses a missing %s-leased generation in reports and purge', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-orphan-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const identity = { ownerId: 'agon.plan', artifactId: 'result:example', artifactHash: `sha256:${'a'.repeat(64)}` as const };
    const lease = kind === 'process' ? await host.leaseGeneration(1, 'job:running') : await host.leaseArtifactGeneration(1, identity);
    await host.commitGeneration({ operation: 'enable', lock: hostLock(), desiredState: {}, installedIndex: {} });
    await chmod(host.generationPath(1), 0o700);
    await rename(host.generationPath(1), join(root, 'moved-generation'));
    const inspector = new ManagedRetentionInspector(host);
    await expect(inspector.inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT', details: { leaseId: lease.leaseId, generation: 1 } });
    await expect(previewManagedPurge(host)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (kind === 'process') await host.releaseGenerationLease(lease.leaseId);
    else await host.releaseArtifactGenerationLease(lease.leaseId, identity);
    expect((await inspector.inspect()).activeLeases).toEqual([]);
    expect((await inspector.inspect()).artifactLeases).toEqual([]);
  });

  it.each([false, true])('retries only its own failed lock cleanup; replacement owner: %s', async replaced => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-cleanup-'));
    const writerPath = join(root, 'locks', 'writer.json');
    let fail = true;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rm: async (path, options) => {
        if (path === writerPath && fail) { fail = false; throw Object.assign(new Error('denied fixture cleanup'), { code: 'EACCES' }); }
        await nodeHostIo.rm(path, options);
      },
    } });
    const inspector = new ManagedRetentionInspector(host);
    await expect(inspector.inspect()).rejects.toMatchObject({ code: 'EACCES' });
    if (replaced) {
      await unlink(writerPath);
      const successor = await WriterFence.acquire(writerPath, 'replacement-owner');
      const before = await readFile(writerPath);
      try {
        const error = await inspector.inspect().catch(error => error);
        expect(error).toBeInstanceOf(AggregateError);
        expect(error.errors).toEqual([expect.objectContaining({ code: 'MOD_FENCE_LOST' })]);
        expect(await readFile(writerPath)).toEqual(before);
      } finally { await successor.release(); }
      return;
    }
    await expect(inspector.inspect()).resolves.toMatchObject({ selectedGeneration: null, installations: [], activeLeases: [] });
    await expect(stat(writerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['writer.json', 'lifecycle-writer.json'])('refuses concurrent %s without reclaiming it', async name => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-busy-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    const path = join(root, 'locks', name);
    const writer = await WriterFence.acquire(path, 'competing-writer');
    const before = await readFile(path);
    try {
      await expect(new ManagedRetentionInspector(host).inspect()).rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
      expect(await readFile(path)).toEqual(before);
    } finally { await writer.release(); }
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([false, true])('preserves mixed-state representative selection with reversed inventory %s', async reverse => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-order-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const first = await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const second = await host.commitGeneration({ operation: 'enable', lock: lifecycleLock([artifact('@test/app')]),
      desiredState: {}, installedIndex: {}, files: { 'installation.json': await readFile(join(host.generationPath(1), 'installation.json'), 'utf8') } });
    const journalPath = host.journalPath(second.pointer.transactionId);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'verified' }));
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readdir: async (path, options) => {
        const entries = await nodeHostIo.readdir(path, options);
        return reverse ? [...entries].reverse() : entries;
      },
    } });
    expect((await referencedInstallations(reader)).get(first.installation.installationId))
      .toEqual({ generation: 1, committed: true, generations: [1, 2] });
    const prefix = join(root, 'installations', first.installation.installationId);
    const logicalBytes = (await readFile(join(prefix, 'agon-installation.json'))).byteLength
      + Buffer.byteLength(JSON.stringify({ name: '@test/app', version: '1.0.0' }));
    expect((await new ManagedRetentionInspector(reader).inspect()).installations)
      .toEqual([{ installationId: first.installation.installationId, hasCommittedGeneration: true, generations: [1, 2], logicalBytes }]);
  });

  it.each(['ENOENT', 'EACCES'])('fails closed for an unreadable enumerated lease: %s', async code => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-unreadable-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    expect(await host.activeGenerationLeases()).toEqual([]);
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await host.leaseGeneration(1, 'job:live');
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async path => {
        if (path === join(host.paths.leases, `${lease.leaseId}.json`)) throw Object.assign(new Error('unreadable fixture'), { code });
        return nodeHostIo.readFile(path);
      },
    } });
    await expect(new ManagedRetentionInspector(reader).inspect()).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    await expect(stat(host.paths.writerLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'locks', 'lifecycle-writer.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not expire an unreleased lease by its timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-old-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', now: () => new Date('2000-01-01T00:00:00Z') });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const lease = await host.leaseGeneration(1, 'job:old');
    expect((await new ManagedRetentionInspector(host).inspect()).activeLeases).toEqual([lease]);
  });

  it('preserves scan and cleanup errors, attempts both releases, and permits retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-retention-errors-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const releases: string[] = [];
    let failRead = true;
    let failRelease = true;
    const reader = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async path => {
        if (path === host.paths.current && failRead) { failRead = false; throw new Error('fixture pointer read failed'); }
        return nodeHostIo.readFile(path);
      },
      rm: async (path, options) => {
        releases.push(path);
        if (path === host.paths.writerLock && failRelease) { failRelease = false; throw new Error('fixture cleanup failed'); }
        await nodeHostIo.rm(path, options);
      },
    } });
    const inspector = new ManagedRetentionInspector(reader);
    const error = await inspector.inspect().catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toMatchObject({ code: 'MOD_POINTER_CORRUPT' });
    expect(error.errors[1].message).toBe('fixture cleanup failed');
    expect(releases).toEqual([host.paths.writerLock, join(root, 'locks', 'lifecycle-writer.json')]);
    expect((await inspector.inspect()).selectedGeneration).toBe(1);
  });

  it.each(['missing-installation', 'linked-generation', 'wrong-journal-generation', 'wrong-journal-id', 'wrong-journal-lock'] as const)
    ('refuses purge when a retained reference is unreadable: %s', async corruption => {
      const root = await mkdtemp(join(tmpdir(), 'agon-purge-corrupt-reference-'));
      const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
      const service = new ManagedLifecycleService(host);
      const v1 = artifact('@test/app');
      const first = await service.apply(await createManagedLifecyclePlan(host, request([v1])), installer, verifier);
      const v2 = artifact('@test/app', [], {
        version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0',
        contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
      });
      await service.apply(await createManagedLifecyclePlan(host, request([v2], {
        operation: 'update', lock: lifecycleLock([v2], '9'),
      })), installer, verifier);
      const target = join(root, 'old-data');
      await mkdir(target);
      await writeFile(join(target, 'keep'), 'unchanged');
      const approved = await previewManagedPurge(host, { dataPaths: [target] });
      const generationRoot = host.generationPath(first.pointer.generation);
      if (corruption === 'missing-installation') {
        await chmod(generationRoot, 0o700);
        await unlink(join(generationRoot, 'installation.json'));
      } else if (corruption === 'linked-generation') {
        const moved = join(root, 'retained-generation');
        await chmod(generationRoot, 0o700);
        await rename(generationRoot, moved);
        await symlink(moved, generationRoot);
      } else {
        const path = host.journalPath(first.pointer.transactionId);
        const journal = JSON.parse(await readFile(path, 'utf8'));
        const changed = corruption === 'wrong-journal-generation' ? { ...journal, candidateGeneration: first.pointer.generation + 10 }
          : corruption === 'wrong-journal-id' ? { ...journal, transactionId: '11111111-1111-4111-8111-111111111111' }
          : { ...journal, candidateLockHash: `sha256:${'0'.repeat(64)}` };
        await writeFile(path, JSON.stringify(changed));
      }
      await expect(applyManagedPurge(host, approved, approved.planHash))
        .rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
      await expect(previewManagedPurge(host, { installationIds: [first.installation.installationId] }))
        .rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
      expect(await readFile(join(target, 'keep'), 'utf8')).toBe('unchanged');
      expect((await stat(join(root, 'installations', first.installation.installationId))).isDirectory()).toBe(true);
    });

  it('permits purge with a valid generation that never declared an installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-no-installation-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selected = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const target = join(root, 'old-data');
    await mkdir(target);
    const plan = await previewManagedPurge(host, { dataPaths: [target] });
    expect(await applyManagedPurge(host, plan, plan.planHash)).toEqual([target]);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await host.readCurrentPointer()).toEqual(selected.pointer);
    expect((await host.boot()).mode).toBe('normal');
  });

  it('rejects installation bytes that change after generation validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-reference-read-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const installed = await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')])), installer, verifier);
    const path = join(host.generationPath(installed.pointer.generation), 'installation.json');
    const original = await readFile(path);
    let reads = 0;
    const observing = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      readFile: async candidate => {
        if (candidate === path && ++reads === 2) {
          return Buffer.from(JSON.stringify({ ...JSON.parse(original.toString()), installationId: 'f'.repeat(32) }));
        }
        return nodeHostIo.readFile(candidate);
      },
    } });
    await expect(referencedInstallations(observing)).rejects.toMatchObject({
      code: 'MOD_GENERATION_CORRUPT', details: { cause: 'retained installation changed after generation validation' },
    });
    expect(reads).toBe(2);
    expect(await readFile(path)).toEqual(original);
  });

  it('cannot purge a non-selected installation while any retained generation references it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-purge-retained-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const v1 = artifact('@test/app');
    const first = await service.apply(await createManagedLifecyclePlan(host, request([v1])), installer, verifier);
    const v2 = artifact('@test/app', [], {
      version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0',
      contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
    });
    await service.apply(await createManagedLifecyclePlan(host, request([v2], {
      operation: 'update', lock: lifecycleLock([v2], '9'),
    })), installer, verifier);
    await expect(previewManagedPurge(host, { installationIds: [first.installation.installationId] }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED', details: { installationIds: [first.installation.installationId] } });
  });
});
