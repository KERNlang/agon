import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { atomicWrite, nodeHostIo, type HostIo } from './host-io.js';
import { DurableHostError } from './host-errors.js';

export interface VersionedMigration {
  readonly id: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
}

export interface MigrationReceipt {
  readonly schemaVersion: 1;
  readonly ownerId: string;
  readonly sourcePath: string;
  readonly stagedPath: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly steps: readonly string[];
  readonly beforeHash: `sha256:${string}`;
  readonly afterHash: `sha256:${string}`;
  readonly sourcePreserved: true;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function resolveMigrationPath(fromVersion: number, toVersion: number, migrations: readonly VersionedMigration[]): readonly VersionedMigration[] {
  if (fromVersion === toVersion) return [];
  const byFrom = new Map<number, VersionedMigration>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.fromVersion) || !Number.isSafeInteger(migration.toVersion) || migration.toVersion <= migration.fromVersion) {
      throw new TypeError(`migration ${migration.id} must move monotonically forward`);
    }
    if (byFrom.has(migration.fromVersion)) throw new TypeError(`ambiguous migration from version ${migration.fromVersion}`);
    byFrom.set(migration.fromVersion, migration);
  }
  const path: VersionedMigration[] = [];
  let current = fromVersion;
  const visited = new Set<number>();
  while (current !== toVersion) {
    if (visited.has(current)) throw new TypeError('migration cycle detected');
    visited.add(current);
    const next = byFrom.get(current);
    if (!next || next.toVersion > toVersion) throw new TypeError(`no migration path from ${current} to ${toVersion}`);
    path.push(next);
    current = next.toVersion;
  }
  return Object.freeze(path);
}

export async function migrateStagedCopy(options: {
  readonly ownerId: string;
  readonly sourcePath: string;
  readonly stagedPath: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrations: readonly VersionedMigration[];
  readonly io?: HostIo;
}): Promise<MigrationReceipt> {
  const io = options.io ?? nodeHostIo;
  const original = await io.readFile(options.sourcePath);
  const beforeHash = sha256(original);
  const path = resolveMigrationPath(options.fromVersion, options.toVersion, options.migrations);
  let migrated = new Uint8Array(original);
  try {
    for (const migration of path) migrated = new Uint8Array(await migration.migrate(migrated));
    const sourceAfter = await io.readFile(options.sourcePath);
    if (!sourceAfter.equals(original)) {
      throw new DurableHostError('MOD_MIGRATION_FAILED', 'migration modified its authoritative source bytes', { ownerId: options.ownerId });
    }
    await io.mkdir(dirname(options.stagedPath), { recursive: true, mode: 0o700 });
    await atomicWrite(io, options.stagedPath, migrated);
  } catch (error) {
    await io.rm(options.stagedPath, { force: true }).catch(() => undefined);
    if (error instanceof DurableHostError) throw error;
    throw new DurableHostError('MOD_MIGRATION_FAILED', `migration failed for ${options.ownerId}`, {
      ownerId: options.ownerId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    ownerId: options.ownerId,
    sourcePath: options.sourcePath,
    stagedPath: options.stagedPath,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    steps: Object.freeze(path.map(({ id }) => id)),
    beforeHash,
    afterHash: sha256(migrated),
    sourcePreserved: true,
  });
}
