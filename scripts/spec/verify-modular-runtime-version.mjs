import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageVersion = JSON.parse(read('packages/cli/package.json')).version;

const subjects = Object.freeze([
  ['kernel-runtime', 'packages/mod-kernel/src/runtime-version.ts', /AGON_RUNTIME_VERSION\s*=\s*['"]([^'"]+)['"]/],
  ['cli-program', 'packages/cli/src/index.ts', /version:\s*['"]([^'"]+)['"]/],
  ['cli-fallback', 'packages/cli/src/blocks/engine.tsx', /resolvePackageVersion\('@kernlang\/agon',\s*['"]([^'"]+)['"]\)/],
]);

function evaluate(contents, expected = packageVersion) {
  return subjects.map(([id, path, pattern]) => {
    const match = contents[path].match(pattern);
    return Object.freeze({ id, path, observed: match?.[1] ?? null, expected, passed: match?.[1] === expected });
  });
}

const contents = Object.fromEntries(subjects.map(([, path]) => [path, read(path)]));
const checks = evaluate(contents);
let negativeControls = 0;
if (process.argv.includes('--self-test')) {
  for (const [, path, pattern] of subjects) {
    const mutated = { ...contents, [path]: contents[path].replace(pattern, (whole, version) => whole.replace(version, '999.0.0')) };
    const result = evaluate(mutated).find((check) => check.path === path);
    if (!result || result.passed) throw new Error(`runtime version drift negative control survived for ${path}`);
    negativeControls += 1;
  }
}

const result = Object.freeze({ schemaVersion: 1, verifier: 'modular-runtime-version-drift', packageVersion, checks, negativeControls,
  passed: checks.every(({ passed }) => passed) });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
