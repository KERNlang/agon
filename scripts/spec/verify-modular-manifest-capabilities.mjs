import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const mods = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8')).packages
  .filter(({ class: packageClass }) => packageClass === 'user-toggleable-mod-package');

export function requiredCapabilities(source, short) {
  const required = new Set([...source.matchAll(/permissions\.check\(['"]([^'"]+)['"]/g)].map((match) => match[1]));
  if (/services\.engines\.dispatch\b/.test(source)) required.add('engine.dispatch');
  if (/services\.state\.read\b/.test(source)) required.add('state.read');
  if (/services\.state\.write\b/.test(source)) required.add('state.write');
  if (['conquer', 'goal', 'pipeline-delivery', 'pipeline-orchestration'].includes(short)) required.add('engine.dispatch');
  return [...required].sort();
}

export function compareCapabilities(source, manifest, short) {
  const required = requiredCapabilities(source, short);
  const declared = manifest.permissions.map(({ capability }) => capability).sort();
  return { required, declared, missing: required.filter((capability) => !declared.includes(capability)) };
}

const rows = mods.map(({ id }) => {
  const short = id.replace('@kernlang/agon-mod-', '');
  const directory = resolve(root, 'packages', `mod-${short}`);
  const implementation = resolve(directory, 'src/implementation.ts');
  const manifestPath = resolve(directory, 'agon.mod.json');
  if (!existsSync(implementation) || !existsSync(manifestPath)) return { id, missingPhysicalPackage: true, missing: ['physical-package'] };
  return { id, ...compareCapabilities(readFileSync(implementation, 'utf8'), JSON.parse(readFileSync(manifestPath, 'utf8')), short) };
});

if (process.argv.includes('--self-test')) {
  const control = compareCapabilities("services.engines.dispatch('x', 'y', context)", { permissions: [] }, 'ask');
  if (!control.missing.includes('engine.dispatch')) throw new Error('negative control failed to catch undeclared engine dispatch');
}

const failures = rows.filter(({ missing }) => missing.length > 0);
console.log(JSON.stringify({ schemaVersion: 1, gate: 'modular-manifest-capabilities', passed: failures.length === 0,
  counts: { mods: rows.length, passing: rows.length - failures.length, failing: failures.length }, failures }, null, 2));
if (failures.length) process.exitCode = 1;
