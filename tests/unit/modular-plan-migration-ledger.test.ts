import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { collectPlanSourceRelocations } from '../../scripts/spec/modular-plan-source-relocations.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const definitionPath = 'packages/mod-plan/src/execution-model.ts';
const evidencePath = 'tests/unit/modular-plan-facade-retirement.test.ts';
const bindings = ['packages/cli/src/handlers/plan-mode.ts', 'packages/cli/src/signals/dispatch/plan-execution.ts'];
const rows = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8')).assignments;
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'agon-plan-relocation-'));
  temporary.push(directory);
  for (const path of [definitionPath, evidencePath, ...bindings]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), readFileSync(join(root, path)));
  }
  return directory;
}

it('reproduces the migration ledger after retiring the Plan facade', () => {
  const result = spawnSync(process.execPath, ['scripts/spec/generate-modular-first-party-migration-ledger.mjs', '--check'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
  });
  expect(result.status, result.stderr).toBe(0);
});

it('distinguishes relocated Plan definitions from remaining execution ownership', () => {
  const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-slice5-migration-ledger.json', import.meta.url), 'utf8'));
  const routes = ledger.assignments.filter((entry: { source: string }) => entry.source === 'packages/core/src/cesar/plan.ts:52');
  expect(routes).toHaveLength(10);
  for (const route of routes) {
    expect(route.legacyPresent).toBe(false);
    expect(route.authority).toBe('legacy-runtime-until-s6');
    expect(route.implementationPaths).toContain('packages/mod-plan/src/execution-model.ts');
    expect(route.definitionOwner).toBe('@kernlang/agon-mod-plan');
    expect(route.remainingRuntimeBindings).toContain('packages/cli/src/handlers/plan-mode.ts');
  }
  // Include kernel-classified declarations without changing the frozen S5 count.
  expect(ledger.sourceRelocations).toHaveLength(13);
  // Four Forge settings moved from the kernel to their physical mod owner.
  expect(ledger.counts.assignments).toBe(348);
});

it.each([definitionPath, evidencePath, ...bindings])('rejects absent relocation evidence: %s', path => {
  const directory = fixture();
  rmSync(join(directory, path));
  expect(() => collectPlanSourceRelocations(directory, rows)).toThrow();
});

it('rejects a missing route while every persisted interface remains intact', () => {
  const directory = fixture();
  const source = readFileSync(join(directory, definitionPath), 'utf8').replace("'agent' | ", '');
  writeFileSync(join(directory, definitionPath), source);
  expect(() => collectPlanSourceRelocations(directory, rows)).toThrow('missing declaration cesarRoutes/agent');
});

it.each([
  ['comment only', "// export type CesarStepType = 'agent' | 'forge';"],
  ['unexported union', "type CesarStepType = 'agent' | 'forge';"],
  ['malformed syntax', 'export type CesarStepType = ;'],
  ['nonliteral union', "export type CesarStepType = 'self' | string;"],
])('rejects invalid declaration evidence: %s', (_label, source) => {
  const directory = fixture();
  writeFileSync(join(directory, definitionPath), source);
  expect(() => collectPlanSourceRelocations(directory, rows)).toThrow(/Plan relocation:/);
});

it('requires the persisted result declarations, not only the step union', () => {
  const directory = fixture();
  const source = readFileSync(join(directory, definitionPath), 'utf8').replace('export interface CesarStepResult', 'interface CesarStepResult');
  writeFileSync(join(directory, definitionPath), source);
  expect(() => collectPlanSourceRelocations(directory, rows)).toThrow(/missing declaration resultAndEnvelopeTypes\/CesarStepResult/);
});

it('binds evidence hashes to bytes without executing the declaration module', () => {
  const directory = fixture();
  const before = collectPlanSourceRelocations(directory, rows);
  const source = readFileSync(join(directory, definitionPath), 'utf8');
  writeFileSync(join(directory, definitionPath), `${source}\nthrow new Error('must not execute');\n`);
  writeFileSync(join(directory, evidencePath), '// changed evidence');
  const after = collectPlanSourceRelocations(directory, rows);
  expect(after).toHaveLength(13);
  expect(after[0].definitionHash).not.toBe(before[0].definitionHash);
  expect(after[0].removalEvidenceHash).not.toBe(before[0].removalEvidenceHash);
});

it('does not claim relocation while the legacy source still exists', () => {
  const directory = fixture();
  const path = join(directory, 'packages/core/src/cesar/plan.ts');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '// restored legacy source');
  expect(collectPlanSourceRelocations(directory, rows)).toEqual([]);
});
