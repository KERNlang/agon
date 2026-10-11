import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const selfTest = process.argv.includes('--self-test');
const release = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const map = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const launcherPackage = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'));
const output = resolve(root, 'docs/specs/evidence/modular-agon-sbom.cdx.json');
const fail = (message) => { throw new Error(message); };

function validate(candidateRelease, candidateMap) {
  if (candidateRelease.packageCount !== 49 || candidateRelease.packages.length !== 49 || candidateRelease.artifactCount !== 50) fail('SBOM source must contain 49 modular packages plus one launcher');
  if (candidateRelease.launcher?.id !== '@kernlang/agon' || candidateRelease.launcher.version !== candidateRelease.version || !candidateRelease.launcher.integrity || !candidateRelease.launcher.tarballHash) fail('release launcher evidence is missing or malformed');
  if (candidateRelease.version !== '1.0.0' || candidateRelease.packages.some((pkg) => pkg.version !== candidateRelease.version)) fail('release set is not lockstep');
  if (new Set(candidateRelease.packages.map(({ id }) => id)).size !== 49) fail('duplicate release component');
  if (candidateRelease.packages.some((pkg) => !pkg.integrity || !pkg.tarballHash || !pkg.files.some(({ path }) => path.toLowerCase().startsWith('license')))) fail('release artifact lacks integrity or license evidence');
  const releaseIds = new Set(candidateRelease.packages.map(({ id }) => id));
  const edgeKeys = candidateMap.dependencyEdges.map(({ from, to }) => `${from}\0${to}`);
  if (new Set(edgeKeys).size !== edgeKeys.length) fail('package graph contains duplicate directed dependency edges');
  if (candidateMap.packages.some(({ id }) => !releaseIds.has(id))
    || candidateMap.dependencyEdges.some(({ from, to }) => !releaseIds.has(from) || !releaseIds.has(to))
    || candidateRelease.dependencyEdgeCount !== candidateMap.dependencyEdges.length) fail('release BOM and package graph diverge');
  const launcherDependencies = Object.entries({ ...launcherPackage.dependencies, ...launcherPackage.optionalDependencies })
    .map(([id, range]) => ({ id, range })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(candidateRelease.launcher.dependencies, launcherDependencies, 'launcher dependency membership differs from package declarations');
  for (const pkg of candidateRelease.packages) {
    const expected = candidateMap.dependencyEdges.filter(({ from }) => from === pkg.id).map(({ to }) => to).sort();
    assert.deepEqual([...pkg.dependencies].sort(), expected, `${pkg.id}: release dependency membership differs from graph`);
    const record = candidateMap.packages.find(({ id }) => id === pkg.id);
    assert.deepEqual([...record.dependencies].sort(), expected, `${pkg.id}: map adjacency differs from edges`);
    if (!pkg.peerDependencies || Object.keys(pkg.peerDependencies).some((id) => !releaseIds.has(id) || id === pkg.id)) fail(`${pkg.id}: missing or invalid peer dependency evidence`);
  }
}

function serialNumber(candidateRelease) {
  // UUID v5 binds the document identity to the complete release evidence.
  const namespace = Buffer.from('00000000000040008000000000000109', 'hex');
  const bytes = createHash('sha1').update(namespace).update(JSON.stringify(candidateRelease)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

validate(release, map);
if (selfTest) {
  const mutated = structuredClone(release);
  mutated.packages.pop();
  let rejected = false;
  try { validate(mutated, map); } catch { rejected = true; }
  if (!rejected) fail('supply-chain negative control accepted a missing component');
  const duplicateGraph = structuredClone(map);
  duplicateGraph.dependencyEdges[1] = structuredClone(duplicateGraph.dependencyEdges[0]);
  assert.throws(() => validate(release, duplicateGraph), /duplicate directed dependency edges/);
  const substituted = structuredClone(release);
  const dependent = substituted.packages.find((pkg) => pkg.dependencies.length);
  dependent.dependencies[0] = dependent.id;
  rejected = false;
  try { validate(substituted, map); } catch { rejected = true; }
  if (!rejected) fail('supply-chain negative control accepted substituted dependency membership');
  const missingOptional = structuredClone(release);
  const optionalId = Object.keys(launcherPackage.optionalDependencies)[0];
  missingOptional.launcher.dependencies = missingOptional.launcher.dependencies.filter(({ id }) => id !== optionalId);
  assert.throws(() => validate(missingOptional, map), /launcher dependency membership/);
  assert.equal(serialNumber(release), serialNumber(structuredClone(release)));
  const changedArtifact = structuredClone(release);
  changedArtifact.launcher.tarballHash = `sha256:${'0'.repeat(64)}`;
  assert.notEqual(serialNumber(release), serialNumber(changedArtifact));
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: serialNumber(release),
  version: 1,
  metadata: { component: { type: 'application', name: release.releaseSet, version: release.version }, properties: [
    { name: 'agon:evidence-kind', value: 'local-unpublished-release-candidate' },
    { name: 'agon:npm-provenance', value: 'externally-blocked-until-registry-publication' },
    { name: 'agon:dependency-scope', value: 'release-set packages, including optional and peer relationships; external npm dependency closure is not represented' },
  ] },
  components: [{ type: 'application', 'bom-ref': `@kernlang/agon@${release.version}`, group: '@kernlang', name: 'agon', version: release.version, hashes: [{ alg: 'SHA-256', content: release.launcher.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: release.launcher.integrity }, { name: 'agon:class', value: 'managed-launcher' }] }, ...release.packages.map((pkg) => ({ type: 'library', 'bom-ref': `${pkg.id}@${pkg.version}`, group: '@kernlang', name: pkg.id.replace('@kernlang/', ''), version: pkg.version, hashes: [{ alg: 'SHA-256', content: pkg.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: pkg.integrity }, { name: 'agon:class', value: pkg.class }] }))],
  dependencies: [{ ref: `@kernlang/agon@${release.version}`, dependsOn: release.launcher.dependencies.filter(({ id }) => release.packages.some((pkg) => pkg.id === id)).map(({ id }) => `${id}@${release.version}`) }, ...release.packages.map((pkg) => ({ ref: `${pkg.id}@${pkg.version}`, dependsOn: [...new Set([...pkg.dependencies, ...Object.keys(pkg.peerDependencies)])].sort().map((id) => `${id}@${release.version}`) }))],
};
const text = `${JSON.stringify(sbom, null, 2)}\n`;
if (check) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== text) fail('SBOM drift');
} else writeFileSync(output, text);
console.log(JSON.stringify({ status: 'passed', components: sbom.components.length, dependencyEdges: sbom.dependencies.reduce((sum, entry) => sum + entry.dependsOn.length, 0), npmProvenance: 'externally-blocked' }, null, 2));
