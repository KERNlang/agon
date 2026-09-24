import type { FirstPartySurfacePackage } from './activated-surface-generation.js';

/** Logical capabilities implemented by the kernel/support layer, not physical user mods. */
export const HOST_PROVIDED_DEPENDENCY_IDS = Object.freeze([
  'agon.agent-runtime', 'agon.api', 'agon.browser-bridge', 'agon.dedup',
  'agon.engine-runtime', 'agon.judge', 'agon.panel', 'agon.persistence',
  'agon.saas-api', 'agon.verification', 'agon.worktree',
]);

/** Topologically order physical packages while ignoring dependencies supplied by the host. */
export function orderPhysicalSurfacePackages(
  packages: readonly FirstPartySurfacePackage[],
  providedDependencyIds: readonly string[] = HOST_PROVIDED_DEPENDENCY_IDS,
): readonly FirstPartySurfacePackage[] {
  const byId = new Map(packages.map((candidate) => [candidate.manifest.id, candidate]));
  if (byId.size !== packages.length) throw new Error('duplicate physical surface package');
  const provided = new Set(providedDependencyIds);

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
      else if (!provided.has(dependency.id)) {
        throw new Error(`physical surface package dependency is missing: ${id} requires ${dependency.id}`);
      }
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(candidate);
  };

  for (const id of [...byId.keys()].sort()) visit(id);
  return Object.freeze(ordered);
}
