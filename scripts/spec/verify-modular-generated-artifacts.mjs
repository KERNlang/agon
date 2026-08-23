import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'agon-generated-check-'));
const evidenceDir = join(temporaryRoot, 'evidence');
const generatedDir = join(temporaryRoot, 'generated');
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(generatedDir, { recursive: true });

const environment = {
  ...process.env,
  AGON_SPEC_EVIDENCE_DIR: evidenceDir,
  AGON_SPEC_GENERATED_DIR: generatedDir,
};

function run(script) {
  const result = spawnSync(process.execPath, [join(root, script)], {
    cwd: root, env: environment, encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(script + ' failed:\n' + (result.stdout || '') + (result.stderr || ''));
  }
}

function compare(generated, checked) {
  if (readFileSync(generated).equals(readFileSync(checked))) return;
  throw new Error('generated artifact is stale: ' + checked);
}

try {
  run('scripts/spec/generate-modular-agon-inventory.mjs');

  if (process.argv.includes('--self-test')) {
    const inventoryPath = join(evidenceDir, 'modular-agon-current-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    inventory.categories.cliCommands.push({ id: '__gate_canary__', source: 'gate-canary:1' });
    writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
    const canary = spawnSync(process.execPath, [join(root, 'scripts/spec/generate-modular-agon-ownership.mjs')], {
      cwd: root, env: environment, encoding: 'utf8',
    });
    if (canary.status === 0 || !(canary.stderr + canary.stdout).includes('unclassified modular surface')) {
      throw new Error('ownership negative control did not reject an unknown surface');
    }
    run('scripts/spec/generate-modular-agon-inventory.mjs');
    run('scripts/spec/generate-modular-agon-ownership.mjs');
    const packageMapPath = join(evidenceDir, 'modular-agon-package-map.json');
    const packageMap = JSON.parse(readFileSync(packageMapPath, 'utf8'));
    packageMap.dependencyEdges[0] = { ...packageMap.dependencyEdges[0], from: '@kernlang/agon-support-engine-runtime' };
    writeFileSync(packageMapPath, JSON.stringify(packageMap, null, 2) + '\n');
    const graphCanary = spawnSync(process.execPath, [join(root, 'scripts/spec/generate-modular-agon-package-graph.mjs')], {
      cwd: root, env: environment, encoding: 'utf8',
    });
    if (graphCanary.status === 0 || !(graphCanary.stderr + graphCanary.stdout).includes('dependencyEdges contradict')) {
      throw new Error('package graph negative control did not reject contradictory edges');
    }
    console.log('generated-artifact negative controls passed');
    process.exit(0);
  }

  run('scripts/spec/generate-modular-agon-ownership.mjs');
  run('scripts/spec/generate-modular-agon-package-graph.mjs');
  run('scripts/spec/generate-modular-agon-compat-projections.mjs');

  for (const name of [
    'modular-agon-current-inventory.json',
    'modular-agon-current-inventory.md',
    'modular-agon-package-map.json',
    'modular-agon-ownership.json',
    'modular-agon-ui-hierarchy.json',
    'modular-agon-migration-kill-list.json',
  ]) compare(join(evidenceDir, name), join(root, 'docs/specs/evidence', name));

  compare(join(generatedDir, 'first-party-package-graph.ts'), join(root, 'packages/mod-kernel/src/generated/first-party-package-graph.ts'));
  compare(join(generatedDir, 'first-party-ui-hierarchy.ts'), join(root, 'packages/mod-kernel/src/generated/first-party-ui-hierarchy.ts'));
  compare(join(generatedDir, 'legacy-surface-catalog.ts'), join(root, 'packages/mod-kernel/src/generated/legacy-surface-catalog.ts'));
  console.log('all modular generated artifacts are current');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
