import { describe, expect, it } from 'vitest';

import { assertFirstPartyPackagesMatchLock } from '../../packages/mod-kernel/src/first-party-lock-validation.js';
import { sha256Canonical, type CanonicalModLock } from '../../packages/mod-kernel/src/index.js';

const packageId = '@kernlang/agon-mod-ask';
const platform = `${process.platform}-${process.arch}` as 'darwin-arm64';

async function fixture() {
  const loaded: any = await import(packageId);
  const candidate: any = { manifest: loaded.MANIFEST, mod: {}, services: {} };
  const record = Object.freeze({
    id: loaded.MANIFEST.id,
    version: loaded.MANIFEST.version,
    source: 'bundled' as const,
    sourceLocator: packageId,
    contentHash: sha256Canonical(loaded.MANIFEST),
    manifestHash: sha256Canonical(loaded.MANIFEST),
    platform,
    enabled: true,
    resolutionOrder: 0,
    dependencies: Object.freeze(loaded.MANIFEST.dependencies.required.map(({ id }: { id: string }) => id).sort()),
    trustRecordId: `bundled:${packageId}`,
    grantRecordIds: Object.freeze([]),
  });
  const lock = (packages: readonly typeof record[]): CanonicalModLock => {
    const desiredStateHash = sha256Canonical([]);
    return Object.freeze({ schemaVersion: 1, kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash,
      graphHash: sha256Canonical({ kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash, packages }), packages });
  };
  return { candidate, record, lock };
}

describe('selected first-party lock binding', () => {
  it('accepts the exact bundled identity and rejects absence, version drift, and duplicates', async () => {
    const { candidate, record, lock } = await fixture();
    expect(() => assertFirstPartyPackagesMatchLock([packageId], [candidate], lock([record]))).not.toThrow();
    expect(() => assertFirstPartyPackagesMatchLock([packageId], [candidate], lock([]))).toThrow(/absent or disabled/);
    expect(() => assertFirstPartyPackagesMatchLock([packageId], [candidate], lock([{ ...record, version: '9.9.9' }]))).toThrow(/does not match/);
    expect(() => assertFirstPartyPackagesMatchLock([packageId], [candidate], lock([record, record]))).toThrow(/duplicate/);
  });
});
