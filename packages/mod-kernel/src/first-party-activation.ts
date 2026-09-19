import { join } from 'node:path';
import type { ActivationArtifacts } from './activation-service.js';
import { ModActivationService } from './activation-service.js';
import { createFirstPartyModCatalog } from './desired-state.js';
import type { DurableModHost } from './durable-host.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import type { CanonicalModLock, LockedModPackage } from './lock.js';

/** Selection changes retain the qualified installation; they do not install code. */
export function createFirstPartyActivationService(host: DurableModHost): ModActivationService {
  const catalog = createFirstPartyModCatalog();
  return new ModActivationService(host, catalog, async (desired, _mods, packageIds) => {
    const pointer = await host.readCurrentPointer();
    if (!pointer) throw new Error('selected generation disappeared');
    await host.validateGeneration(pointer.generation);
    const root = host.generationPath(pointer.generation);
    const read = async (name: string) => new TextDecoder().decode(await host.hostIo.readFile(join(root, name)));
    const previous = JSON.parse(await read('mods.lock.json')) as CanonicalModLock;
    const index = JSON.parse(await read('installed-index.json')) as Record<string, unknown>;
    if (!index || typeof index !== 'object' || Array.isArray(index)) throw new TypeError('installed inventory is malformed');
    // Older generations have no separate inventory. Seed it from their verified
    // lock exactly once; never invent identities for packages not installed there.
    const inventory = (index.lockedPackages ?? previous.packages) as readonly LockedModPackage[];
    if (!Array.isArray(inventory)) throw new TypeError('installed lock inventory is malformed');
    const byId = new Map(inventory.map((entry) => [entry.id, entry]));
    if (byId.size !== inventory.length) throw new TypeError('installed lock inventory contains duplicate identities');
    for (const entry of previous.packages) {
      const installed = byId.get(entry.id);
      if (!installed || canonicalJson({ ...installed, resolutionOrder: 0 }) !== canonicalJson({ ...entry, resolutionOrder: 0 })) {
        throw new TypeError(`installed identity disagrees with selected lock: ${entry.id}`);
      }
    }
    const packages = [...packageIds].sort().map((id, resolutionOrder) => {
      const owner = catalog.packageToModId.get(id) ?? id;
      const installed = byId.get(owner);
      if (!installed) throw new Error(`Package ${id} is not in the qualified installation. Run setup with the required profile before enabling it.`);
      return Object.freeze({ ...installed, resolutionOrder });
    });
    const desiredStateHash = sha256Canonical(desired);
    const graphHash = sha256Canonical({ kernelVersion: previous.kernelVersion, apiVersion: previous.apiVersion, desiredStateHash, packages });
    const files: Record<string, string> = {};
    // The immutable installation descriptor is needed by update/rollback after
    // an enablement change. Do not silently drop its lineage.
    if (index.installationId !== undefined) files['installation.json'] = await read('installation.json');
    return {
      lock: { ...previous, desiredStateHash, graphHash, packages },
      installedIndex: { ...index, lockedPackages: inventory },
      files,
    } satisfies ActivationArtifacts;
  });
}
