import {
  createFirstPartyModCatalog,
  resolveDesiredState,
  sha256Canonical,
  type CanonicalModLock,
  type DesiredModState,
} from '../../packages/mod-kernel/src/index.js';

export async function surfaceLockFor(state: DesiredModState): Promise<CanonicalModLock> {
  const catalog = createFirstPartyModCatalog();
  const activeIds = [...resolveDesiredState(catalog, state).effectivePackages].sort();
  const packages = await Promise.all(activeIds.map(async (id, resolutionOrder) => {
    const definition = catalog.packagesById.get(id)!;
    const loaded = definition.class === "user-toggleable-mod-package" ? await import(id) : undefined;
    const manifest = loaded?.MANIFEST ?? {
      id,
      version: "0.0.0-slice.6",
      dependencies: { required: definition.dependencies.map((dependency) => ({ id: dependency })) },
    };
    const manifestHash = sha256Canonical(manifest);
    return Object.freeze({
      id: manifest.id,
      version: manifest.version,
      source: "bundled" as const,
      sourceLocator: id,
      contentHash: manifestHash,
      manifestHash,
      platform: (process.platform + "-" + process.arch) as "darwin-arm64",
      enabled: true,
      resolutionOrder,
      dependencies: Object.freeze(manifest.dependencies.required.map(({ id: dependency }: { id: string }) => dependency).sort()),
      trustRecordId: "bundled:" + id,
      grantRecordIds: Object.freeze([]),
    });
  }));
  const desiredStateHash = sha256Canonical(state);
  const graphHash = sha256Canonical({ kernelVersion: '1.0.0', apiVersion: '1.0.0', desiredStateHash, packages });
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: '1.0.0',
    apiVersion: '1.0.0',
    desiredStateHash,
    graphHash,
    packages: Object.freeze(packages),
  });
}
