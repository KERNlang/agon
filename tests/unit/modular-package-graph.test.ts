import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { FIRST_PARTY_PACKAGE_GRAPH } from '../../packages/mod-kernel/src/generated/first-party-package-graph.js';

describe('frozen first-party package graph', () => {
  it.each(['clean-checkout', 'slice2', 'slice3', 'slice4', 'slice5', 'slice6', 'slice7', 'slice8', 'slice9'])(
    '%s qualifies the approved graph and rejects missing, extra or duplicate edges', name => {
      const source = readFileSync(new URL(`../../scripts/spec/qualify-modular-agon-${name}.mjs`, import.meta.url), 'utf8');
      const decision = source.match(/receipt\.passed = [\s\S]*?;\n/)?.[0];
      expect(decision, 'qualifier must produce a receipt verdict').toBeDefined();
      const inventory = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-current-inventory.json', import.meta.url), 'utf8'));
      const inventoryAssignments = Object.values(inventory.categories as Record<string, unknown[]>).reduce((sum, entries) => sum + entries.length, 0);
      const edges = FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.length;
      for (const [uniqueEdges, duplicateEdges, expected] of [
        [edges, [], true], [edges - 1, [], false], [edges + 1, [], false], [edges, ['duplicate'], false],
      ] as const) {
        const receipt = { passed: false };
        // Other gate outcomes are fixtures. The complete decision must reject a bad graph.
        runInNewContext(decision!, {
          receipt, graph: { uniqueEdges, duplicateEdges }, noContamination: true, exactCommit: true,
          contamination: {}, subjectKind: 'commit', indexHash: 'same', commitHash: 'same',
          reviewEvidence: { passed: true }, steps: [{ passed: true }],
          performance: { passed: true, budgets: { coldGreen: true, rssGreen: true, planGreen: true, groupedViewGreen: true } },
          migration: { packages: 11, counts: { packages: 36, assignments: 344 } },
          behaviorAudit: { status: 'green' }, inventoryAssignments,
          coverage: {}, coveragePasses: () => true, freshPlatformPassed: true,
          freshPerformancePassed: true, performances: [{ passed: true }],
          performancePasses: (value: { passed: boolean }) => value.passed, freshLoadPassed: true,
        });
        expect(receipt.passed, name).toBe(expected);
      }
    },
  );

  it('contains the complete 49-package/152-edge target map without dangling dependencies', () => {
    expect(FIRST_PARTY_PACKAGE_GRAPH.packages).toHaveLength(49);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges).toHaveLength(152);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.filter(({ from, to }) =>
      from === '@kernlang/agon-mod-plan' && to === '@kernlang/agon-support-worktree',
    )).toEqual([{ from: '@kernlang/agon-mod-plan', to: '@kernlang/agon-support-worktree', kind: 'hard' }]);
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
