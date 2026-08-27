import type { ModPlatform } from '@kernlang/agon-mod-api';

import type { FirstPartySurfacePackage } from './activated-surface-generation.js';
import type { CanonicalModLock } from './lock.js';
import { canonicalJson, sha256Canonical } from './lock.js';

function platform(): ModPlatform {
  const value = `${process.platform}-${process.arch}`;
  if (value === 'darwin-arm64' || value === 'darwin-x64' || value === 'linux-arm64' || value === 'linux-x64') return value;
  throw new Error(`unsupported Modular Agon platform: ${value}`);
}

/** Bind ambient bundled modules to the identities selected by the immutable generation lock. */
export function assertFirstPartyPackagesMatchLock(
  activePackageIds: readonly string[],
  packages: readonly FirstPartySurfacePackage[],
  lock: CanonicalModLock,
): void {
  const lockIds = lock.packages.map(({ id }) => id);
  if (new Set(lockIds).size !== lockIds.length) throw new Error('canonical lock contains duplicate package identities');
  const locked = new Map(lock.packages.map((entry) => [entry.id, entry]));
  const loaded = new Map(packages.map((entry) => [entry.manifest.id, entry]));
  if (loaded.size !== packages.length) throw new Error('physical first-party package identities are duplicated');

  for (const packageId of activePackageIds) {
    const manifestId = packageId.replace(/^@kernlang\/agon-mod-/, 'agon.');
    const candidate = loaded.get(manifestId);
    const record = locked.get(manifestId);
    if (!candidate || !record || !record.enabled) throw new Error(`selected first-party package is absent or disabled in lock: ${packageId}`);
    const dependencies = candidate.manifest.dependencies.required.map(({ id }) => id).sort();
    if (record.source !== 'bundled' || record.sourceLocator !== packageId
      || record.version !== candidate.manifest.version
      || record.platform !== platform()
      || record.manifestHash !== sha256Canonical(candidate.manifest)
      || canonicalJson(record.dependencies) !== canonicalJson(dependencies)) {
      throw new Error(`selected first-party package does not match canonical lock: ${packageId}`);
    }
  }
}
