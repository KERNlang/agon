import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createNpmReleaseCatalog } from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const selfTest = process.argv.includes('--self-test');
const release = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const map = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const launcherPackage = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'));
const sidecarPackage = JSON.parse(readFileSync(resolve(root, 'packages/dedup/package.json'), 'utf8'));
const channel = JSON.parse(readFileSync(resolve(root, 'packages/cli/release-channel.json'), 'utf8'));
const output = resolve(root, 'docs/specs/evidence/modular-agon-sbom.cdx.json');
const fail = (message) => { throw new Error(message); };
const sourceLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const sourceCatalog = createNpmReleaseCatalog(sourceLock, ['packages/cli', ...release.packages.map(pkg => pkg.directory)]);

function sha512Digest(integrity, identity) {
  assert.equal(typeof integrity, 'string', `missing integrity: ${identity}`);
  const digest = Buffer.from(integrity.replace(/^sha512-/, ''), 'base64');
  assert.equal(integrity, `sha512-${digest.toString('base64')}`, `non-canonical integrity: ${identity}`);
  assert.equal(digest.length, 64, `invalid SHA-512 digest: ${identity}`);
  return digest;
}

function npmInventory(candidateChannel) {
  const catalog = candidateChannel.npmCatalog;
  assert.equal(catalog?.schemaVersion, 1, 'missing frozen npm catalog');
  assert.deepEqual(Object.keys(catalog.packages).sort(), Object.keys(sourceCatalog.packages).sort(), 'npm catalog membership differs from source lock');
  const local = new Map([release.launcher, ...release.packages, ...release.compatibilityArtifacts]
    .map(pkg => [`node_modules/${pkg.id}`, pkg]));
  const externalPaths = Object.keys(catalog.packages).filter(path => !local.has(path)).sort();
  assert.deepEqual(Object.keys(candidateChannel.npmPayloads ?? {}).sort(), externalPaths, 'npm payload inventory differs from catalog');
  const refs = new Map([...local].map(([path, pkg]) => [path, `${pkg.id}@${pkg.version}`]));
  const components = [];
  for (const path of Object.keys(catalog.packages).sort()) {
    const entry = catalog.packages[path];
    if (local.has(path)) {
      const pkg = local.get(path);
      assert.equal(entry.resolved, `https://registry.npmjs.org/${pkg.id}/-/${pkg.id.split('/').at(-1)}-${pkg.version}.tgz`, `local npm locator differs from release: ${path}`);
      // The channel is inside the launcher. Its own hash cannot be embedded.
      assert.equal(entry.integrity, pkg.id === release.launcher.id ? undefined : pkg.integrity,
        `local npm integrity differs from release: ${path}`);
      // Local tarball identities replace source-workspace locators during packing.
      const { resolved: _resolved, integrity: _integrity, ...metadata } = entry;
      const { resolved: _sourceResolved, integrity: _sourceIntegrity, ...sourceMetadata } = sourceCatalog.packages[path];
      assert.deepEqual(metadata, sourceMetadata, `local npm metadata differs from source lock: ${path}`);
      continue;
    }
    assert.deepEqual(entry, sourceCatalog.packages[path], `external npm metadata differs from source lock: ${path}`);
    assert.match(candidateChannel.npmPayloads[path], /^sha256:[a-f0-9]{64}$/, `missing npm payload identity: ${path}`);
    assert.equal(typeof entry.license, 'string', `missing npm license metadata: ${path}`);
    assert.ok(entry.license.trim(), `empty npm license metadata: ${path}`);
    const digest = sha512Digest(entry.integrity, path);
    const name = entry.name ?? path.split('node_modules/').at(-1);
    const scoped = name.startsWith('@');
    const ref = `npm:${path}@${entry.version}`;
    refs.set(path, ref);
    components.push({ type: 'library', 'bom-ref': ref,
      ...(scoped ? { group: name.split('/')[0] } : {}), name: scoped ? name.split('/')[1] : name,
      version: entry.version, hashes: [{ alg: 'SHA-512', content: digest.toString('hex') }],
      licenses: [{ expression: entry.license }], properties: [
        { name: 'agon:npm-location', value: path },
        { name: 'npm:integrity', value: entry.integrity },
        { name: 'agon:payload-sha256', value: candidateChannel.npmPayloads[path] },
        { name: 'agon:class', value: 'external-npm-dependency' },
      ], externalReferences: [{ type: 'distribution', url: entry.resolved }] });
  }
  const dependencies = [];
  for (const [path, entry] of Object.entries(catalog.packages)) {
    const targets = new Set();
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies }).sort()) {
      let parent = path;
      let target;
      for (;;) {
        const candidate = `${parent ? `${parent}/` : ''}node_modules/${name}`;
        if (refs.has(candidate)) { target = refs.get(candidate); break; }
        if (!parent) break;
        parent = posix.dirname(parent);
        if (parent === '.') parent = '';
      }
      if (target) targets.add(target);
      else if (!entry.peerDependenciesMeta?.[name]?.optional || Object.hasOwn(entry.dependencies ?? {}, name)
        || Object.hasOwn(entry.optionalDependencies ?? {}, name)) fail(`SBOM dependency has no component: ${path} -> ${name}`);
    }
    dependencies.push({ ref: refs.get(path), dependsOn: [...targets].sort() });
  }
  return { components, dependencies };
}

function validate(candidateRelease, candidateMap) {
  if (candidateRelease.packageCount !== 49 || candidateRelease.packages.length !== 49 || candidateRelease.artifactCount !== 51) fail('SBOM source must contain 49 modular packages, one launcher and the legacy sidecar artifact');
  if (candidateRelease.compatibilityArtifacts?.length !== 1 || candidateRelease.compatibilityArtifacts[0].id !== sidecarPackage.name
    || candidateRelease.compatibilityArtifacts[0].version !== sidecarPackage.version) fail('legacy sidecar artifact identity differs from its package');
  if (candidateRelease.launcher?.id !== '@kernlang/agon' || candidateRelease.launcher.version !== candidateRelease.version || !candidateRelease.launcher.integrity || !candidateRelease.launcher.tarballHash) fail('release launcher evidence is missing or malformed');
  if (candidateRelease.version !== '1.0.0' || candidateRelease.packages.some((pkg) => pkg.version !== candidateRelease.version)) fail('release set is not lockstep');
  if (new Set(candidateRelease.packages.map(({ id }) => id)).size !== 49) fail('duplicate release component');
  if ([...candidateRelease.packages, ...candidateRelease.compatibilityArtifacts].some((pkg) => !pkg.integrity || !pkg.tarballHash || !pkg.files.some(({ path }) => path.toLowerCase().startsWith('license')))) fail('release artifact lacks integrity or license evidence');
  for (const pkg of [candidateRelease.launcher, ...candidateRelease.packages, ...candidateRelease.compatibilityArtifacts]) {
    assert.match(pkg.tarballHash, /^sha256:[a-f0-9]{64}$/, `invalid artifact SHA-256: ${pkg.id}`);
    sha512Digest(pkg.integrity, pkg.id);
    assert.deepEqual(pkg.peerDependencies ?? {}, sourceCatalog.packages[`node_modules/${pkg.id}`]?.peerDependencies ?? {},
      `release peers differ from source lock: ${pkg.id}`);
  }
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
  const missingSidecars = structuredClone(release);
  missingSidecars.compatibilityArtifacts = [];
  assert.throws(() => validate(missingSidecars, map), /sidecar artifact identity/);
}

const libraries = [...release.packages, ...release.compatibilityArtifacts];
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: serialNumber({ release, npmCatalog: channel.npmCatalog, npmPayloads: channel.npmPayloads }),
  version: 1,
  metadata: { component: { type: 'application', name: release.releaseSet, version: release.version }, properties: [
    { name: 'agon:evidence-kind', value: 'local-unpublished-release-candidate' },
    { name: 'agon:npm-provenance', value: 'externally-blocked-until-registry-publication' },
    { name: 'agon:dependency-scope', value: 'release-set packages and frozen external npm closure, including nested, optional and peer relationships' },
    { name: 'agon:license-status', value: 'declared metadata; distribution policy review is not established by this inventory' },
  ] },
  components: [{ type: 'application', 'bom-ref': `@kernlang/agon@${release.version}`, group: '@kernlang', name: 'agon', version: release.version, hashes: [{ alg: 'SHA-256', content: release.launcher.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: release.launcher.integrity }, { name: 'agon:class', value: 'managed-launcher' }] }, ...libraries.map((pkg) => ({ type: 'library', 'bom-ref': `${pkg.id}@${pkg.version}`, group: '@kernlang', name: pkg.id.replace('@kernlang/', ''), version: pkg.version, hashes: [{ alg: 'SHA-256', content: pkg.tarballHash.slice(7) }], licenses: [{ license: { id: 'MIT' } }], properties: [{ name: 'npm:integrity', value: pkg.integrity }, { name: 'agon:class', value: pkg.class }] }))],
  dependencies: [{ ref: `@kernlang/agon@${release.version}`, dependsOn: release.launcher.dependencies.flatMap(({ id }) => {
    const pkg = libraries.find(pkg => pkg.id === id);
    return pkg ? [`${id}@${pkg.version}`] : [];
  }) }, ...libraries.map((pkg) => ({ ref: `${pkg.id}@${pkg.version}`, dependsOn: [...new Set([...pkg.dependencies, ...Object.keys(pkg.peerDependencies)])].sort().map((id) => `${id}@${libraries.find(pkg => pkg.id === id)?.version ?? release.version}`) }))],
};
const inventory = npmInventory(channel);
sbom.components.push(...inventory.components);
const dependencies = new Map(sbom.dependencies.map(entry => [entry.ref, new Set(entry.dependsOn)]));
for (const entry of inventory.dependencies) {
  const targets = dependencies.get(entry.ref) ?? new Set();
  for (const target of entry.dependsOn) targets.add(target);
  dependencies.set(entry.ref, targets);
}
sbom.dependencies = [...dependencies].sort(([a], [b]) => a.localeCompare(b))
  .map(([ref, targets]) => ({ ref, dependsOn: [...targets].sort() }));
const componentRefs = new Set(sbom.components.map(component => component['bom-ref']));
assert.equal(componentRefs.size, sbom.components.length, 'duplicate SBOM component reference');
assert.equal(sbom.dependencies.length, componentRefs.size, 'SBOM dependency inventory is incomplete');
for (const entry of sbom.dependencies) {
  assert.ok(componentRefs.has(entry.ref), `unknown dependency owner: ${entry.ref}`);
  for (const target of entry.dependsOn) assert.ok(componentRefs.has(target), `unknown dependency target: ${target}`);
}
if (selfTest) {
  for (const location of Object.keys(channel.npmPayloads)) {
    const component = sbom.components.find(component => component.properties?.some(property =>
      property.name === 'agon:npm-location' && property.value === location));
    assert.ok(component, `SBOM omits external dependency: ${location}`);
    assert.equal(component.version, channel.npmCatalog.packages[location].version);
    assert.deepEqual(component.licenses, [{ expression: channel.npmCatalog.packages[location].license }]);
    assert.deepEqual(component.hashes, [{ alg: 'SHA-512', content: Buffer.from(channel.npmCatalog.packages[location].integrity.slice(7), 'base64').toString('hex') }]);
  }
  const missingPayload = structuredClone(channel);
  delete missingPayload.npmPayloads[Object.keys(missingPayload.npmPayloads)[0]];
  assert.throws(() => npmInventory(missingPayload), /payload inventory/);
  const missingPackage = structuredClone(channel);
  delete missingPackage.npmCatalog.packages[Object.keys(channel.npmPayloads)[0]];
  assert.throws(() => npmInventory(missingPackage), /catalog membership/);
  for (const field of ['integrity', 'license', 'version', 'dependencies']) {
    const changed = structuredClone(channel);
    changed.npmCatalog.packages['node_modules/@kernlang/protocol'][field] = 'changed';
    assert.throws(() => npmInventory(changed), /external npm metadata/);
  }
  const ink = inventory.dependencies.find(entry => entry.ref === `npm:node_modules/ink@${channel.npmCatalog.packages['node_modules/ink'].version}`);
  assert.deepEqual(ink.dependsOn.filter(ref => /\/chalk@/.test(ref)),
    [`npm:node_modules/ink/node_modules/chalk@${channel.npmCatalog.packages['node_modules/ink/node_modules/chalk'].version}`], 'nested chalk dependency was flattened or duplicated');
  const sidecarRef = `${sidecarPackage.name}@${sidecarPackage.version}`;
  assert.ok(sbom.dependencies.find(entry => entry.ref === `@kernlang/agon@${release.version}`).dependsOn.includes(sidecarRef), 'launcher omits sidecar dependency');
  assert.ok(sbom.components.some(component => component['bom-ref'] === sidecarRef), 'sidecar component is missing');
  const selfHash = structuredClone(channel);
  selfHash.npmCatalog.packages[`node_modules/${release.launcher.id}`].integrity = release.launcher.integrity;
  assert.throws(() => npmInventory(selfHash), /local npm integrity/);
  const acceptedInvalidEvidence = [];
  const localPath = `node_modules/${release.packages[0].id}`;
  for (const field of ['resolved', 'integrity']) for (const mutation of ['missing', 'substituted']) {
    const changed = structuredClone(channel);
    if (mutation === 'missing') delete changed.npmCatalog.packages[localPath][field];
    else changed.npmCatalog.packages[localPath][field] = field === 'resolved'
      ? 'https://registry.npmjs.org/wrong/-/wrong-1.0.0.tgz' : `sha512-${Buffer.alloc(64).toString('base64')}`;
    try { npmInventory(changed); acceptedInvalidEvidence.push(`${mutation} local ${field}`); } catch { /* Rejection is required. */ }
  }
  const fabricatedPeer = structuredClone(release);
  const peerOwner = fabricatedPeer.packages.find(pkg => Object.keys(pkg.peerDependencies).length === 0);
  const peer = fabricatedPeer.packages.find(pkg => pkg.id !== peerOwner.id && !peerOwner.dependencies.includes(pkg.id));
  peerOwner.peerDependencies[peer.id] = '1.0.0';
  try { validate(fabricatedPeer, map); acceptedInvalidEvidence.push('undeclared local peer'); } catch { /* Rejection is required. */ }
  for (const [field, value] of [['tarballHash', 'garbage'], ['tarballHash', 'sha256:0'], ['integrity', 'sha512-A'], ['integrity', 'sha256-' + '0'.repeat(64)]]) {
    const malformed = structuredClone(release);
    malformed.launcher[field] = value;
    try { validate(malformed, map); acceptedInvalidEvidence.push(`malformed local ${field}: ${value}`); } catch { /* Rejection is required. */ }
  }
  assert.deepEqual(acceptedInvalidEvidence, [], 'SBOM accepted inconsistent local evidence');
}
const text = `${JSON.stringify(sbom, null, 2)}\n`;
if (check) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== text) fail('SBOM drift');
} else writeFileSync(output, text);
console.log(JSON.stringify({ status: 'passed', components: sbom.components.length, dependencyEdges: sbom.dependencies.reduce((sum, entry) => sum + entry.dependsOn.length, 0), npmProvenance: 'externally-blocked' }, null, 2));
