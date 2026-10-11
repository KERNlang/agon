import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrateStagedCopy, readMigrationSourceRevision, assertMigrationSourceRevision } from '../../packages/mod-kernel/src/migration-engine.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { ManagedLifecycleService, createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { readGenerationConfiguration } from '../../packages/mod-kernel/src/configuration-migration.js';
import { manifest } from '../helpers/modular-agon.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

describe('staged migration engine', () => {
  it.each([false, true])('validates alias ownership in saved generation artifacts (foreign=%s)', async foreign => {
    const root = await mkdtemp(join(tmpdir(), 'agon-config-owner-read-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const input = request([artifact('@test/foreign')]);
    const schema = { type: 'object', properties: { permissions: { type: 'object' } },
      'x-agon-config': { version: 1, legacyAliases: foreign ? ['permissions'] : [] } };
    const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const selected = '{}\n';
    const { pointer } = await host.commitGeneration({ operation: 'install', lock: input.lock, desiredState: input.desiredState, installedIndex: {},
      files: {
        'config/index.json': JSON.stringify({ schemaVersion: 1, source: { path: join(root, 'config.json'), contentHash: null }, selectedHash: hash(selected), ownerCount: 1 }),
        'config/source-global.json': selected,
        'config/selected-global.json': selected,
        'config/migration-receipts.json': '[]',
        'config/owners.json': JSON.stringify([{ ownerId: 'example.foreign', version: 1, schema, assetHash: hash(JSON.stringify(schema)) }]),
      } });
    if (foreign) await expect(readGenerationConfiguration(host, pointer)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    else await expect(readGenerationConfiguration(host, pointer)).resolves.toMatchObject({ selected: {}, owners: [{ ownerId: 'example.foreign' }] });
  });

  it.each(['permissions', 'engineModels', 'forgeFitnessTimeout', 'none'] as const)('rejects foreign legacy alias admission: %s', async key => {
    const root = await mkdtemp(join(tmpdir(), 'agon-config-foreign-alias-'));
    const source = join(root, 'config.json');
    const original = JSON.stringify({ permissions: { shell: false }, engineModels: { fixture: 'private-model' }, forgeFitnessTimeout: 17 });
    await writeFile(source, original);
    const schema = JSON.stringify({ type: 'object', properties: { [key]: {} },
      'x-agon-config': { version: 1, legacyAliases: key === 'none' ? [] : [key] } });
    const definition = manifest('example.foreign', '1.0.0', {
      assets: [{ path: 'schemas/config.schema.json', kind: 'schema', mediaType: 'application/schema+json', executable: false,
        bytes: Buffer.byteLength(schema), contentHash: `sha256:${createHash('sha256').update(schema).digest('hex')}`, platforms: ['darwin-arm64'] }],
      pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'schemas/config.schema.json'], executable: [] },
    });
    const entry = artifact('@test/foreign', [], { manifestHash: sha256Canonical(definition) });
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const plan = await createManagedLifecyclePlan(host, request([entry], { configSource: await readMigrationSourceRevision(source) }));
    const verify = vi.fn(verifier.verify);
    const applying = service.apply(plan, { async install(entry, prefix, context) {
      await installer.install(entry, prefix, context);
      const packageRoot = join(prefix, 'node_modules', entry.id);
      await mkdir(join(packageRoot, 'schemas'));
      await mkdir(join(packageRoot, 'dist'));
      await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(definition));
      await writeFile(join(packageRoot, 'schemas/config.schema.json'), schema);
      await writeFile(join(packageRoot, 'dist/index.js'), 'throw new Error("must not execute");');
      await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};');
    } }, { verify });
    if (key === 'none') {
      await applying;
      expect(verify).toHaveBeenCalledOnce();
      const selected = await readGenerationConfiguration(host, (await host.readCurrentPointer())!);
      expect(selected?.selected).toEqual(JSON.parse(original));
    } else {
      await expect(applying).rejects.toMatchObject({ code: 'MOD_MIGRATION_FAILED' });
      expect(verify).not.toHaveBeenCalled();
      expect(await host.readCurrentPointer()).toBeNull();
      expect(await readdir(service.installationsRoot)).toEqual([]);
      expect(await readdir(service.stagingRoot)).toEqual([]);
    }
    expect(await readFile(source, 'utf8')).toBe(original);
  });

  it.each(['none', 'name', 'version', 'bytes'] as const)('binds support metadata before configuration publication: %s', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'agon-config-support-'));
    const source = join(root, 'config.json');
    const original = '{"unknown":"retain"}\n';
    await writeFile(source, original);
    const metadata = JSON.stringify({ name: fault === 'name' ? '@other/support' : '@test/support', version: fault === 'version' ? '2.0.0' : '1.0.0' });
    const entry = artifact('@test/support', [], { manifestHash: `sha256:${createHash('sha256').update(metadata).digest('hex')}` });
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const service = new ManagedLifecycleService(host);
    const plan = await createManagedLifecyclePlan(host, request([entry], { configSource: await readMigrationSourceRevision(source) }));
    const verify = vi.fn(verifier.verify);
    const applying = service.apply(plan, { async install(entry, prefix, context) {
      await installer.install(entry, prefix, context);
      await writeFile(join(prefix, 'node_modules', entry.id, 'package.json'), metadata + (fault === 'bytes' ? '\n' : ''));
    } }, { verify });
    if (fault === 'none') {
      await applying;
      expect(verify).toHaveBeenCalledOnce();
      const selected = await readGenerationConfiguration(host, (await host.readCurrentPointer())!);
      expect(selected?.owners).toEqual([]);
      expect(selected?.selected).toEqual({ unknown: 'retain' });
    } else {
      await expect(applying).rejects.toMatchObject({ code: 'MOD_MIGRATION_FAILED' });
      expect(verify).not.toHaveBeenCalled();
      expect(await host.readCurrentPointer()).toBeNull();
      expect(await readdir(service.installationsRoot)).toEqual([]);
      expect(await readdir(service.stagingRoot)).toEqual([]);
    }
    expect(await readFile(source, 'utf8')).toBe(original);
  });

  it('distinguishes a legacy generation from incomplete configuration artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-config-read-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const input = request([artifact('@test/config')]);
    const first = await host.commitGeneration({ operation: 'install', lock: input.lock, desiredState: input.desiredState, installedIndex: {} });
    await expect(readGenerationConfiguration(host, first.pointer)).resolves.toBeUndefined();
    const second = await host.commitGeneration({ operation: 'update', lock: input.lock, desiredState: input.desiredState, installedIndex: {},
      files: { 'config/index.json': '{"schemaVersion":1}' } });
    await expect(readGenerationConfiguration(host, second.pointer)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });

  it('checks the exact artifact bytes returned after generation validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-config-read-race-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const input = request([artifact('@test/config')]);
    const { pointer } = await host.commitGeneration({ operation: 'install', lock: input.lock, desiredState: input.desiredState, installedIndex: {},
      files: { 'config/selected-global.json': '{"value":1}' } });
    const validate = host.validateGeneration.bind(host);
    vi.spyOn(host, 'validateGeneration').mockImplementation(async generation => {
      const manifest = await validate(generation);
      const path = join(host.generationPath(generation), 'config/selected-global.json');
      await chmod(path, 0o600);
      await writeFile(path, '{"value":2}');
      return manifest;
    });
    await expect(host.readGenerationArtifacts(pointer, ['config/selected-global.json'])).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });

  it.each(['present', 'absent', 'unsupported-version', 'duplicate-alias', 'schema-tamper', 'missing-manifest', 'invalid-source', 'verifier-reject'] as const)
    ('stages owner configuration without source loss: %s', async scenario => {
    const absent = scenario === 'absent';
    const root = await mkdtemp(join(tmpdir(), 'agon-config-migration-live-'));
    const source = join(root, 'config.json');
    const original = '{\n "forgeFitnessTimeout": 0, "autoReviewAfterForge": false, "unknown": "retain", "mods": {"agon.forge": {"autoReviewAfterForge": true}, "absent.owner": "retain"}\n}\n';
    const sourceBytes = scenario === 'invalid-source' ? '{broken' : original;
    if (!absent) await writeFile(source, sourceBytes);
    const schema = JSON.stringify({ type: 'object', properties: { forgeFitnessTimeout: { type: 'number', default: 10 }, autoReviewAfterForge: { type: 'boolean', default: true } },
      'x-agon-config': { version: scenario === 'unsupported-version' ? 2 : 1,
        legacyAliases: scenario === 'duplicate-alias' ? ['forgeFitnessTimeout', 'forgeFitnessTimeout'] : ['forgeFitnessTimeout', 'autoReviewAfterForge'] } });
    const definition = manifest('agon.forge', '1.0.0', {
      assets: [{ path: 'schemas/config.schema.json', kind: 'schema', mediaType: 'application/schema+json', executable: false,
        bytes: Buffer.byteLength(schema), contentHash: `sha256:${createHash('sha256').update(schema).digest('hex')}`, platforms: ['darwin-arm64'] }],
      pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'schemas/config.schema.json'], executable: [] },
    });
    const entry = artifact('@test/config', [], { manifestHash: sha256Canonical(definition) });
    const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
    const plan = await createManagedLifecyclePlan(host, request([entry], { configSource: await readMigrationSourceRevision(source) }));
    const expected = absent ? {} : { ...JSON.parse(original), mods: { 'agon.forge': { forgeFitnessTimeout: 0, autoReviewAfterForge: true }, 'absent.owner': 'retain' } };
    let verified = false;
    const service = new ManagedLifecycleService(host);
    const applying = service.apply(plan, { async install(_entry, prefix) {
      const packageRoot = join(prefix, 'node_modules', '@test', 'config');
      await mkdir(join(packageRoot, 'schemas'), { recursive: true });
      await mkdir(join(packageRoot, 'dist'));
      await writeFile(join(packageRoot, 'package.json'), '{"name":"@test/config","version":"1.0.0"}');
      if (scenario !== 'missing-manifest') await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(definition));
      await writeFile(join(packageRoot, 'schemas/config.schema.json'), scenario === 'schema-tamper' ? schema + ' ' : schema);
      await writeFile(join(packageRoot, 'dist/index.js'), 'throw new Error("must not import mod code");');
      await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};');
    } }, { async verify(prefix) {
      verified = true;
      expect(JSON.parse(await readFile(join(prefix, '.agon-config/selected-global.json'), 'utf8'))).toEqual(expected);
      expect(await readFile(join(prefix, '.agon-config/source-global.json'), 'utf8')).toBe(absent ? '{}\n' : original);
      return { passed: scenario !== 'verifier-reject', checks: [{ id: 'staged-config', passed: scenario !== 'verifier-reject' }] };
    } });
    if (scenario !== 'present' && scenario !== 'absent') {
      await expect(applying).rejects.toThrow();
      expect(verified).toBe(scenario === 'verifier-reject');
      expect(await host.readCurrentPointer()).toBeNull();
      expect(await readdir(service.installationsRoot)).toEqual([]);
      expect(await readdir(service.stagingRoot)).toEqual([]);
      expect(await readFile(source, 'utf8')).toBe(sourceBytes);
      return;
    }
    await applying;
    expect(verified).toBe(true);
    const generation = host.generationPath(1);
    await host.validateGeneration(1);
    const pointer = await host.readCurrentPointer();
    const configuration = await readGenerationConfiguration(host, pointer!);
    expect(configuration?.selected).toEqual(expected);
    expect(configuration?.owners.map(owner => owner.ownerId)).toEqual(['agon.forge']);
    expect(JSON.parse(await readFile(join(generation, 'config/selected-global.json'), 'utf8'))).toEqual(expected);
    expect(await readFile(join(generation, 'config/source-global.json'), 'utf8')).toBe(absent ? '{}\n' : original);
    const receipts = JSON.parse(await readFile(join(generation, 'config/migration-receipts.json'), 'utf8'));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ sourceArtifact: 'config/source-global.json', stagedArtifact: 'config/owner-1.json',
      receipt: { ownerId: 'agon.forge', fromVersion: 0, toVersion: 1, sourcePreserved: true,
        steps: ['agon.forge:legacy-aliases-v1'] } });
    expect(await readFile(join(generation, receipts[0].sourceArtifact), 'utf8')).toBe(absent ? '{}\n' : original);
    expect(JSON.parse(await readFile(join(generation, receipts[0].stagedArtifact), 'utf8'))).toEqual(expected);
    if (absent) await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(source, 'utf8')).toBe(original);
  });

  it('binds absent and empty sources separately and accepts unchanged bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-revision-'));
    const source = join(root, 'config.json');
    const absent = await readMigrationSourceRevision(source);
    expect(absent.contentHash).toBeNull();
    await expect(assertMigrationSourceRevision(absent)).resolves.toBeUndefined();
    await writeFile(source, '');
    await expect(assertMigrationSourceRevision(absent)).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    const empty = await readMigrationSourceRevision(source);
    expect(empty.contentHash).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    await expect(assertMigrationSourceRevision(empty)).resolves.toBeUndefined();
    expect(Object.isFrozen(empty)).toBe(true);
  });

  it('does not classify unreadable sources as absent or expose their bytes', async () => {
    const error = Object.assign(new Error('fixture denied'), { code: 'EACCES' });
    const io = { ...nodeHostIo, readFile: vi.fn(async () => { throw error; }) };
    await expect(readMigrationSourceRevision('/fixture/config.json', io)).rejects.toBe(error);
    await expect(assertMigrationSourceRevision({ path: '/fixture/config.json', contentHash: null }, io)).rejects.toBe(error);
  });

  it('rejects malformed source identities before file access', async () => {
    const readFile = vi.fn(nodeHostIo.readFile);
    const io = { ...nodeHostIo, readFile };
    await expect(readMigrationSourceRevision('relative/config.json', io)).rejects.toThrow('absolute');
    await expect(assertMigrationSourceRevision({ path: '/fixture/config.json', contentHash: 'sha256:nope' }, io)).rejects.toThrow('malformed');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('wraps reservation directory failures without invoking a callback or cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source'); await writeFile(source, 'original');
    const mkdir = vi.fn(async () => { throw Object.assign(new Error('fixture denied'), { code: 'EACCES' }); });
    const rm = vi.fn(nodeHostIo.rm); const migrate = vi.fn((bytes: Uint8Array) => bytes);
    await expect(migrateStagedCopy({ ownerId: 'owner', sourcePath: source, stagedPath: join(root, 'output', 'staged'),
      fromVersion: 1, toVersion: 2, migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2, migrate }],
      io: { ...nodeHostIo, mkdir, rm },
    })).rejects.toMatchObject({ code: 'MOD_MIGRATION_FAILED' });
    expect(migrate).not.toHaveBeenCalled(); expect(rm).not.toHaveBeenCalled();
    expect(await readFile(source, 'utf8')).toBe('original');
  });

  it('does not remove another migration reservation when writers share a destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source'); const staged = join(root, 'staged');
    await writeFile(source, 'source');
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first = migrateStagedCopy({ ownerId: 'owner', sourcePath: source, stagedPath: staged,
      fromVersion: 1, toVersion: 2, migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2,
        migrate: async () => { entered(); await pending; return Buffer.from('first'); },
      }],
    });
    await started;
    try {
      await expect(migrateStagedCopy({ ownerId: 'owner', sourcePath: source, stagedPath: staged,
        fromVersion: 1, toVersion: 2, migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2, migrate: () => Buffer.from('second') }],
      })).rejects.toThrow(/staged.*exist/);
      expect(await readFile(staged, 'utf8')).toBe('');
    } finally { release(); await first; }
    expect(await readFile(staged, 'utf8')).toBe('first');
    expect(await readFile(source, 'utf8')).toBe('source');
  });

  it('rejects an existing staging file without deleting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source'); const staged = join(root, 'staged');
    await writeFile(source, 'source'); await writeFile(staged, 'other data');
    await expect(migrateStagedCopy({ ownerId: 'owner', sourcePath: source, stagedPath: staged,
      fromVersion: 1, toVersion: 2, migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2,
        migrate: () => { throw new Error('must not run'); },
      }],
    })).rejects.toThrow(/staged.*exist/);
    expect(await readFile(source, 'utf8')).toBe('source');
    expect(await readFile(staged, 'utf8')).toBe('other data');
  });

  it('rejects a source alias through a symlinked parent directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source'); const alias = join(root, 'alias');
    await writeFile(source, 'source'); await symlink(root, alias);
    await expect(migrateStagedCopy({ ownerId: 'owner', sourcePath: source, stagedPath: join(alias, 'source'),
      fromVersion: 1, toVersion: 2, migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2, migrate: () => Buffer.from('changed') }],
    })).rejects.toThrow(/staged.*exist/);
    expect(await readFile(source, 'utf8')).toBe('source');
  });

  it.each([false, true])('rejects source as destination before a callback can run (throws=%s)', async throws => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source.json');
    const original = '{"version":1}\n';
    await writeFile(source, original);
    let called = false;
    await expect(migrateStagedCopy({
      ownerId: 'owner', sourcePath: source, stagedPath: source, fromVersion: 1, toVersion: 2,
      migrations: [{ id: 'v2', fromVersion: 1, toVersion: 2, migrate: () => {
        called = true;
        if (throws) throw new Error('fixture failure');
        return Buffer.from('{"version":2}\n');
      } }],
    })).rejects.toThrow();
    expect(await readFile(source, 'utf8')).toBe(original);
    expect(called).toBe(false);
  });

  it('runs a unique forward path against a staged copy and preserves source bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source.json');
    const staged = join(root, 'staged.json');
    const original = Buffer.from('{"schemaVersion":1,"value":"old"}\n');
    await writeFile(source, original);
    const receipt = await migrateStagedCopy({
      ownerId: 'agon.mod.example', sourcePath: source, stagedPath: staged, fromVersion: 1, toVersion: 3,
      migrations: [
        { id: 'v1-v2', fromVersion: 1, toVersion: 2, migrate: (bytes) => Buffer.from(Buffer.from(bytes).toString().replace('"old"', '"middle"').replace(':1', ':2')) },
        { id: 'v2-v3', fromVersion: 2, toVersion: 3, migrate: (bytes) => Buffer.from(Buffer.from(bytes).toString().replace('"middle"', '"new"').replace(':2', ':3')) },
      ],
    });
    expect(await readFile(source)).toEqual(original);
    expect((await readFile(staged, 'utf8'))).toContain('"new"');
    expect(receipt.steps).toEqual(['v1-v2', 'v2-v3']);
    expect(receipt.sourcePreserved).toBe(true);
  });

  it('removes failed staged output and keeps authoritative bytes exact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source.bin');
    const staged = join(root, 'staged.bin');
    const original = Buffer.from([0, 1, 2, 255]);
    await writeFile(source, original);
    await expect(migrateStagedCopy({
      ownerId: 'agon.mod.example', sourcePath: source, stagedPath: staged, fromVersion: 1, toVersion: 2,
      migrations: [{ id: 'explode', fromVersion: 1, toVersion: 2, migrate: () => { throw new Error('nope'); } }],
    })).rejects.toMatchObject({ code: 'MOD_MIGRATION_FAILED' });
    expect(await readFile(source)).toEqual(original);
    await expect(readFile(staged)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects ambiguous, backward, and incomplete migration graphs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-migration-'));
    const source = join(root, 'source');
    await writeFile(source, 'x');
    const base = { ownerId: 'owner', sourcePath: source, stagedPath: join(root, 'staged'), fromVersion: 1, toVersion: 3 };
    await expect(migrateStagedCopy({ ...base, migrations: [{ id: 'skip', fromVersion: 1, toVersion: 2, migrate: (x) => x }] })).rejects.toThrow(/no migration path/);
    await expect(migrateStagedCopy({ ...base, migrations: [
      { id: 'a', fromVersion: 1, toVersion: 2, migrate: (x) => x },
      { id: 'b', fromVersion: 1, toVersion: 3, migrate: (x) => x },
    ] })).rejects.toThrow(/ambiguous/);
  });
});
