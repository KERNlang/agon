import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DurableModHost, GenerationManifest, GenerationPointer } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { readJson, type HostIo } from './host-io.js';
import { canonicalJson } from './lock.js';
import type { ManagedInstallationRecord } from './managed-lifecycle.js';

/** Call after generation validation. Hold the host writer lock before selecting it. */
export async function readVerifiedManagedInstallation(
  host: DurableModHost,
  generation: GenerationPointer | GenerationManifest,
  required = false,
  io: HostIo = host.hostIo,
): Promise<ManagedInstallationRecord | null> {
  try {
    const pointer = 'selectedAt' in generation ? generation : { ...generation, selectedAt: generation.createdAt };
    const files = await host.readGenerationArtifacts(pointer, ['installed-index.json', 'installation.json']);
    const index = JSON.parse(new TextDecoder().decode(files['installed-index.json'])) as { installationPrefix?: unknown; installationId?: unknown };
    const bytes = files['installation.json'];
    const record = bytes ? JSON.parse(new TextDecoder().decode(bytes)) as ManagedInstallationRecord : null;
    const hasManagedRecord = record && typeof record === 'object'
      && ('prefix' in record || 'planHash' in record);
    if (index.installationPrefix === undefined && !hasManagedRecord && !required) return null;
    if (!record || record.schemaVersion !== 1 || typeof record.prefix !== 'string'
      || !record.prefix || isAbsolute(record.prefix)
      || record.prefix !== index.installationPrefix || record.installationId !== index.installationId) {
      throw new Error('installation record does not match its generation index');
    }
    const prefix = resolve(host.root, record.prefix);
    const within = relative(host.root, prefix);
    if (!within || within === '..' || within.startsWith('../') || isAbsolute(within)
      || !(await io.stat(prefix)).isDirectory()) {
      throw new Error('installation prefix is unavailable or escapes the managed host');
    }
    const qualified = await readJson<ManagedInstallationRecord>(io, join(prefix, 'agon-installation.json'));
    if (canonicalJson(qualified) !== canonicalJson(record)) throw new Error('installation record does not match its immutable prefix');
    return record;
  } catch (cause) {
    throw new DurableHostError('MOD_GENERATION_CORRUPT', 'managed installation is unavailable or corrupt', { generation: generation.generation }, { cause });
  }
}
