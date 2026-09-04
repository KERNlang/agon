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
  readonly failedOwnerIds: readonly string[];
  dispose(): Promise<void>;
}

async function disposeReverse(disposers: readonly Dispose[], context: string): Promise<void> {
  const failures: unknown[] = [];
  for (const dispose of [...disposers].reverse()) {
    try { await dispose(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, context);
}

/** Build one generation by activating the supplied physical mod packages. */
export async function activateFirstPartySurfaceGeneration(options: {
  readonly id: string;
  readonly mode?: SurfaceGenerationMode;
  readonly catalog: readonly GeneratedSurfaceCatalogEntry[];
  readonly runtime: GeneratedSurfaceRuntime;
  readonly packages: readonly FirstPartySurfacePackage[];
  readonly providedDependencyIds?: readonly string[];
  readonly disabledOwnerIds?: readonly string[];
  readonly isolatePackageFailure?: (candidate: FirstPartySurfacePackage, error: unknown) => boolean | Promise<boolean>;
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
  const failedOwnerIds = new Set<string>();
  try {
    for (const candidate of orderPhysicalSurfacePackages(options.packages, options.providedDependencyIds)) {
      if (disabled.has(candidate.manifest.id)) continue;
      const failedDependencies = candidate.manifest.dependencies.required.map(({ id }) => id).filter((id) => failedOwnerIds.has(id));
      if (failedDependencies.length > 0) {
        const error = new Error(`physical surface package dependency failed: ${candidate.manifest.id} requires ${failedDependencies.join(', ')}`);
        if (!options.isolatePackageFailure || !await options.isolatePackageFailure(candidate, error)) throw error;
        failedOwnerIds.add(candidate.manifest.id);
        continue;
      }
      if (!activeCatalog.some(({ owner }) => owner.id === candidate.manifest.id)) {
        throw new Error(`physical surface package has no active catalog owner: ${candidate.manifest.id}`);
      }
      const session = generation.registry.beginRegistration(candidate.manifest);
      let candidateDispose: Dispose | void = undefined;
      try {
        candidateDispose = await candidate.mod.activate(session.registrar, candidate.services);
        session.commit();
        if (candidateDispose) disposers.push(candidateDispose);
        candidateDispose = undefined;
      } catch (error) {
        const cleanupFailures: unknown[] = [];
        if (candidateDispose) {
          try { await candidateDispose(); }
          catch (cleanupError) { cleanupFailures.push(cleanupError); }
        }
        try { await session.rollback(); }
        catch (cleanupError) { cleanupFailures.push(cleanupError); }
        if (cleanupFailures.length > 0) {
          throw new AggregateError([error, ...cleanupFailures], `failed to activate and clean up ${candidate.manifest.id}`);
        }
        if (!options.isolatePackageFailure || !await options.isolatePackageFailure(candidate, error)) throw error;
        failedOwnerIds.add(candidate.manifest.id);
      }
    }
  } catch (error) {
    try { await disposeReverse(disposers, 'one or more activated mods failed to dispose after activation failure'); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'surface generation activation and cleanup failed'); }
    throw error;
  }
  return Object.freeze({
    generation,
    failedOwnerIds: Object.freeze([...failedOwnerIds].sort()),
    dispose: async () => {
      await disposeReverse(disposers, 'one or more activated mods failed to dispose');
    },
  });
}
