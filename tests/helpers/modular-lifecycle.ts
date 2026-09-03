import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanonicalModLock, LockedModPackage } from '../../packages/mod-kernel/src/lock.js';
import type {
  CandidateInstaller,
  CandidateVerifier,
  ManagedLifecycleRequest,
  ManagedPackageArtifact,
} from '../../packages/mod-kernel/src/managed-lifecycle.js';

export const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
export const integrity = (character = 'YQ'): `sha512-${string}` => `sha512-${character}==`;

export function artifact(
  id: string,
  dependencies: readonly string[] = [],
  overrides: Partial<ManagedPackageArtifact> = {},
): ManagedPackageArtifact {
  return Object.freeze({
    id,
    version: '1.0.0',
    source: 'local-cache',
    sourceLocator: `cache:${id}@1.0.0`,
    integrity: integrity(),
    contentHash: hash(id.includes('child') ? 'b' : 'a'),
    manifestHash: hash(id.includes('child') ? 'd' : 'c'),
    dependencies: Object.freeze([...dependencies]),
    lifecycleScripts: Object.freeze([]),
    available: true,
    provenance: 'verified',
    trustTier: 'first-party',
    ...overrides,
  });
}

function locked(entry: ManagedPackageArtifact, resolutionOrder: number): LockedModPackage {
  return Object.freeze({
    id: entry.id,
    version: entry.version,
    source: entry.source === 'linked-development' ? 'explicit-dev' : 'registry',
    sourceLocator: entry.sourceLocator,
    contentHash: entry.contentHash,
    manifestHash: entry.manifestHash,
    platform: 'darwin-arm64',
    enabled: true,
    resolutionOrder,
    dependencies: Object.freeze([...entry.dependencies].sort()),
    trustRecordId: `trust:${entry.id}`,
    grantRecordIds: Object.freeze([]),
  });
}

export function lifecycleLock(entries: readonly ManagedPackageArtifact[], graph = 'e'): CanonicalModLock {
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    desiredStateHash: hash('f'),
    graphHash: hash(graph),
    packages: Object.freeze(entries.map(locked)),
  });
}

export function request(
  entries: readonly ManagedPackageArtifact[],
  overrides: Partial<ManagedLifecycleRequest> = {},
): ManagedLifecycleRequest {
  return Object.freeze({
    operation: 'install',
    networkPolicy: 'frozen-offline',
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    requestedPackageIds: Object.freeze(entries.filter((entry) => entry.id.includes('child') || entries.length === 1).map((entry) => entry.id)),
    artifacts: Object.freeze([...entries]),
    desiredState: Object.freeze({ schemaVersion: 1, enabled: entries.map((entry) => entry.id) }),
    lock: lifecycleLock(entries),
    ...overrides,
  });
}

export const installer: CandidateInstaller = {
  async install(packagePlan, candidatePrefix, context) {
    if (context.ignoreLifecycleScripts !== true) throw new Error('scripts were not disabled');
    const root = join(candidatePrefix, 'node_modules', packagePlan.id);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: packagePlan.id, version: packagePlan.version }));
  },
};

export const verifier: CandidateVerifier = {
  async verify(candidatePrefix, plan) {
    const checks = await Promise.all(plan.packages.map(async (entry) => {
      const bytes = await readFile(join(candidatePrefix, 'node_modules', entry.id, 'package.json'), 'utf8');
      const manifest = JSON.parse(bytes) as { name?: string; version?: string };
      return Object.freeze({ id: `package:${entry.id}`, passed: manifest.name === entry.id && manifest.version === entry.version });
    }));
    return Object.freeze({ passed: checks.every((check) => check.passed), checks: Object.freeze(checks) });
  },
};
