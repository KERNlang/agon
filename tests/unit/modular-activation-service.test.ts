import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DesiredStateConflictError,
  DurableHostError,
  DurableModHost,
  ModActivationService,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  parseDesiredState,
  sha256Canonical,
} from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor as lockFor } from '../helpers/modular-surface-lock.js';

const NOW = '2026-08-23T20:00:00.000Z';

describe('transactional modular activation service', () => {
  it('rejects a self-consistent but incomplete package closure before changing the pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-activation-closure-'));
    const catalog = createFirstPartyModCatalog();
    const desired = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: await lockFor(desired), desiredState: desired, installedIndex: {} });
    const service = new ModActivationService(host, catalog, async (state) => {
      const valid = await lockFor(state);
      const packages = valid.packages.slice(1).map((entry, resolutionOrder) => ({ ...entry, resolutionOrder }));
      const graphHash = sha256Canonical({ kernelVersion: valid.kernelVersion, apiVersion: valid.apiVersion, desiredStateHash: valid.desiredStateHash, packages });
      return { lock: { ...valid, graphHash, packages }, installedIndex: {} };
    });
    const before = await host.readCurrentPointer();
    const plan = await service.preview({ kind: 'disable', id: 'agon.think' });
    await expect(service.apply(plan)).rejects.toThrow('resolved package closure');
    expect(await host.readCurrentPointer()).toEqual(before);
  });

  it('binds preview to a generation, commits atomically, and makes pinned hosts restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-activation-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-test' });
    await host.commitGeneration({
      operation: 'install', lock: await lockFor(initial), desiredState: initial, installedIndex: { packages: [] },
    });
    const service = new ModActivationService(host, catalog, async (state) => ({
      lock: await lockFor(state), installedIndex: { packages: [] },
    }));
    const plan = await service.preview({ kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
    expect(plan.baseGeneration).toBe(1);
    expect(plan.desired.nextState.disabled).toContain('agon.think');

    const result = await service.apply(plan);
    expect(result.pointer.generation).toBe(2);
    expect(result.restartPolicy.newSessions).toBe('immediate');
    expect(result.restartPolicy.pinnedHosts).toBe('restart-required');
    const persisted = parseDesiredState(JSON.parse(await readFile(host.paths.desiredState, 'utf8')));
    expect(persisted.disabled).toContain('agon.think');
    await expect(host.assertHostGeneration(1)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect((await host.boot()).pointer?.generation).toBe(2);

    const rollback = await service.rollback(1);
    expect(rollback.pointer.generation).toBe(1);
    expect(parseDesiredState(JSON.parse(await readFile(host.paths.desiredState, 'utf8')))).toEqual(initial);
  });

  it('rejects stale preview/apply and stale base generation inside the writer fence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-stale-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-stale-test' });
    await host.commitGeneration({ operation: 'install', lock: await lockFor(initial), desiredState: initial, installedIndex: {} });
    const service = new ModActivationService(host, catalog, async (state) => ({ lock: await lockFor(state), installedIndex: {} }));
    const stale = await service.preview({ kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
    const winner = await service.preview({ kind: 'disable', id: 'agon.review' }, '2026-08-23T20:00:02.000Z');
    await service.apply(winner);
    await expect(service.apply(stale)).rejects.toBeInstanceOf(DesiredStateConflictError);
    expect((await host.readCurrentPointer())?.generation).toBe(2);

    await expect(host.commitGeneration({
      operation: 'enable', lock: await lockFor(initial), desiredState: initial, installedIndex: {}, expectedBaseGeneration: 1,
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await host.readCurrentPointer())?.generation).toBe(2);
  });

  it('rejects artifact builders that do not bind the lock to the exact desired state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-lock-bind-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-lock-test' });
    await host.commitGeneration({ operation: 'install', lock: await lockFor(initial), desiredState: initial, installedIndex: {} });
    const service = new ModActivationService(host, catalog, async () => ({ lock: await lockFor(initial), installedIndex: {} }));
    const plan = await service.preview({ kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
    await expect(service.apply(plan)).rejects.toBeInstanceOf(DurableHostError);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
