import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ManagedLifecyclePlan } from './managed-lifecycle.js';
import type { HostIo } from './host-io.js';
import { assertContainedPackagePath, inspectStaticManifest } from './discovery.js';
import { DurableHostError } from './host-errors.js';
import { canonicalJson } from './lock.js';
import { assertMigrationSourceRevision, migrateStagedCopy, type MigrationReceipt } from './migration-engine.js';
import { projectLegacyModSettings, readLegacyConfigAliases } from './mod-settings.js';
import type { DurableModHost, GenerationPointer } from './durable-host.js';
import { LEGACY_MOD_SETTING_OWNERS } from './legacy-config-assignments.generated.js';

interface ConfigurationOwner {
  readonly ownerId: string;
  readonly version: 1;
  readonly schema: Record<string, unknown>;
  readonly assetHash: string;
}

export interface GenerationConfiguration {
  readonly source: NonNullable<ManagedLifecyclePlan['configSource']>;
  readonly owners: readonly ConfigurationOwner[];
  readonly selected: Readonly<Record<string, unknown>>;
}

/** Missing legacy artifacts require qualification. Partial artifacts are corrupt. */
export async function readGenerationConfiguration(host: DurableModHost, pointer: GenerationPointer): Promise<GenerationConfiguration | undefined> {
  const paths = ['config/index.json', 'config/source-global.json', 'config/selected-global.json', 'config/owners.json', 'config/migration-receipts.json'];
  const files = await host.readGenerationArtifacts(pointer, paths);
  if (paths.every(path => files[path] === undefined)) return undefined;
  if (paths.some(path => files[path] === undefined)) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'selected configuration artifacts are incomplete');
  try {
    const index = parseConfig(files['config/index.json']!);
    const source = index.source;
    if (index.schemaVersion !== 1 || !object(source) || typeof source.path !== 'string'
      || (source.contentHash !== null && (typeof source.contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(source.contentHash)))
      || hash(files['config/selected-global.json']!) !== index.selectedHash
      || (source.contentHash !== null && hash(files['config/source-global.json']!) !== source.contentHash)) {
      throw new TypeError('configuration index identity mismatch');
    }
    const owners: unknown = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(files['config/owners.json']!));
    if (!Array.isArray(owners) || index.ownerCount !== owners.length) throw new TypeError('configuration owner count mismatch');
    const ids = new Set<string>();
    for (const owner of owners) {
      if (!object(owner) || typeof owner.ownerId !== 'string' || ids.has(owner.ownerId) || owner.version !== 1
        || typeof owner.assetHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(owner.assetHash)
        || !object(owner.schema) || owner.schema.type !== 'object') throw new TypeError('invalid configuration owner');
      ownedLegacyAliases(owner.ownerId, owner.schema);
      ids.add(owner.ownerId);
    }
    return { source: source as unknown as GenerationConfiguration['source'], owners: owners as ConfigurationOwner[],
      selected: parseConfig(files['config/selected-global.json']!) };
  } catch (error) {
    if (error instanceof DurableHostError && error.code === 'MOD_GENERATION_CORRUPT') throw error;
    throw new DurableHostError('MOD_GENERATION_CORRUPT', 'selected configuration artifacts are invalid');
  }
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConfig(bytes: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration source is not valid UTF-8 JSON'); }
  if (!object(value)) throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration source must be an object');
  return value;
}

function ownedLegacyAliases(ownerId: string, schema: Record<string, unknown>): readonly string[] {
  const aliases = readLegacyConfigAliases(schema);
  for (const key of aliases) {
    if (!Object.hasOwn(LEGACY_MOD_SETTING_OWNERS, key)
      || LEGACY_MOD_SETTING_OWNERS[key as keyof typeof LEGACY_MOD_SETTING_OWNERS] !== ownerId) {
      throw new DurableHostError('MOD_MIGRATION_FAILED', 'legacy configuration alias is not assigned to this owner');
    }
  }
  return aliases;
}

/** Stage data only. The selected generation retains source bytes and rules. */
export async function stageConfigurationMigration(plan: ManagedLifecyclePlan, prefix: string, io: HostIo): Promise<Record<string, Uint8Array>> {
  if (!plan.configSource) return {};
  await assertMigrationSourceRevision(plan.configSource, io);
  const original = plan.configSource.contentHash === null ? Buffer.from('{}\n') : await io.readFile(plan.configSource.path);
  if (plan.configSource.contentHash !== null && hash(original) !== plan.configSource.contentHash) {
    throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'configuration source changed during staging');
  }
  parseConfig(original);
  const root = join(prefix, '.agon-config');
  await io.mkdir(root, { recursive: false, mode: 0o700 });
  const files: Record<string, Uint8Array> = { 'config/source-global.json': original };
  let input = join(root, 'source-global.json');
  await io.writeFile(input, original, { flag: 'wx', mode: 0o600 });
  const owners: ConfigurationOwner[] = [];
  const receipts: Array<{ receipt: MigrationReceipt; sourceArtifact: string; stagedArtifact: string }> = [];
  let sourceArtifact = 'config/source-global.json';
  const aliasesSeen = new Set<string>();
  for (const entry of plan.packages) {
    const packageRoot = await assertContainedPackagePath(prefix, join('node_modules', ...entry.id.split('/')));
    try { await io.readFile(join(packageRoot, 'agon.mod.json')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const metadataPath = await assertContainedPackagePath(packageRoot, 'package.json');
        const metadataBytes = await io.readFile(metadataPath);
        const metadata = parseConfig(metadataBytes);
        if (metadata.name !== entry.id || metadata.version !== entry.version || hash(metadataBytes) !== entry.manifestHash) {
          throw new DurableHostError('MOD_MIGRATION_FAILED', 'support package metadata differs from the plan or a planned mod manifest is missing');
        }
        continue;
      }
      throw error;
    }
    const inspected = await inspectStaticManifest(packageRoot);
    if (inspected.manifestHash !== entry.manifestHash) throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration owner manifest differs from the plan');
    const asset = inspected.manifest.assets.find(asset => asset.path === 'schemas/config.schema.json');
    if (!asset) continue;
    if (asset.kind !== 'schema' || asset.executable) throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration descriptor must be a static schema');
    const bytes = await io.readFile(inspected.containedPaths.get(asset.path)!);
    if (hash(bytes) !== asset.contentHash || bytes.byteLength !== asset.bytes) throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration schema changed after inspection');
    const schema = parseConfig(bytes);
    if (schema.type !== 'object') throw new DurableHostError('MOD_MIGRATION_FAILED', 'configuration schema must describe an object');
    const aliases: Record<string, string> = {};
    const ownerId = inspected.manifest.id;
    if (owners.some(owner => owner.ownerId === ownerId)) throw new DurableHostError('MOD_MIGRATION_FAILED', 'duplicate configuration owner');
    for (const key of ownedLegacyAliases(ownerId, schema)) {
      if (aliasesSeen.has(key)) {
        throw new DurableHostError('MOD_MIGRATION_FAILED', 'multiply owned legacy configuration alias');
      }
      aliasesSeen.add(key);
      aliases[key] = ownerId;
    }
    owners.push({ ownerId, version: 1, schema, assetHash: asset.contentHash });
    if (Object.keys(aliases).length === 0) continue;
    const outputName = `owner-${owners.length}.json`;
    const output = join(root, outputName);
    const receipt = await migrateStagedCopy({ ownerId, sourcePath: input, stagedPath: output, fromVersion: 0, toVersion: 1,
      migrations: [{ id: `${ownerId}:legacy-aliases-v1`, fromVersion: 0, toVersion: 1,
        migrate: bytes => Buffer.from(canonicalJson(projectLegacyModSettings(parseConfig(bytes), aliases)) + '\n') }], io });
    receipts.push({ receipt, sourceArtifact, stagedArtifact: `config/${outputName}` });
    files[`config/${outputName}`] = await io.readFile(output);
    input = output;
    sourceArtifact = `config/${outputName}`;
  }
  files['config/selected-global.json'] = await io.readFile(input);
  files['config/owners.json'] = Buffer.from(canonicalJson(owners) + '\n');
  files['config/migration-receipts.json'] = Buffer.from(canonicalJson(receipts) + '\n');
  files['config/index.json'] = Buffer.from(canonicalJson({ schemaVersion: 1, source: plan.configSource,
    selectedHash: hash(files['config/selected-global.json']), ownerCount: owners.length }) + '\n');
  for (const [path, bytes] of Object.entries(files)) {
    const name = path.slice('config/'.length);
    if (name === 'source-global.json' || name.startsWith('owner-')) continue;
    await io.writeFile(join(root, name), bytes, { flag: 'wx', mode: 0o600 });
  }
  await assertMigrationSourceRevision(plan.configSource, io);
  return files;
}
