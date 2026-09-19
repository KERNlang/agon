import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const selfTest = process.argv.includes('--self-test');
const release = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const map = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const output = resolve(root, 'docs/specs/evidence/modular-agon-sbom.cdx.json');
const fail = (message) => { throw new Error(message); };

function validate(candidateRelease, candidateMap) {
  if (candidateRelease.packageCount !== 49 || candidateRelease.packages.length !== 49 || candidateRelease.artifactCount !== 50) fail('SBOM source must contain 49 modular packages plus one launcher');
  if (candidateRelease.launcher?.id !== '@kernlang/agon' || candidateRelease.launcher.version !== candidateRelease.version || !candidateRelease.launcher.integrity || !candidateRelease.launcher.tarballHash) fail('release launcher evidence is missing or malformed');
  if (candidateRelease.version !== '1.0.0' || candidateRelease.packages.some((pkg) => pkg.version !== candidateRelease.version)) fail('release set is not lockstep');
  if (new Set(candidateRelease.packages.map(({ id }) => id)).size !== 49) fail('duplicate release component');
  if (candidateRelease.packages.some((pkg) => !pkg.integrity || !pkg.tarballHash || !pkg.files.some(({ path }) => path.toLowerCase().startsWith('license')))) fail('release artifact lacks integrity or license evidence');
  const releaseIds = new Set(candidateRelease.packages.map(({ id }) => id));
  const edgeKeys = candidateMap.dependencyEdges.map(({ from, to, kind }) => `${from}\0${to}\0${kind}`);
  if (new Set(edgeKeys).size !== edgeKeys.length) fail('package graph contains duplicate directed dependency edges');
  if (candidateMap.packages.some(({ id }) => !releaseIds.has(id))
    || candidateMap.dependencyEdges.some(({ from, to }) => !releaseIds.has(from) || !releaseIds.has(to))
    || candidateRelease.dependencyEdgeCount !== candidateMap.dependencyEdges.length) fail('release BOM and package graph diverge');
}

validate(release, map);
if (selfTest) {
  const mutated = structuredClone(release);
  mutated.packages.pop();
  let rejected = false;
  try { validate(mutated, map); } catch { rejected = true; }
  if (!rejected) fail('supply-chain negative control accepted a missing component');
  const duplicateGraph = structuredClone(map);
  duplicateGraph.dependencyEdges.push(structuredClone(duplicateGraph.dependencyEdges[0]));
  rejected = false;
  try { validate(release, duplicateGraph); } catch { rejected = true; }
  if (!rejected) fail('supply-chain negative control accepted a duplicate dependency edge');
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000109',
  version: 1,
  metadata: { component: { type: 'application', name: release.releaseSet, version: release.version }, properties: [
    { name: 'agon:evidence-kind', value: 'local-unpublished-release-candidate' },
    { name: 'agon:npm-provenance', value: 'externally-blocked-until-registry-publication' },
  ] },
  components: [{ type: 'application', 'bom-ref': `@kernlang/agon@${release.version}`, group: '@kernlang', name: 'agon', version: release.version, hashes: [{ alg: 'SHA-256', content: release.launcher.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: release.launcher.integrity }, { name: 'agon:class', value: 'managed-launcher' }] }, ...release.packages.map((pkg) => ({ type: 'library', 'bom-ref': `${pkg.id}@${pkg.version}`, group: '@kernlang', name: pkg.id.replace('@kernlang/', ''), version: pkg.version, hashes: [{ alg: 'SHA-256', content: pkg.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: pkg.integrity }, { name: 'agon:class', value: pkg.class }] }))],
  dependencies: [{ ref: `@kernlang/agon@${release.version}`, dependsOn: release.launcher.dependencies.filter(({ id }) => release.packages.some((pkg) => pkg.id === id)).map(({ id }) => `${id}@${release.version}`) }, ...release.packages.map((pkg) => ({ ref: `${pkg.id}@${pkg.version}`, dependsOn: pkg.dependencies.map((id) => `${id}@${release.version}`) }))],
};
const text = `${JSON.stringify(sbom, null, 2)}\n`;
if (check) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== text) fail('SBOM drift');
} else writeFileSync(output, text);
console.log(JSON.stringify({ status: 'passed', components: sbom.components.length, dependencyEdges: sbom.dependencies.reduce((sum, entry) => sum + entry.dependsOn.length, 0), npmProvenance: 'externally-blocked' }, null, 2));
