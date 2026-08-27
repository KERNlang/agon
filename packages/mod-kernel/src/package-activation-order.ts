import type { FirstPartySurfacePackage } from './activated-surface-generation.js';

/** Topologically order physical packages while ignoring dependencies supplied by the host. */
export function orderPhysicalSurfacePackages(
  packages: readonly FirstPartySurfacePackage[],
): readonly FirstPartySurfacePackage[] {
  const byId = new Map(packages.map((candidate) => [candidate.manifest.id, candidate]));
  if (byId.size !== packages.length) throw new Error('duplicate physical surface package');

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: FirstPartySurfacePackage[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`physical surface package dependency cycle: ${id}`);
    visiting.add(id);
    const candidate = byId.get(id)!;
    for (const dependency of candidate.manifest.dependencies.required) {
      if (byId.has(dependency.id)) visit(dependency.id);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(candidate);
  };

  for (const id of [...byId.keys()].sort()) visit(id);
  return Object.freeze(ordered);
}
