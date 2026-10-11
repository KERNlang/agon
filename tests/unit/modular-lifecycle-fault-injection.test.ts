import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { DurableHostError } from '../../packages/mod-kernel/src/host-errors.js';
import { nodeHostIo, type HostIo } from '../../packages/mod-kernel/src/host-io.js';
import { recoverManagedLifecycle } from '../../packages/mod-kernel/src/lifecycle-recovery.js';
import {
  ManagedLifecycleService,
  createManagedLifecyclePlan,
  type ManagedLifecycleFaultPoint,
} from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, installer, lifecycleLock, request, verifier } from '../helpers/modular-lifecycle.js';

async function base(root: string) {
  const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable-host' });
  const stable = new ManagedLifecycleService(host, { processIdentity: 'stable-lifecycle' });
  const entry = artifact('@test/app');
  await stable.apply(await createManagedLifecyclePlan(host, request([entry])), installer, verifier);
  return { host, stable };
}

function updateRequest() {
  const entry = artifact('@test/app', [], {
    version: '2.0.0', sourceLocator: 'cache:@test/app@2.0.0', contentHash: `sha256:${'2'.repeat(64)}`, manifestHash: `sha256:${'3'.repeat(64)}`,
  });
  return request([entry], { operation: 'update', lock: lifecycleLock([entry], '9') });
}

describe('managed lifecycle fault injection', () => {
  it.each([false, true])('retains a committed update when rollback precedes recovery (higher generation retained=%s)', async retained => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-delayed-recovery-'));
    const initial = await base(root);
    if (retained) {
      await initial.stable.apply(await createManagedLifecyclePlan(initial.host, updateRequest()), installer, verifier);
      await initial.stable.rollback(1);
    }
    const interrupted = new DurableModHost(root, { kernelVersion: '1.0.0', fault: point => {
      if (point === 'after-pointer-switch') throw new Error('fixture post-commit failure');
    } });
    const service = new ManagedLifecycleService(interrupted);
    await expect(service.apply(await createManagedLifecyclePlan(interrupted, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const recovered = new ManagedLifecycleService(host);
    await recovered.rollback(1);
    expect(await host.boot()).toMatchObject({ mode: 'normal', pointer: { generation: 1 } });
    expect(JSON.parse(await readFile(host.paths.installedIndex, 'utf8')).packages[0].version).toBe('1.0.0');
    await recoverManagedLifecycle(host);
    await recovered.rollback(retained ? 3 : 2);
    expect((await recovered.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
    expect((await host.boot()).mode).toBe('normal');
    expect(await recoverManagedLifecycle(host)).toMatchObject({ recoveredCommitted: [], recoveredRolledBack: [] });
  });

  it('removes an unselected prefix when freezing it fails after rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-freeze-failure-'));
    const { host } = await base(root);
    let failed = false;
    const io: HostIo = { ...nodeHostIo, chmod: async (path, mode) => {
      if (!failed && path.startsWith(join(root, 'installations') + '/')) {
        failed = true;
        throw Object.assign(new Error('fixture freeze failure'), { code: 'EACCES' });
      }
      await nodeHostIo.chmod(path, mode);
    } };
    const service = new ManagedLifecycleService(host, { io });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect(failed).toBe(true);
    expect((await host.boot()).pointer?.generation).toBe(1);
    expect(await readdir(service.installationsRoot)).toHaveLength(1);
  });

  it.each([false, true])('recovers an unreadable pointer outcome without guessing (renamed=%s)', async renamed => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-unknown-commit-'));
    await base(root);
    let unreadable = false;
    const current = join(root, 'current-generation.json');
    const io: HostIo = { ...nodeHostIo,
      rename: async (from, to) => {
        if (to !== current) return nodeHostIo.rename(from, to);
        if (renamed) await nodeHostIo.rename(from, to);
        unreadable = true;
        throw Object.assign(new Error('fixture ambiguous rename'), { code: 'EIO' });
      },
      readFile: async path => {
        if (unreadable && path === current) throw Object.assign(new Error('fixture unreadable pointer'), { code: 'EACCES' });
        return nodeHostIo.readFile(path);
      },
    };
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io });
    const service = new ManagedLifecycleService(host, { io });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect(await readdir(service.installationsRoot)).toHaveLength(2);
    expect((await host.boot()).mode).not.toBe('normal');
    expect(await readdir(host.paths.generations)).toHaveLength(2);
    const recoveredHost = new DurableModHost(root, { kernelVersion: '1.0.0' });
    expect((await recoveredHost.boot()).pointer?.generation).toBe(renamed ? 2 : 1);
    const recovery = await recoverManagedLifecycle(recoveredHost);
    expect(renamed ? recovery.recoveredCommitted : recovery.recoveredRolledBack).toHaveLength(1);
    const recovered = new ManagedLifecycleService(recoveredHost);
    expect((await recovered.readSelectedInstallation())?.packages[0]?.version).toBe(renamed ? '2.0.0' : '1.0.0');
    expect(await readdir(recovered.installationsRoot)).toHaveLength(renamed ? 2 : 1);
    if (renamed) {
      await recovered.rollback(1);
      expect((await recovered.readSelectedInstallation())?.packages[0]?.version).toBe('1.0.0');
      await recovered.rollback(2);
      expect((await recovered.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
    }
  });

  it('preserves a selected generation when pointer rename succeeds but directory sync fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-pointer-sync-'));
    await base(root);
    let pointerRenamed = false;
    const io: HostIo = { ...nodeHostIo,
      rename: async (from, to) => {
        await nodeHostIo.rename(from, to);
        if (to === join(root, 'current-generation.json')) pointerRenamed = true;
      },
      syncDirectory: async path => {
        if (pointerRenamed && path === root) {
          pointerRenamed = false;
          throw Object.assign(new Error('fixture pointer sync failure'), { code: 'EIO' });
        }
        await nodeHostIo.syncDirectory(path);
      },
    };
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', io });
    const service = new ManagedLifecycleService(host, { io });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    const recoveredHost = new DurableModHost(root, { kernelVersion: '1.0.0' });
    expect((await recoveredHost.boot()).pointer?.generation).toBe(2);
    expect((await new ManagedLifecycleService(recoveredHost).readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
  });

  it.each(['after-pointer-switch', 'after-installed-index'] as const)
  ('retains the selected installation when nested host cleanup fails at %s', async point => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-nested-commit-'));
    await base(root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'nested-host',
      fault: seen => { if (seen === point) throw new Error(`fault:${point}`); },
    });
    const service = new ManagedLifecycleService(host, { processIdentity: 'nested-lifecycle' });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    const recoveredHost = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'recovered-host' });
    expect((await recoveredHost.boot()).pointer?.generation).toBe(2);
    const recovered = new ManagedLifecycleService(recoveredHost);
    expect((await recovered.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
    expect(await readdir(recovered.installationsRoot)).toHaveLength(2);
  });

  it.each<ManagedLifecycleFaultPoint>([
    'after-lifecycle-lock',
    'after-lifecycle-journal',
    'after-prefix-created',
    'after-packages-staged',
    'after-candidate-verified',
    'after-prefix-promoted',
  ])('keeps the previous generation bootable when failure occurs at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-fault-'));
    const { host } = await base(root);
    const service = new ManagedLifecycleService(host, {
      processIdentity: `fault-${point}`,
      fault: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
    });
    const plan = await createManagedLifecyclePlan(host, updateRequest());
    await expect(service.apply(plan, installer, verifier)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    expect((await host.boot()).pointer?.generation).toBe(1);
    expect((await readdir(service.installationsRoot)).length).toBe(1);
  });

  it.each<ManagedLifecycleFaultPoint>(['after-generation-selected', 'after-lifecycle-receipt'])
  ('marks restart-required but leaves the new selected generation valid at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-postcommit-'));
    const { host } = await base(root);
    const service = new ManagedLifecycleService(host, {
      processIdentity: `fault-${point}`,
      fault: (seen) => { if (seen === point) throw new Error(`fault:${point}`); },
    });
    await expect(service.apply(await createManagedLifecyclePlan(host, updateRequest()), installer, verifier))
      .rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await host.boot()).pointer?.generation).toBe(2);
    expect((await service.readSelectedInstallation())?.packages[0]?.version).toBe('2.0.0');
  });

  it.each(['ENOSPC', 'EACCES', 'EIO'])('preserves prior state when prefix promotion fails with %s', async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-errno-'));
    const { host } = await base(root);
    const failingIo: HostIo = {
      ...nodeHostIo,
      rename: async (from, to) => {
        if (from.includes('installation-staging') && to.includes('installations')) {
          throw Object.assign(new Error(code), { code });
        }
        await nodeHostIo.rename(from, to);
      },
    };
    const failingHost = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: `io-${code}`, io: failingIo });
    const service = new ManagedLifecycleService(failingHost, { processIdentity: `lifecycle-${code}`, io: failingIo });
    await expect(service.apply(await createManagedLifecyclePlan(failingHost, updateRequest()), installer, verifier))
      .rejects.toBeInstanceOf(DurableHostError);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
