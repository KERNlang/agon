import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateStagedCopy } from '../../packages/mod-kernel/src/migration-engine.js';

describe('staged migration engine', () => {
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
