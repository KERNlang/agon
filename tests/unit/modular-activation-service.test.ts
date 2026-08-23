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
  type CanonicalModLock,
  type DesiredModState,
} from '../../packages/mod-kernel/src/index.js';

const NOW = '2026-08-23T20:00:00.000Z';
const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function lockFor(state: DesiredModState, graphCharacter: string): CanonicalModLock {
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    desiredStateHash: sha256Canonical(state),
    graphHash: hash(graphCharacter),
    packages: Object.freeze([]),
  });
}

describe('transactional modular activation service', () => {
  it('binds preview to a generation, commits atomically, and makes pinned hosts restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-activation-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-test' });
    await host.commitGeneration({
      operation: 'install', lock: lockFor(initial, 'a'), desiredState: initial, installedIndex: { packages: [] },
    });
    let graphCharacter = 'b';
    const service = new ModActivationService(host, catalog, async (state) => ({
      lock: lockFor(state, graphCharacter), installedIndex: { packages: [] },
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

    graphCharacter = 'c';
    const rollback = await service.rollback(1);
    expect(rollback.pointer.generation).toBe(1);
    expect(parseDesiredState(JSON.parse(await readFile(host.paths.desiredState, 'utf8')))).toEqual(initial);
  });

  it('rejects stale preview/apply and stale base generation inside the writer fence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-stale-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-stale-test' });
    await host.commitGeneration({ operation: 'install', lock: lockFor(initial, 'a'), desiredState: initial, installedIndex: {} });
    let graph = 'b';
    const service = new ModActivationService(host, catalog, async (state) => ({ lock: lockFor(state, graph), installedIndex: {} }));
    const stale = await service.preview({ kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
    const winner = await service.preview({ kind: 'disable', id: 'agon.review' }, '2026-08-23T20:00:02.000Z');
    await service.apply(winner);
    await expect(service.apply(stale)).rejects.toBeInstanceOf(DesiredStateConflictError);
    expect((await host.readCurrentPointer())?.generation).toBe(2);

    graph = 'c';
    await expect(host.commitGeneration({
      operation: 'enable', lock: lockFor(initial, graph), desiredState: initial, installedIndex: {}, expectedBaseGeneration: 1,
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect((await host.readCurrentPointer())?.generation).toBe(2);
  });

  it('rejects artifact builders that do not bind the lock to the exact desired state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s3-lock-bind-'));
    const catalog = createFirstPartyModCatalog();
    const initial = createFullCompatDesiredState(catalog, NOW);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's3-lock-test' });
    await host.commitGeneration({ operation: 'install', lock: lockFor(initial, 'a'), desiredState: initial, installedIndex: {} });
    const service = new ModActivationService(host, catalog, async () => ({ lock: lockFor(initial, 'b'), installedIndex: {} }));
    const plan = await service.preview({ kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
    await expect(service.apply(plan)).rejects.toBeInstanceOf(DurableHostError);
    expect((await host.readCurrentPointer())?.generation).toBe(1);
  });
});
