import { mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { SimulatedHostCrash } from '../../packages/mod-kernel/src/host-errors.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';
import { hostLock } from '../helpers/modular-host.js';
import { readMigrationSourceRevision } from '../../packages/mod-kernel/src/migration-engine.js';

describe('durable host boundary invariants', () => {
  it.each(['after-lock', 'after-staging', 'after-generation-rename'] as const)('rechecks a config source at %s without replacing the previous generation', async boundary => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-source-'));
    const source = join(root, 'config.json');
    await writeFile(source, '{"value":1}\n');
    const stable = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    await stable.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {} });
    const pointerBefore = await readFile(stable.paths.current);
    const configSource = await readMigrationSourceRevision(source);
    const host = new DurableModHost(stable.root, { kernelVersion: '1.0.0', fault: async point => {
      if (point === boundary) await writeFile(source, '{"value":2}\n');
    } });
    await expect(host.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {}, configSource }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(await readFile(stable.paths.current)).toEqual(pointerBefore);
    expect(await readFile(source, 'utf8')).toBe('{"value":2}\n');
    await expect(stable.validateGeneration(1)).resolves.toMatchObject({ generation: 1 });
    const journalBytes = await Promise.all((await readdir(stable.paths.transactions)).map(async name => ({
      path: join(stable.paths.transactions, name), bytes: await readFile(join(stable.paths.transactions, name), 'utf8'),
    })));
    const interrupted = journalBytes.find(({ bytes }) => JSON.parse(bytes).candidateGeneration === 2);
    if (boundary === 'after-lock') expect(interrupted).toBeUndefined();
    else expect(JSON.parse(interrupted!.bytes)).toMatchObject({ state: 'rolled-back', baseGeneration: 1, candidateGeneration: 2 });
    // A journaled attempt retains its identity even when no generation commits.
    await expect(stable.commitGeneration({ operation: 'update', lock: hostLock('b'), desiredState: {}, installedIndex: {},
      configSource: await readMigrationSourceRevision(source) })).resolves.toMatchObject({ pointer: { generation: boundary === 'after-lock' ? 2 : 3 } });
    for (const journal of journalBytes) expect(await readFile(journal.path, 'utf8')).toBe(journal.bytes);
  });

  it.each(['create', 'delete'] as const)('refuses source %s after preview', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-source-existence-'));
    const source = join(root, 'config.json');
    if (action === 'delete') await writeFile(source, '{}');
    const configSource = await readMigrationSourceRevision(source);
    if (action === 'create') await writeFile(source, '{}');
    else await unlink(source);
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    await expect(host.commitGeneration({ operation: 'install', lock: hostLock('a'), desiredState: {}, installedIndex: {}, configSource }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(await host.readCurrentPointer()).toBeNull();
  });

  it('finishes both top-level snapshots after process death behind the commit point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-snapshots-'));
    const stable = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'stable' });
    await stable.commitGeneration({
      operation: 'install', lock: hostLock('a'), desiredState: { version: 1 }, installedIndex: { version: 1 },
    });
    const crashed = new DurableModHost(root, {
      kernelVersion: '1.0.0', processIdentity: 'crashed',
      fault: (point) => { if (point === 'after-journal-committed') throw new SimulatedHostCrash(point); },
    });
    await expect(crashed.commitGeneration({
      operation: 'update', lock: hostLock('b'), desiredState: { version: 2 }, installedIndex: { version: 2 },
    })).rejects.toBeInstanceOf(SimulatedHostCrash);
    expect(JSON.parse(await readFile(stable.paths.desiredState, 'utf8'))).toEqual({ version: 1 });

    const recoveryFence = await WriterFence.recoverStale(stable.paths.writerLock, 'test.recovery', {
      io: stable.hostIo, isProcessAlive: async () => false, processIdentity: 'recovery',
    });
    await recoveryFence.release();
    await stable.boot();
    expect(JSON.parse(await readFile(stable.paths.desiredState, 'utf8'))).toEqual({ version: 2 });
    expect(JSON.parse(await readFile(stable.paths.installedIndex, 'utf8'))).toEqual({ version: 2 });
  });

  it('rejects a disposal list that is not in dependency order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-disposal-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await expect(host.disposeOwners([
      { id: 'child', dependencies: ['parent'], disposers: [vi.fn()] },
      { id: 'parent', dependencies: [], disposers: [vi.fn()] },
    ], 100)).rejects.toThrow('dependency order');
  });

  it('disposes dependants and registrations in reverse order, continuing after failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-host-disposal-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const calls: string[] = [];
    await expect(host.disposeOwners([
      { id: 'parent', dependencies: [], disposers: [() => calls.push('parent:first'), () => calls.push('parent:second')] },
      { id: 'child', dependencies: ['parent'], disposers: [() => { calls.push('child:first'); throw new Error('broken'); }, () => calls.push('child:second')] },
    ], 100)).rejects.toMatchObject({ code: 'MOD_RESTART_REQUIRED' });
    expect(calls).toEqual(['child:second', 'child:first', 'parent:second', 'parent:first']);
  });
});
