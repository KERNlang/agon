import type { AgonModV1, Dispose, ModManifest, ModServices } from '@kernlang/agon-mod-api';

import {
  SurfaceGeneration,
  type GeneratedSurfaceCatalogEntry,
  type GeneratedSurfaceRuntime,
  type SurfaceGenerationMode,
} from './surface-generation.js';
import { orderPhysicalSurfacePackages } from './package-activation-order.js';

export interface FirstPartySurfacePackage {
  readonly manifest: ModManifest;
  readonly mod: AgonModV1;
  readonly services: ModServices;
}

export interface ActivatedSurfaceGeneration {
  readonly generation: SurfaceGeneration;
  dispose(): Promise<void>;
}

/** Build one generation by activating the supplied physical mod packages. */
export async function activateFirstPartySurfaceGeneration(options: {
  readonly id: string;
  readonly mode?: SurfaceGenerationMode;
  readonly catalog: readonly GeneratedSurfaceCatalogEntry[];
  readonly runtime: GeneratedSurfaceRuntime;
  readonly packages: readonly FirstPartySurfacePackage[];
  readonly disabledOwnerIds?: readonly string[];
}): Promise<ActivatedSurfaceGeneration> {
  const disabled = new Set(options.disabledOwnerIds ?? []);
  const physicalOwnerIds = new Set(options.packages.map(({ manifest }) => manifest.id));
  const activeCatalog = options.catalog.filter(({ owner }) => !disabled.has(owner.id));
  const requiredPhysicalOwnerIds = [...new Set(activeCatalog.filter(({ ownerClass }) => ownerClass === 'user-toggleable-mod-package').map(({ owner }) => owner.id))];
  const missingPhysicalOwnerIds = requiredPhysicalOwnerIds.filter((ownerId) => !physicalOwnerIds.has(ownerId));
  if (missingPhysicalOwnerIds.length > 0) throw new Error('active user surface owners lack physical packages: ' + missingPhysicalOwnerIds.join(', '));
  const syntheticOwnerIds = [...new Set(activeCatalog.filter(({ ownerClass }) => ownerClass !== 'user-toggleable-mod-package').map(({ owner }) => owner.id))];
  const generation = new SurfaceGeneration({
    id: options.id,
    mode: options.mode ?? 'generated-authoritative',
    catalog: options.catalog,
    runtime: options.runtime,
    disabledOwnerIds: options.disabledOwnerIds,
    syntheticOwnerIds,
  });
  const disposers: Dispose[] = [];
  try {
    for (const candidate of orderPhysicalSurfacePackages(options.packages)) {
      if (disabled.has(candidate.manifest.id)) continue;
      if (!activeCatalog.some(({ owner }) => owner.id === candidate.manifest.id)) {
        throw new Error(`physical surface package has no active catalog owner: ${candidate.manifest.id}`);
      }
      const session = generation.registry.beginRegistration(candidate.manifest);
      try {
        const dispose = await candidate.mod.activate(session.registrar, candidate.services);
        session.commit();
        if (dispose) disposers.push(dispose);
      } catch (error) {
        await session.rollback();
        throw error;
      }
    }
  } catch (error) {
    for (const dispose of [...disposers].reverse()) await dispose();
    throw error;
  }
  return Object.freeze({
    generation,
    dispose: async () => {
      for (const dispose of [...disposers].reverse()) await dispose();
    },
  });
}
