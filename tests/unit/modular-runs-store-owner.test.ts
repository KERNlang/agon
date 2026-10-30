import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { collectSupportSourceRelocations } from '../../scripts/spec/modular-support-source-relocations.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const retired = join(root, 'packages/cli/src/signals/runs-store.ts');
const packages = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-implementation-roadmap.json'), 'utf8')).packages;
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function relocationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'agon-runs-relocation-'));
  roots.push(directory);
  for (const path of ['packages/support-persistence/src/runs-store.ts', 'tests/unit/modular-runs-store-owner.test.ts']) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), readFileSync(join(root, path)));
  }
  return directory;
}

function retiredImports(path: string, source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map(item => item.fileName)
    .filter(name => name.startsWith('.') && resolve(dirname(path), name).replace(/\.js$/, '.ts') === retired);
}

it('removes the CLI forwarding adapter while keeping the public persistence owner', () => {
  expect(existsSync(retired)).toBe(false);
  const owner = readFileSync(join(root, 'packages/support-persistence/src/index.ts'), 'utf8');
  expect(owner).toContain("export * from './runs-store.js'");
});

it('leaves no production import edge to the retired adapter', () => {
  const violations: string[] = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const directory = join(root, 'packages', entry.name, 'src');
    if (!entry.isDirectory() || !existsSync(directory)) continue;
    for (const name of readdirSync(directory, { recursive: true })) {
      if (!/\.tsx?$/.test(name)) continue;
      const path = join(directory, name);
      violations.push(...retiredImports(path, readFileSync(path, 'utf8')).map(imported => `${path}: ${imported}`));
    }
  }
  expect(violations).toEqual([]);
});

it('detects restored static, type, re-export and dynamic imports', () => {
  const path = join(root, 'packages/cli/src/surfaces/app.tsx');
  for (const source of [
    "import { runsStore } from '../signals/runs-store.js';",
    "import type { RunsSnapshot } from '../signals/runs-store.js';",
    "export { runsStore } from '../signals/runs-store.js';",
    "const store = import('../signals/runs-store.js');",
  ]) expect(retiredImports(path, source)).toHaveLength(1);
  expect(retiredImports(path, "import { runsStore } from '@kernlang/agon-support-persistence';")).toEqual([]);
});

it('preserves all four historical occurrences with their physical owner and evidence', () => {
  const rows = collectSupportSourceRelocations(root, packages);
  expect(rows.map(row => row.source)).toEqual([
    'packages/cli/src/signals/runs-store.ts', 'packages/cli/src/signals/runs-store.ts:44',
    'packages/cli/src/signals/runs-store.ts:49', 'packages/cli/src/signals/runs-store.ts:61',
  ]);
  for (const row of rows) expect(row).toMatchObject({ package: '@kernlang/agon-support-persistence',
    legacyPresent: false, implementationPaths: ['packages/support-persistence/src/runs-store.ts'],
    removalEvidence: 'tests/unit/modular-runs-store-owner.test.ts' });
});

it.each(['implementation', 'evidence'] as const)('rejects missing %s and binds changed bytes', kind => {
  const directory = relocationFixture();
  const before = collectSupportSourceRelocations(directory, packages);
  const path = join(directory, kind === 'implementation'
    ? 'packages/support-persistence/src/runs-store.ts' : 'tests/unit/modular-runs-store-owner.test.ts');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// changed fixture bytes\n');
  const after = collectSupportSourceRelocations(directory, packages);
  const field = kind === 'implementation' ? 'implementationHash' : 'removalEvidenceHash';
  expect(after[0][field]).not.toBe(before[0][field]);
  rmSync(path);
  expect(() => collectSupportSourceRelocations(directory, packages)).toThrow();
});

it('rejects an incorrect owner rather than transferring retirement evidence', () => {
  const changed = structuredClone(packages);
  changed.find(pkg => pkg.id === '@kernlang/agon-support-persistence').id = '@kernlang/agon-support-worktree';
  expect(() => collectSupportSourceRelocations(root, changed)).toThrow('wrong owner');
});

it('does not claim retirement when the adapter is restored', () => {
  const directory = relocationFixture();
  const path = join(directory, 'packages/cli/src/signals/runs-store.ts');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "export * from '@kernlang/agon-support-persistence';\n");
  expect(collectSupportSourceRelocations(directory, packages)).toEqual([]);
});

it('still rejects other missing extraction sources', () => {
  const script = join(root, 'scripts/spec/generate-modular-support-migration-ledger.mjs');
  const source = readFileSync(script, 'utf8').replace(/^import .*;\n/gm, '')
    .replaceAll('import.meta.dirname', JSON.stringify(dirname(script)));
  expect(() => runInNewContext(source, {
    join, resolve, readFileSync, collectSupportSourceRelocations,
    existsSync: (path: string) => path.endsWith('/packages/core/src/sessions/brain-client.ts') ? false : existsSync(path),
    writeFileSync: () => { throw new Error('unexpected ledger write'); },
    process: { argv: [] }, console,
  })).toThrow('extraction source disappeared without a ledger disposition');
});
