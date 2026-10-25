import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_PARTY_PACKAGE_GRAPH } from '../../packages/mod-kernel/src/generated/first-party-package-graph.js';

describe('frozen first-party package graph', () => {
  it.each(['valid', 'duplicate', 'missing-schema', 'other-owner', 'invalid-enum', 'reserved'] as const)(
    'generates new owner settings without changing frozen ownership: %s', variant => {
      const generator = new URL('../../scripts/spec/generate-modular-first-party-packages.mjs', import.meta.url);
      const schemaPath = fileURLToPath(new URL('../../packages/mod-ratings/schemas/config.schema.json', import.meta.url));
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const aliases = schema['x-agon-config'].legacyAliases as string[];
      if (variant === 'duplicate') aliases.push(aliases[0]);
      if (variant === 'missing-schema') aliases.push('missingSetting');
      if (variant === 'other-owner') {
        aliases.push('autoReviewAfterForge');
        schema.properties.autoReviewAfterForge = { type: 'boolean', default: true };
      }
      if (variant === 'invalid-enum') schema.properties.ratingJudging.enum = ['off', 'on'];
      if (variant === 'reserved') aliases.push('constructor');
      const outputs = new Map<string, string>();
      const source = readFileSync(generator, 'utf8').replace(/^import .*;\n/gm, '')
        .replaceAll('import.meta.dirname', JSON.stringify(dirname(fileURLToPath(generator))));
      const run = () => runInNewContext(source, {
        readFileSync: (path: string, encoding: BufferEncoding) => path === schemaPath ? JSON.stringify(schema) : readFileSync(path, encoding),
        existsSync, resolve, createHash, Buffer, process: { argv: [] },
        mkdirSync: () => {}, console: { log: () => {} },
        writeFileSync: (path: string, contents: string) => outputs.set(path, contents),
      });
      if (variant !== 'valid') expect(run).toThrow();
      else {
        expect(run).not.toThrow();
        const settings = outputs.get(fileURLToPath(new URL('../../packages/support-persistence/src/first-party-settings.generated.ts', import.meta.url)))!;
        expect(settings).toContain('ratingJudging?: "off" | "shadow" | "on";');
        expect(settings).toContain('"ratingIdentityConfirmRuns": 2');
        expect(settings).toContain('"chairExplorationRate": 0.2');
        expect([...outputs.keys()].some(path => path.endsWith('/modular-agon-ownership.json'))).toBe(false);
      }
    },
  );
  it('regenerates first-party metadata without erasing current public exports or capabilities', () => {
    const generator = new URL('../../scripts/spec/generate-modular-first-party-packages.mjs', import.meta.url);
    const outputs = new Map<string, string>();
    const source = readFileSync(generator, 'utf8').replace(/^import .*;\n/gm, '')
      .replaceAll('import.meta.dirname', JSON.stringify(dirname(fileURLToPath(generator))));
    runInNewContext(source, {
      readFileSync, existsSync, resolve, createHash, Buffer, process: { argv: [] },
      mkdirSync: () => {}, console: { log: () => {} },
      writeFileSync: (path: string, contents: string) => outputs.set(path, contents),
    });
    expect(outputs.size).toBeGreaterThan(0);
    for (const [path, contents] of outputs) expect(contents, path).toBe(readFileSync(path, 'utf8'));
  });

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
    const ownershipPath = fileURLToPath(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url));
    const generatedOwnership = JSON.parse(outputs.get(ownershipPath)!);
    expect(generatedOwnership).toEqual(JSON.parse(readFileSync(ownershipPath, 'utf8')));
    const assignments = generatedOwnership.assignments as Array<{ category: string; id: string; source: string; package: string }>;
    const inventory = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-current-inventory.json', import.meta.url), 'utf8'));
    const occurrenceKeys = assignments.map(row => JSON.stringify([row.category, row.id, row.source]));
    const inventoryKeys = Object.entries(inventory.categories as Record<string, Array<{ id: string; source: string }>>)
      .flatMap(([category, entries]) => entries.map(row => JSON.stringify([category, row.id, row.source])));
    expect(new Set(occurrenceKeys).size).toBe(occurrenceKeys.length);
    expect(occurrenceKeys.sort()).toEqual(inventoryKeys.sort());
    // The outer legacy package must not hide a workflow's specific owner.
    for (const [sourceName, owner] of [
      ['campfire', 'campfire'], ['council', 'council'], ['conquer', 'conquer'],
      ['goal', 'goal'], ['mutate', 'mutate'], ['naturalize', 'naturalize'],
      ['nero', 'nero'], ['research', 'research'], ['synthesis-modus', 'synthesis'],
      ['thinking', 'think'],
    ]) {
      const entries = assignments.filter(row => new RegExp(`^packages/forge/src/${sourceName}(?:[./-])`).test(row.source));
      expect(entries.length, sourceName).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.package, `${entry.id} at ${entry.source}`).toBe(`@kernlang/agon-mod-${owner}`);
    }
    // Shared words in a name must not move Forge's own settings or result type.
    expect(assignments.find(row => row.id === 'autoReviewAfterForge')?.package).toBe('@kernlang/agon-mod-forge');
    for (const id of ['AgentInvestigateSynthesisResult', 'AgentSynthesisResult']) {
      expect(assignments.find(row => row.id === id)?.package).toBe('@kernlang/agon-mod-agent');
    }
    expect(assignments.find(row => row.id === 'PostSynthesisFitnessResult')?.package).toBe('@kernlang/agon-mod-forge');
    expect(assignments.find(row => row.id === 'SynthesisResult' && row.source.startsWith('packages/forge/src/types-impl.ts:'))?.package).toBe('@kernlang/agon-mod-forge');
  });

  it('removes reassigned roadmap sources but preserves unassigned manual sources', () => {
    const script = new URL('../../scripts/spec/reconcile-modular-roadmap-sources.mjs', import.meta.url);
    const roadmapPath = fileURLToPath(new URL('../../docs/specs/evidence/modular-agon-implementation-roadmap.json', import.meta.url));
    const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    const forge = roadmap.packages.find((pkg: { id: string }) => pkg.id === '@kernlang/agon-mod-forge');
    forge.extractionSources.push('packages/forge/src/conquer.ts:146', 'manual/unassigned.ts:1');
    let output: typeof roadmap;
    const source = readFileSync(script, 'utf8').replace(/^import .*;\n/gm, '')
      .replaceAll('import.meta.dirname', JSON.stringify(dirname(fileURLToPath(script))));
    runInNewContext(source, {
      join, resolve, console: { log: () => {} },
      readFileSync: (path: string, encoding: BufferEncoding) => path === roadmapPath ? JSON.stringify(roadmap) : readFileSync(path, encoding),
      writeFileSync: (_path: string, contents: string) => { output = JSON.parse(contents); },
    });
    const updatedForge = output.packages.find((pkg: { id: string }) => pkg.id === '@kernlang/agon-mod-forge');
    const conquer = output.packages.find((pkg: { id: string }) => pkg.id === '@kernlang/agon-mod-conquer');
    expect(updatedForge.extractionSources).not.toContain('packages/forge/src/conquer.ts:146');
    expect(updatedForge.extractionSources).toContain('manual/unassigned.ts:1');
    expect(updatedForge.extractionSources).toContain('packages/forge/src/types-impl.ts:10');
    expect(conquer.extractionSources).toContain('packages/forge/src/conquer.ts:146');
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
          migration: { packages: 11, counts: { packages: 36, assignments: 348 } },
          behaviorAudit: { status: 'green' }, inventoryAssignments,
          coverage: {}, coveragePasses: () => true, freshPlatformPassed: true,
          freshPerformancePassed: true, performances: [{ passed: true }],
          performancePasses: (value: { passed: boolean }) => value.passed, freshLoadPassed: true,
        });
        expect(receipt.passed, name).toBe(expected);
      }
    },
  );

  it('contains the complete 49-package/158-edge target map without dangling dependencies', () => {
    expect(FIRST_PARTY_PACKAGE_GRAPH.packages).toHaveLength(49);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges).toHaveLength(158);
    expect(FIRST_PARTY_PACKAGE_GRAPH.packages.find(({ id }) => id === '@kernlang/agon-support-persistence')?.dependencies)
      .toEqual(['@kernlang/agon-kernel', '@kernlang/agon-support-engine-runtime', '@kernlang/agon-support-browser-bridge']);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.filter(({ from, to }) =>
      from === '@kernlang/agon-support-worktree' && to === '@kernlang/agon-support-engine-runtime',
    )).toEqual([{ from: '@kernlang/agon-support-worktree', to: '@kernlang/agon-support-engine-runtime', kind: 'hard' }]);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.filter(({ from, to }) =>
      from === '@kernlang/agon-mod-conquer' && to === '@kernlang/agon-mod-brainstorm',
    )).toEqual([{ from: '@kernlang/agon-mod-conquer', to: '@kernlang/agon-mod-brainstorm', kind: 'hard' }]);
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.filter(({ from, to }) =>
      from === '@kernlang/agon-mod-plan' && to === '@kernlang/agon-support-worktree',
    )).toEqual([{ from: '@kernlang/agon-mod-plan', to: '@kernlang/agon-support-worktree', kind: 'hard' }]);
    const ids = new Set(FIRST_PARTY_PACKAGE_GRAPH.packages.map(({ id }) => id));
    expect(ids.size).toBe(49);
    for (const entry of FIRST_PARTY_PACKAGE_GRAPH.packages) {
      for (const dependency of entry.dependencies) expect(ids.has(dependency), `${entry.id} -> ${dependency}`).toBe(true);
    }
  });

  it('declares Goal competition as a hard dependency on the existing Forge owner', () => {
    expect(FIRST_PARTY_PACKAGE_GRAPH.dependencyEdges.filter(({ from, to }) =>
      from === '@kernlang/agon-mod-goal' && to === '@kernlang/agon-mod-forge',
    )).toEqual([{ from: '@kernlang/agon-mod-goal', to: '@kernlang/agon-mod-forge', kind: 'hard' }]);
    const manifest = JSON.parse(readFileSync(new URL('../../packages/mod-goal/agon.mod.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies.required).toContainEqual({ id: 'agon.forge', range: '>=0.0.0-0' });
    const metadata = JSON.parse(readFileSync(new URL('../../packages/mod-goal/package.json', import.meta.url), 'utf8'));
    expect(metadata.dependencies['@kernlang/agon-mod-forge']).toBe('1.0.0');
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
