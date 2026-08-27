import { describe, expect, it } from 'vitest';

import { assertSelectedLockIntegrity, assertSelectedLockPackageClosure } from '../../packages/mod-kernel/src/selected-lock-integrity.js';
import { sha256Canonical, type CanonicalModLock } from '../../packages/mod-kernel/src/index.js';

function lock(desired: unknown): CanonicalModLock {
  const desiredStateHash = sha256Canonical(desired);
  const packages = Object.freeze([]);
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    desiredStateHash,
    graphHash: sha256Canonical({ kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash, packages }),
    packages,
  });
}

describe('selected canonical lock integrity', () => {
  it('binds the full desired state and recomputes graph identity', () => {
    const desired = { selected: ['agon.ask'], revision: 3 };
    const valid = lock(desired);
    expect(() => assertSelectedLockIntegrity(valid, desired)).not.toThrow();
    expect(() => assertSelectedLockIntegrity(valid, { ...desired, revision: 4 })).toThrow(/desired state/);
    expect(() => assertSelectedLockIntegrity({ ...valid, graphHash: sha256Canonical('forged') }, desired)).toThrow(/graph hash/);
  });

  it("binds the exact resolver package closure by source locator", () => {
    const base = lock({ selected: [] });
    const record = {
      id: "agon.ask", version: "1.0.0", source: "bundled" as const, sourceLocator: "/agon-mod-ask",
      contentHash: sha256Canonical("content"), manifestHash: sha256Canonical("manifest"),
      platform: "darwin-arm64" as const, enabled: true, resolutionOrder: 0, dependencies: [],
      trustRecordId: "bundled:ask", grantRecordIds: [],
    };
    const selected = { ...base, packages: [record] };
    expect(() => assertSelectedLockPackageClosure(selected, ["/agon-mod-ask"])).not.toThrow();
    expect(() => assertSelectedLockPackageClosure(selected, [])).toThrow(/package closure/);
    expect(() => assertSelectedLockPackageClosure({ ...selected, packages: [record, { ...record, id: "agon.ask-copy", resolutionOrder: 1 }] }, ["/agon-mod-ask"])).toThrow(/duplicate source locators/);
  });
});
