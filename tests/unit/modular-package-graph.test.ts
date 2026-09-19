import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_PACKAGE_GRAPH } from '../../packages/mod-kernel/src/generated/first-party-package-graph.js';

describe('frozen first-party package graph', () => {
  it('contains the complete 49-package/151-edge target map without dangling dependencies', () => {
    expect(FIRST_PARTY_PACKAGE_GRAPH.packages).toHaveLength(49);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges).toHaveLength(151);
    const ids = new Set(FIRST_PARTY_PACKAGE_GRAPH.packages.map(({ id }) => id));
    expect(ids.size).toBe(49);
    for (const entry of FIRST_PARTY_PACKAGE_GRAPH.packages) {
      for (const dependency of entry.dependencies) expect(ids.has(dependency), `${entry.id} -> ${dependency}`).toBe(true);
    }
  });

  it('is acyclic and keeps user mods dependent on the public protocol rather than private source paths', () => {
    const dependencies = new Map(FIRST_PARTY_PACKAGE_GRAPH.packages.map(({ id, dependencies }) => [id, dependencies]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`package cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of dependencies.get(id) ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of dependencies.keys()) visit(id);
    expect(dependencies.get('@kernlang/agon-mod-api')).toEqual([]);
    expect(dependencies.get('@kernlang/agon-kernel')).toContain('@kernlang/agon-mod-api');
    for (const entry of FIRST_PARTY_PACKAGE_GRAPH.packages.filter(({ class: packageClass }) => packageClass === 'user-toggleable-mod-package')) {
      expect(entry.dependencies).toContain('@kernlang/agon-mod-api');
    }
  });
});
