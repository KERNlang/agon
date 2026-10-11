import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrateStagedCopy, readMigrationSourceRevision, assertMigrationSourceRevision } from '../../packages/mod-kernel/src/migration-engine.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';

describe('staged migration engine', () => {
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
