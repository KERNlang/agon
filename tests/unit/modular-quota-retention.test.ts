import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { ManagedRetentionInspector } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import { applyManagedQuotaCollection, parseManagedQuotaPlan, previewManagedQuotaCollection, type RetentionCacheSnapshot } from '../../packages/mod-kernel/src/quota-retention.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';
import { inspectBinaryCache, evictBinaryCache, recoverBinaryCacheWriter } from '../../packages/support-engine-catalog/src/engine-registry.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-quota-'));
  const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
  const service = new ManagedLifecycleService(host);
  const largeInstaller = { install: async (...args: Parameters<typeof installer.install>) => {
    await installer.install(...args);
    await writeFile(join(args[1], 'payload.bin'), 'x'.repeat(65536));
  } };
  const original = artifact('@test/app');
  const first = await service.apply(await createManagedLifecyclePlan(host, request([original])), largeInstaller, verifier);
  const installationBytes = await readFile(join(host.generationPath(1), 'installation.json'));
  await host.commitGeneration({ operation: 'update', lock: request([original]).lock, desiredState: {}, installedIndex: {}, files: { 'installation.json': installationBytes } });
  const updated = artifact('@test/app', [], { version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}` });
  await service.apply(await createManagedLifecyclePlan(host, request([updated], { operation: 'update' })), largeInstaller, verifier);
  const path = `${root}-cache/binaries.json`;
  let cache: RetentionCacheSnapshot | null = { path, logicalBytes: 65536, identity: 'initial' };
  const events: string[] = [];
  const cacheOwner = {
    path,
    inspect: () => cache,
    evict: (expected: RetentionCacheSnapshot) => {
      events.push('cache');
      expect(existsSync(host.generationPath(1))).toBe(true);
      if (!cache) return 'missing' as const;
      if (expected.identity !== cache.identity) return 'changed' as const;
      cache = null;
      return 'removed' as const;
    },
  };
  return { root, host, first, cacheOwner, events, replaceCache: () => { cache = { path, logicalBytes: 65536, identity: 'replacement' }; } };
}

describe('managed quota retention', () => {
  it.each(['dead', 'live'])('coordinates the real cache owner with a %s inspection writer', async state => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'agon-quota-real-cache-')));
    await mkdir(join(home, 'cache'));
    const path = join(home, 'cache', 'binaries.json');
    await writeFile(path, 'x'.repeat(65536));
    const host = new DurableModHost(join(home, 'host'), { kernelVersion: '1.0.0' });
    const owner = { path, inspect: () => inspectBinaryCache(home),
      evict: (snapshot: RetentionCacheSnapshot) => evictBinaryCache(home, snapshot),
      recover: () => recoverBinaryCacheWriter(home) };
    const { plan } = await previewManagedQuotaCollection(host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: owner });
    const lock = join(home, 'cache', 'binaries.writer.json');
    if (state === 'dead') {
      const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
      expect(dead.status).toBe(0);
      WriterFence.acquireSync(lock, 'fixture-dead-cache-inspection', { pid: dead.pid });
    } else {
      const live = WriterFence.acquireSync(lock, 'fixture-live-cache-inspection');
      try {
        await expect(applyManagedQuotaCollection(host, plan!, plan!.planHash, { cacheOwner: owner })).rejects.toThrow();
        await live.assertOwned();
        expect((await readFile(path)).length).toBe(65536);
      } finally { live.releaseSync(); }
    }
    expect(await applyManagedQuotaCollection(host, plan!, plan!.planHash, { cacheOwner: owner })).toMatchObject({ cacheOutcome: 'removed' });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(existsSync(lock)).toBe(false);
  });

  it('rechecks a lease added after approval and resumes without repeating cache eviction', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const lease = await f.host.leaseGeneration(1, 'job:quota-protection');
    const original = join(f.root, 'installations', f.first.installation.installationId, 'payload.bin');
    await expect(applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow('protected');
    expect(f.events).toEqual(['cache']);
    expect(await f.host.validateGeneration(1)).toMatchObject({ generation: 1 });
    expect((await readFile(original)).length).toBe(65536);
    await f.host.releaseGenerationLease(lease.leaseId);
    expect((await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).state).toBe('exhausted');
    expect(f.events).toEqual(['cache']);
    await expect(stat(original)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.host.boot()).mode).toBe('normal');
  });

  it('refuses corrupt parent journals without repeating a consumed cache attempt', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const interrupted = { ...f.cacheOwner, evict: (): never => { throw new Error('fixture cache attempt interrupted'); } };
    await expect(applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: interrupted })).rejects.toThrow('cache attempt interrupted');
    const path = join(f.root, 'retention-transactions', `${plan!.transactionId}.json`);
    const original = await readFile(path, 'utf8');
    const saved = JSON.parse(original);
    const invalid = [
      { ...saved, nextStep: -1 },
      { ...saved, nextStep: plan!.steps.length + 1 },
      { ...saved, inFlight: true, nextStep: plan!.steps.length },
      { ...saved, state: 'cancelled', inFlight: true },
      { ...saved, state: 'exhausted', nextStep: 0 },
      { ...saved, cacheOutcome: 'not-applicable' },
      { ...saved, cancelRequested: 'yes' },
      { ...saved, unexpected: true },
      { ...saved, plan: { ...saved.plan, quotaBytes: 1 } },
    ];
    for (const record of invalid) {
      await writeFile(path, JSON.stringify(record));
      await expect(applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow(/^quota (journal is invalid|journal progress is inconsistent|record has unexpected fields)$/);
      expect(f.events).toEqual([]);
      expect(existsSync(f.host.generationPath(1))).toBe(true);
    }
    await writeFile(path, original);
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    expect(result).toMatchObject({ cacheOutcome: 'unknown', state: 'exhausted' });
    expect(f.events).toEqual([]);
    expect(f.cacheOwner.inspect()?.identity).toBe('initial');
  });

  it('rejects malformed approvals before cache or child effects', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const invalid = [
      { ...plan, quotaBytes: -1 },
      { ...plan, unexpected: true },
      { ...plan, hostRoot: 'relative-root' },
      { ...plan, cache: { ...plan!.cache, path: '/different-cache' } },
      { ...plan, steps: [plan!.steps[0], plan!.steps[0]] },
      { ...plan, steps: [{ ...plan!.steps[0], logicalBytes: Number.MAX_SAFE_INTEGER + 1 }] },
    ];
    for (const candidate of invalid) {
      const { planHash: _oldHash, ...unsigned } = candidate;
      const signed = { ...unsigned, planHash: sha256Canonical(unsigned) };
      expect(() => parseManagedQuotaPlan(signed)).toThrow();
    }
    const changed = { ...plan!, quotaBytes: 1 };
    await expect(applyManagedQuotaCollection(f.host, changed, changed.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow('hash');
    expect(f.events).toEqual([]);
    expect(existsSync(join(f.root, 'retention-transactions'))).toBe(false);
    expect(await f.host.validateGeneration(1)).toMatchObject({ generation: 1 });
  });

  it('excludes concurrent quota writers until the active transaction releases its fence', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    let paused = false;
    const slow = new DurableModHost(f.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      syncDirectory: async path => {
        await nodeHostIo.syncDirectory(path);
        if (path === join(f.root, 'retention-transactions') && !paused) {
          paused = true;
          enter();
          await released;
        }
      },
    } });
    const active = applyManagedQuotaCollection(slow, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    try {
      await entered;
      const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })));
      expect(attempts.every(result => result.status === 'rejected')).toBe(true);
      expect(f.events).toEqual([]);
    } finally { resume(); }
    expect((await active).state).toBe('exhausted');
    expect(f.events).toEqual(['cache']);
    expect((await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).state).toBe('exhausted');
    expect(f.events).toEqual(['cache']);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid cache accounting %s even inside the host and below quota', async logicalBytes => {
    const root = await mkdtemp(join(tmpdir(), 'agon-quota-cache-count-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const path = join(root, 'cache', 'binaries.json');
    const owner = { path, inspect: () => ({ path, logicalBytes, identity: 'invalid' }), evict: () => { throw new Error('must not evict'); } };
    await expect(previewManagedQuotaCollection(host, { quotaBytes: Number.MAX_SAFE_INTEGER, rollbackWindowMs: 0, cacheOwner: owner })).rejects.toThrow('safe integers');
    expect(existsSync(join(root, 'retention-transactions'))).toBe(false);
  });

  it.each(['inspection-release', 'payload-permissions', 'payload-move'])('recovers after real SIGKILL at %s', async boundary => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0 });
    const payload = plan!.steps.find(step => step.kind === 'installation')!;
    const original = payload.plan.installationPaths[0]!;
    const selected = await readFile(f.host.paths.current);
    const moduleUrl = new URL('../../packages/mod-kernel/dist/index.js', import.meta.url).href;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DurableModHost, applyManagedQuotaCollection } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(f.root)};
      const boundary = ${JSON.stringify(boundary)};
      const original = ${JSON.stringify(original)};
      const plan = ${JSON.stringify(plan)};
      const io = new DurableModHost(root, { kernelVersion: '1.0.0' }).hostIo;
      const host = new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...io,
        async rm(path, options) {
          if (boundary === 'inspection-release' && path === root + '/locks/lifecycle-writer.json') process.kill(process.pid, 'SIGKILL');
          return io.rm(path, options);
        },
        async chmod(path, mode) {
          await io.chmod(path, mode);
          if (boundary === 'payload-permissions' && path === original && mode === 0o700) process.kill(process.pid, 'SIGKILL');
        },
        async rename(from, to) {
          await io.rename(from, to);
          if (boundary === 'payload-move' && from === original) process.kill(process.pid, 'SIGKILL');
        },
      } });
      await applyManagedQuotaCollection(host, plan, plan.planHash);
    `], { cwd: f.root, env: process.env, encoding: 'utf8', timeout: 10000 });
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    const cancelPending = boundary !== 'inspection-release';
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cancelPending });
    expect(result.state).toBe(cancelPending ? 'cancelled' : 'exhausted');
    if (boundary === 'payload-permissions') {
      expect((await stat(original)).mode & 0o777).toBe(0o555);
      expect((await readFile(join(original, 'payload.bin'))).length).toBe(65536);
    } else await expect(stat(original)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.host.paths.current)).toEqual(selected);
    expect((await f.host.boot()).mode).toBe('normal');
    expect((await applyManagedQuotaCollection(f.host, plan!, plan!.planHash)).state).toBe(result.state);
  });

  it('bounds large inventories without preventing useful cache collection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-quota-large-inventory-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const installationCount = 400;
    for (let id = 1; id <= installationCount; id++) {
      const prefix = join(root, 'installations', id.toString(16).padStart(32, '0'));
      await mkdir(prefix, { recursive: true });
      await writeFile(join(prefix, 'payload.bin'), 'x'.repeat(16384));
    }
    const path = `${root}-cache/binaries.json`;
    let cache: RetentionCacheSnapshot | null = { path, logicalBytes: 1024 * 1024, identity: 'initial' };
    const owner = { path, inspect: () => cache, evict: () => { cache = null; return 'removed' as const; } };
    const report = await new ManagedRetentionInspector(host).inspect();
    const { plan } = await previewManagedQuotaCollection(host, { quotaBytes: report.accounting.totalLogicalBytes + 512 * 1024, rollbackWindowMs: 0, cacheOwner: owner });
    expect(plan).not.toBeNull();
    expect(plan!.steps.length).toBeLessThan(installationCount);
    expect(Buffer.byteLength(JSON.stringify({ schemaVersion: 2, kind: 'quota-collection', preview: plan }, null, 2) + '\n')).toBeLessThanOrEqual(256 * 1024);
    const result = await applyManagedQuotaCollection(host, plan!, plan!.planHash, { cacheOwner: owner });
    expect(result).toMatchObject({ cacheOutcome: 'removed', state: 'quota-met', completedSteps: 0 });
    expect(result.report.unreferencedInstallations).toHaveLength(installationCount);
  }, 120000);

  it.each(['dead-owner', 'release-failure', 'live-owner'])('handles inspection writer state %s before cache-only collection', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-quota-inspection-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const path = `${root}-cache/binaries.json`;
    let cache: RetentionCacheSnapshot | null = { path, logicalBytes: 65536, identity: 'initial' };
    let evictions = 0;
    const owner = { path, inspect: () => cache, evict: () => { evictions++; cache = null; return 'removed' as const; } };
    const { plan } = await previewManagedQuotaCollection(host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: owner });
    const lock = join(root, 'locks', 'lifecycle-writer.json');
    if (fault === 'dead-owner') {
      const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
      expect(dead.status).toBe(0);
      WriterFence.acquireSync(lock, 'fixture-dead-inspection', { pid: dead.pid });
      WriterFence.acquireSync(host.paths.writerLock, 'fixture-dead-inspection', { pid: dead.pid });
    } else if (fault === 'live-owner') {
      const live = await WriterFence.acquire(lock, 'fixture-live-inspection');
      try {
        await expect(applyManagedQuotaCollection(host, plan!, plan!.planHash, { cacheOwner: owner })).rejects.toThrow();
        await live.assertOwned();
        expect(evictions).toBe(0);
      } finally { await live.release(); }
    }
    let failRelease = fault === 'release-failure';
    const retryHost = fault === 'release-failure' ? new DurableModHost(root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rm: async (target, options) => {
        if (target === lock && failRelease) { failRelease = false; throw new Error('fixture inspection release'); }
        return nodeHostIo.rm(target, options);
      },
    } }) : host;
    if (fault === 'release-failure') {
      await expect(applyManagedQuotaCollection(retryHost, plan!, plan!.planHash, { cacheOwner: owner })).rejects.toThrow('fixture inspection release');
      expect(evictions).toBe(0);
    }
    expect(await applyManagedQuotaCollection(retryHost, plan!, plan!.planHash, { cacheOwner: owner })).toMatchObject({ cacheOutcome: 'removed' });
    expect(evictions).toBe(1);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(host.paths.writerLock)).toBe(false);
  });

  it.each(['child-cancelled', 'parent-advanced'])('retains cancellation after interruption at %s', async boundary => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const childPath = join(f.root, 'purge-transactions', `${plan!.steps[0]!.plan.transactionId}.json`);
    const parentPath = join(f.root, 'retention-transactions', `${plan!.transactionId}.json`);
    const stopped = new DurableModHost(f.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rename: async (from, to) => {
        if (from === f.host.generationPath(1)) throw new Error('fixture before generation move');
        await nodeHostIo.rename(from, to);
      },
    } });
    await expect(applyManagedQuotaCollection(stopped, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow('before generation move');
    let interrupted = false;
    const cancelling = new DurableModHost(f.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rename: async (from, to) => {
        await nodeHostIo.rename(from, to);
        if (to !== (boundary === 'child-cancelled' ? childPath : parentPath)) return;
        const saved = JSON.parse(await readFile(to, 'utf8'));
        if (boundary === 'child-cancelled' ? saved.phases?.[0] === 'cancelled' : saved.nextStep === 1) {
          interrupted = true;
          throw new Error('fixture interrupted cancellation');
        }
      },
    } });
    await expect(applyManagedQuotaCollection(cancelling, plan!, plan!.planHash, { cacheOwner: f.cacheOwner, cancelPending: true })).rejects.toThrow('interrupted cancellation');
    expect(interrupted).toBe(true);
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    expect(result.state).toBe('cancelled');
    expect(result.report.generations.map(generation => generation.generation)).toEqual([1, 2, 3]);
    expect(existsSync(join(f.root, 'installations', f.first.installation.installationId, 'payload.bin'))).toBe(true);
  });

  it('handles an orphan-only host without requiring a selected generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-quota-orphan-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const prefix = join(root, 'installations', 'a'.repeat(32));
    await mkdir(prefix, { recursive: true });
    await writeFile(join(prefix, 'payload.bin'), 'x'.repeat(65536));
    const { plan } = await previewManagedQuotaCollection(host, { quotaBytes: 0, rollbackWindowMs: 0 });
    expect(plan?.steps.map(step => step.kind)).toEqual(['installation']);
    const result = await applyManagedQuotaCollection(host, plan!, plan!.planHash);
    expect(result).toMatchObject({ state: 'exhausted', cacheOutcome: 'not-applicable' });
    await expect(stat(prefix)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns no plan below quota and supports cache-only cleanup on a fresh host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-quota-cache-only-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const path = `${root}-cache/binaries.json`;
    let cache: RetentionCacheSnapshot | null = { path, logicalBytes: 65536, identity: 'initial' };
    const owner = { path, inspect: () => cache, evict: () => { cache = null; return 'removed' as const; } };
    expect((await previewManagedQuotaCollection(host, { quotaBytes: 1000000, rollbackWindowMs: 0, cacheOwner: owner })).plan).toBeNull();
    expect(existsSync(join(root, 'retention-transactions'))).toBe(false);
    const { plan } = await previewManagedQuotaCollection(host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: owner });
    expect(plan?.steps).toEqual([]);
    expect(await applyManagedQuotaCollection(host, plan!, plan!.planHash, { cacheOwner: owner })).toMatchObject({ cacheOutcome: 'removed' });
  });

  it('uses one approval for cache-first cleanup and a shared payload, without claiming zero remaining bytes', async () => {
    const f = await fixture();
    const selected = await readFile(f.host.paths.current);
    const preview = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    expect(preview.plan?.steps.map(step => step.kind)).toEqual(['generation', 'generation', 'installation']);
    const plan = preview.plan!;
    const result = await applyManagedQuotaCollection(f.host, plan, plan.planHash, { cacheOwner: f.cacheOwner });
    expect(f.events).toEqual(['cache']);
    expect(result).toMatchObject({ state: 'exhausted', completedSteps: 3, quotaMet: false, cacheOutcome: 'removed' });
    expect(result.shortfallBytes).toBeGreaterThan(0);
    expect(result.report.generations.map(entry => entry.generation)).toEqual([3]);
    await expect(stat(join(f.root, 'installations', f.first.installation.installationId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.host.paths.current)).toEqual(selected);
    f.replaceCache();
    await applyManagedQuotaCollection(f.host, plan, plan.planHash, { cacheOwner: f.cacheOwner });
    expect(f.events).toEqual(['cache']);
    expect(f.cacheOwner.inspect()?.identity).toBe('replacement');
    expect((await f.host.boot()).mode).toBe('normal');
  });

  it('stops after cache eviction when quota is met, and never wakes the unused children', async () => {
    const f = await fixture();
    const report = await new ManagedRetentionInspector(f.host).inspect();
    const preview = await previewManagedQuotaCollection(f.host, { quotaBytes: report.accounting.totalLogicalBytes + 32768, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const plan = preview.plan!;
    expect(plan).not.toBeNull();
    const result = await applyManagedQuotaCollection(f.host, plan, plan.planHash, { cacheOwner: f.cacheOwner });
    expect(result).toMatchObject({ state: 'quota-met', completedSteps: 0, quotaMet: true });
    f.replaceCache();
    const retried = await applyManagedQuotaCollection(f.host, plan, plan.planHash, { cacheOwner: f.cacheOwner });
    expect(retried).toMatchObject({ state: 'quota-met', completedSteps: 0, quotaMet: false });
    expect(retried.report.generations).toHaveLength(3);
    expect(f.events).toEqual(['cache']);
  });

  it('does not repeat an ambiguous cache attempt after an exception', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const failedOwner = { ...f.cacheOwner, evict: (snapshot: RetentionCacheSnapshot): never => {
      f.cacheOwner.evict(snapshot);
      throw new Error('fixture after cache unlink');
    } };
    await expect(applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: failedOwner })).rejects.toThrow('after cache unlink');
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    expect(dead.status).toBe(0);
    WriterFence.acquireSync(join(f.root, 'locks', 'quota-writer.json'), 'fixture-dead', { pid: dead.pid });
    f.replaceCache();
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    expect(result.cacheOutcome).toBe('unknown');
    expect(f.events).toEqual(['cache']);
    expect(f.cacheOwner.inspect()?.identity).toBe('replacement');
  });

  it.each(['before-rename', 'after-chmod', 'replaced-after-chmod'])('cancels an unmoved payload with original permissions after %s', async fault => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const payload = plan!.steps.find(step => step.kind === 'installation')!;
    const original = payload.plan.installationPaths[0]!;
    const interrupted = new DurableModHost(f.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rename: async (from, to) => { if (from === original) throw new Error('fixture before payload move'); return nodeHostIo.rename(from, to); },
      chmod: async (path, mode) => {
        await nodeHostIo.chmod(path, mode);
        if (path === original && mode === 0o700 && fault !== 'before-rename') throw new Error('fixture before payload move');
      },
    } });
    await expect(applyManagedQuotaCollection(interrupted, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow('before payload move');
    const bytes = await readFile(join(original, 'payload.bin'));
    if (fault === 'replaced-after-chmod') {
      await nodeHostIo.chmod(join(original, 'payload.bin'), 0o600);
      await writeFile(join(original, 'payload.bin'), 'changed payload');
      await expect(applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner, cancelPending: true })).rejects.toThrow('identity changed');
      expect((await stat(original)).mode & 0o777).toBe(0o700);
      await writeFile(join(original, 'payload.bin'), bytes);
      await nodeHostIo.chmod(join(original, 'payload.bin'), 0o444);
    }
    expect((await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner, cancelPending: true })).state).toBe('cancelled');
    await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    expect(await readFile(join(original, 'payload.bin'))).toEqual(bytes);
    expect((await stat(original)).mode & 0o777).toBe(0o555);
  });

  it('makes cancellation terminal without starting any child or cache eviction', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner, cancelPending: true });
    expect(result).toMatchObject({ state: 'cancelled', completedSteps: 0 });
    const retried = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner });
    expect(retried.report.generations).toHaveLength(3);
    expect(f.events).toEqual([]);
  });

  it('finishes already-quarantined payload cleanup on cancellation after an interruption', async () => {
    const f = await fixture();
    const { plan } = await previewManagedQuotaCollection(f.host, { quotaBytes: 0, rollbackWindowMs: 0, cacheOwner: f.cacheOwner });
    const payload = plan!.steps.find(step => step.kind === 'installation')!;
    const staged = join(f.root, 'purge-staging', payload.plan.transactionId, '0');
    const interrupted = new DurableModHost(f.root, { kernelVersion: '1.0.0', io: { ...nodeHostIo,
      rm: async (path, options) => { if (path === staged) throw new Error('fixture payload cleanup'); return nodeHostIo.rm(path, options); },
    } });
    await expect(applyManagedQuotaCollection(interrupted, plan!, plan!.planHash, { cacheOwner: f.cacheOwner })).rejects.toThrow('fixture payload cleanup');
    expect(await stat(staged)).toBeDefined();
    const result = await applyManagedQuotaCollection(f.host, plan!, plan!.planHash, { cacheOwner: f.cacheOwner, cancelPending: true });
    expect(result.state).toBe('cancelled');
    await expect(stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.host.boot()).mode).toBe('normal');
  });
});
