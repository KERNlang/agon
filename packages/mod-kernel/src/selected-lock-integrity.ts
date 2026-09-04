import type { CanonicalModLock } from './lock.js';
import { sha256Canonical } from './lock.js';

/** Recompute the self-authenticating lock fields that the durable manifest binds by bytes. */
export function assertSelectedLockIntegrity(lock: CanonicalModLock, desiredState: unknown): void {
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.packages)) throw new Error('selected canonical lock is malformed');
  const desiredStateHash = sha256Canonical(desiredState);
  if (lock.desiredStateHash !== desiredStateHash) throw new Error('selected canonical lock does not bind desired state');
  const graphHash = sha256Canonical({
    kernelVersion: lock.kernelVersion,
    apiVersion: lock.apiVersion,
    desiredStateHash: lock.desiredStateHash,
    packages: lock.packages,
  });
  if (lock.graphHash !== graphHash) throw new Error('selected canonical lock graph hash is invalid');
  for (const [index, record] of lock.packages.entries()) {
    if (record.resolutionOrder !== index) throw new Error(`selected canonical lock resolution order is invalid: ${record.id}`);
  }
}

/** Require the selected lock to describe exactly the resolver effective package closure. */
export function assertSelectedLockPackageClosure(
  lock: CanonicalModLock,
  effectivePackageIds: readonly string[],
): void {
  const selected = lock.packages.map(({ id }) => id.startsWith('agon.') ? `@kernlang/agon-mod-${id.slice('agon.'.length)}` : id).sort();
  const effective = [...effectivePackageIds].sort();
  if (new Set(selected).size !== selected.length) throw new Error('selected canonical lock contains duplicate physical package identities');
  if (JSON.stringify(selected) !== JSON.stringify(effective)) {
    throw new Error('selected canonical lock does not match the resolved package closure');
  }
}
