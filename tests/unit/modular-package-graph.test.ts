import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_PARTY_PACKAGE_GRAPH } from '../../packages/mod-kernel/src/generated/first-party-package-graph.js';

describe('frozen first-party package graph', () => {
  it('regenerates the complete authoritative package map without losing approved dependencies', () => {
    const generator = new URL('../../scripts/spec/generate-modular-agon-ownership.mjs', import.meta.url);
    const outputs = new Map<string, string>();
    const source = readFileSync(generator, 'utf8')
      .replace(/^import .*;\n/gm, '')
      .replaceAll('import.meta.dirname', JSON.stringify(dirname(fileURLToPath(generator))));
    runInNewContext(source, {
      readFileSync, join, resolve, process: { env: {} },
      mkdirSync: () => {}, console: { log: () => {} },
      writeFileSync: (path: string, contents: string) => outputs.set(path, contents),
    });
    const mapPath = fileURLToPath(new URL('../../docs/specs/evidence/modular-agon-package-map.json', import.meta.url));
    expect(outputs.has(mapPath)).toBe(true);
    expect(JSON.parse(outputs.get(mapPath)!)).toEqual(JSON.parse(readFileSync(mapPath, 'utf8')));
  });

  it.each(['checked-in', 'valid', 'permuted', 'missing', 'extra', 'swapped', 'duplicate', 'wrong-order'] as const)(
    'roadmap verification checks exact dependencies and migration order: %s', variant => {
      const script = new URL('../../scripts/spec/verify-modular-agon-roadmap.mjs', import.meta.url);
      const roadmap = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-implementation-roadmap.json', import.meta.url), 'utf8'));
      const graph = FIRST_PARTY_PACKAGE_GRAPH;
      const order: string[] = [];
      const visit = (id: string): void => {
        if (order.includes(id)) return;
        for (const dependency of graph.packages.find(entry => entry.id === id)!.dependencies) visit(dependency);
        order.push(id);
      };
      for (const entry of graph.packages) visit(entry.id);
      for (const entry of roadmap.packages) {
        if (variant === 'checked-in') continue;
        entry.dependencies = [...graph.packages.find(pkg => pkg.id === entry.id)!.dependencies];
        entry.migrationOrder = order.indexOf(entry.id) + 1;
      }
      const plan = roadmap.packages.find((entry: { id: string }) => entry.id === '@kernlang/agon-mod-plan');
      if (variant === 'permuted') for (const entry of roadmap.packages) entry.dependencies.reverse();
      if (variant === 'missing' || variant === 'swapped') plan.dependencies = plan.dependencies.filter((id: string) => id !== '@kernlang/agon-support-worktree');
      if (variant === 'extra' || variant === 'swapped') plan.dependencies.push('@kernlang/agon-kernel');
      if (variant === 'duplicate') plan.dependencies.push(plan.dependencies[0]);
      if (variant === 'wrong-order') plan.migrationOrder = 1;
      const migration = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-slice5-migration-ledger.json', import.meta.url), 'utf8'));
      const errors: string[] = [];
      const source = readFileSync(script, 'utf8').replace(/^import .*;\n/gm, '')
        .replace('import.meta.url', JSON.stringify(script.href));
      const run = () => runInNewContext(source, {
        URL, existsSync,
        readFileSync: (path: string, encoding: BufferEncoding) => path.endsWith('/modular-agon-implementation-roadmap.json')
          ? JSON.stringify(roadmap) : readFileSync(path, encoding),
        // Relocation verification is independent of this dependency-drift control.
        collectPlanSourceRelocations: () => migration.sourceRelocations,
        console: { log: () => undefined, error: (message: string) => errors.push(message) },
        process: { exit: (code: number) => { throw new Error(`exit ${code}`); } },
      });
      if (variant === 'checked-in' || variant === 'valid' || variant === 'permuted') expect(run).not.toThrow();
      else {
        expect(run).toThrow('exit 1');
        expect(errors.join('\n')).toContain('@kernlang/agon-mod-plan');
        if (variant === 'duplicate') {
          expect(errors.join('\n')).toContain('@kernlang/agon-mod-plan has duplicate dependencies');
          expect(errors.join('\n')).toContain('duplicate global edge @kernlang/agon-mod-plan->');
        }
      }
    },
  );

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

  it('contains the complete 49-package/153-edge target map without dangling dependencies', () => {
    expect(FIRST_PARTY_PACKAGE_GRAPH.packages).toHaveLength(49);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges).toHaveLength(153);
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
