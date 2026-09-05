import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const prerequisiteBuilds = ["packages/mod-api", "packages/mod-kernel"];
for (const workspace of prerequisiteBuilds) {
  const result = spawnSync("npm", ["run", "build", "-w", workspace], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("mutation prerequisite build failed: " + workspace);
  }
}
const gates = [
  [process.execPath, ['scripts/spec/verify-modular-generated-artifacts.mjs', '--self-test'], 'generated-artifact drift mutant'],
  [process.execPath, ['scripts/spec/verify-modular-slice1b-gates.mjs'], 'qualification/hash mutant set'],
  [process.execPath, ['scripts/spec/verify-modular-support-boundaries.mjs', '--self-test'], 'support dependency mutant'],
  [process.execPath, [
    'scripts/run-node22.mjs', resolve(root, 'node_modules/.bin/vitest'), 'run',
    'tests/unit/modular-manifest.test.ts',
    'tests/unit/modular-resolver.test.ts',
    'tests/unit/modular-registry.test.ts',
    'tests/unit/modular-package-graph.test.ts',
    'tests/unit/modular-topology-invariant.test.ts',
    'tests/unit/modular-boundary.test.ts',
  ], 'manifest/resolver/registry/graph behavioral regression suite'],
];

for (const [command, args, label] of gates) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true' } });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`mutation gate failed: ${label}`);
  }
  console.log(`passed: ${label}`);
}
console.log(`all ${gates.length} verification suites passed; behavioral implementation mutation score: not measured`);
