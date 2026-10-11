import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { hashInstalledPackagePayload } from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const version = '1.0.0';
const check = process.argv.includes('--check');
const selfTest = process.argv.includes('--self-test');
const map = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const releaseNames = new Set(map.packages.map(({ id }) => id));
const output = join(root, 'docs/specs/evidence/modular-agon-release-set.json');
const channelOutput = join(root, 'packages/cli/release-channel.json');
const builtChannelOutput = join(root, 'packages/cli/dist/release-channel.json');
const scratch = mkdtempSync(join(tmpdir(), 'agon-s9-release-set-'));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const canonical = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const directory = (id) => id === '@kernlang/agon-kernel' ? 'mod-kernel' : id === '@kernlang/agon-mod-api' ? 'mod-api' : id.replace('@kernlang/agon-', '');
const fail = (message) => { throw new Error(message); };

async function packedSnapshot(tarball, files) {
  for (const { path } of files) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '' || part === '.')) fail(`invalid packed path: ${path}`);
  }
  // Read every identity from the same archive snapshot as its payload hash.
  const extracted = mkdtempSync(join(scratch, 'payload-'));
  const unpacked = spawnSync('tar', ['-xf', tarball, '-C', extracted], { encoding: 'utf8' });
  if (unpacked.status !== 0) fail(`cannot inspect packed payload: ${unpacked.stderr}`);
  const packageRoot = join(extracted, 'package');
  const payloadHash = await hashInstalledPackagePayload(packageRoot);
  for (const { path, size } of files) {
    if (readFileSync(join(packageRoot, path)).byteLength !== size) fail(`packed size differs from inventory: ${path}`);
  }
  const packageBytes = readFileSync(join(packageRoot, 'package.json'));
  return { packageRoot, packageBytes, pkg: JSON.parse(packageBytes.toString('utf8')), payloadHash };
}

function validatePackage(record, pkg) {
  if (pkg.name !== record.id || pkg.version !== version || pkg.private !== false || pkg.license !== 'MIT') fail(`${record.id}: release identity/version/license mismatch`);
  const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies };
  const peers = pkg.peerDependencies ?? {};
  const declared = Object.keys(dependencies).filter((id) => releaseNames.has(id)).sort();
  // The shared kernel is a peer, not a second installed kernel instance.
  const expected = record.dependencies.filter((id) => !Object.hasOwn(peers, id)).sort();
  assert.deepEqual(declared, expected, `${record.id}: package dependencies differ from architectural map`);
  for (const section of ['dependencies', 'optionalDependencies']) for (const [name, range] of Object.entries(pkg[section] ?? {})) {
    if (releaseNames.has(name) && range !== version) fail(`${record.id}: ${name} must use exact lockstep ${version}`);
  }
}

async function inspect(record) {
  const dir = directory(record.id);
  const packageRoot = join(root, 'packages', dir);
  const packDestination = join(scratch, 'tarballs');
  mkdirSync(packDestination, { recursive: true });
  const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDestination], {
    cwd: packageRoot, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(scratch, 'cache'), npm_config_logs_dir: join(scratch, 'logs'), npm_config_ignore_scripts: 'true' },
  });
  if (packed.status !== 0) fail(`${record.id}: npm pack failed\n${packed.stderr}`);
  const result = JSON.parse(packed.stdout)[0];
  const files = result.files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path));
  const forbidden = files.filter(({ path }) => /(^|\/)(?:src|test|tests|node_modules|\.git|\.env|credentials?|histories?|caches?)(\/|$)/i.test(path) || /(?:\.tsbuildinfo|\.pem|\.key)$/.test(path));
  if (forbidden.length) fail(`${record.id}: forbidden packed content ${forbidden.map(({ path }) => path).join(', ')}`);
  if (!files.some(({ path }) => path === 'package.json') || !files.some(({ path }) => basename(path).toLowerCase().startsWith('license'))) fail(`${record.id}: pack lacks package identity or license`);
  const tarball = join(packDestination, result.filename);
  if (!existsSync(tarball)) fail(`${record.id}: npm pack did not create ${result.filename}`);
  const snapshot = await packedSnapshot(tarball, files);
  const { pkg } = snapshot;
  validatePackage(record, pkg);
  if (!pkg.files?.includes('LICENSE') || !existsSync(join(snapshot.packageRoot, 'LICENSE'))) fail(`${record.id}: MIT license is not packed`);
  const manifestPath = join(snapshot.packageRoot, 'agon.mod.json');
  let modId = null;
  let manifestDependencies = [];
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    modId = manifest.id;
    manifestDependencies = manifest.dependencies.required.map(({ id }) => id).sort();
    if (manifest.version !== version) fail(`${record.id}: manifest version is not lockstep`);
    for (const asset of manifest.pack?.include ?? []) if (!files.some(({ path }) => path === asset)) fail(`${record.id}: manifest pack asset missing: ${asset}`);
  }
  return { id: record.id, modId, manifestDependencies, directory: `packages/${dir}`, version, class: record.class, dependencies: record.dependencies, peerDependencies: pkg.peerDependencies ?? {}, packedBytes: result.size, unpackedBytes: result.unpackedSize, fileCount: files.length, files, payloadHash: snapshot.payloadHash, integrity: result.integrity, shasum: result.shasum, tarballHash: sha256(readFileSync(tarball)), packageJsonHash: sha256(snapshot.packageBytes), manifestHash: existsSync(manifestPath) ? sha256(canonical(JSON.parse(readFileSync(manifestPath, 'utf8')))) : sha256(snapshot.packageBytes) };
}

async function inspectLauncher() {
  const packageRoot = join(root, 'packages', 'cli');
  const packDestination = join(scratch, 'launcher');
  mkdirSync(packDestination, { recursive: true });
  const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDestination], {
    cwd: packageRoot, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(scratch, 'cache'), npm_config_logs_dir: join(scratch, 'logs'), npm_config_ignore_scripts: 'true' },
  });
  if (packed.status !== 0) fail(`CLI launcher npm pack failed\n${packed.stderr}`);
  const result = JSON.parse(packed.stdout)[0];
  const files = result.files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path));
  const forbidden = files.filter(({ path }) => /(^|\/)(?:src|test|tests|node_modules|\.git|\.env|credentials?|histories?|caches?)(\/|$)/i.test(path) || /(?:\.tsbuildinfo|\.pem|\.key)$/.test(path));
  if (forbidden.length) fail(`CLI launcher contains forbidden packed content: ${forbidden.map(({ path }) => path).join(', ')}`);
  for (const required of ['dist/index.js', 'package.json', 'LICENSE']) if (!files.some(({ path }) => path === required)) fail(`CLI launcher lacks ${required}`);
  const tarball = join(packDestination, result.filename);
  const snapshot = await packedSnapshot(tarball, files);
  const { pkg } = snapshot;
  if (pkg.name !== '@kernlang/agon' || pkg.version !== version || pkg.private === true || pkg.license !== 'MIT') fail('CLI launcher identity/version/license mismatch');
  if (pkg.bin?.agon !== './dist/index.js' || !pkg.files?.includes('LICENSE')) fail('CLI launcher bin or pack allowlist is malformed');
  for (const path of ['release-channel.json', 'dist/release-channel.json']) {
    if (readFileSync(join(snapshot.packageRoot, path), 'utf8') !== readFileSync(channelOutput, 'utf8')) fail(`CLI launcher packed ${path} differs from qualified channel`);
  }
  return { id: pkg.name, version: pkg.version, role: 'managed-launcher', dependencies: Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies }).map(([id, range]) => ({ id, range })).sort((a, b) => a.id.localeCompare(b.id)), packedBytes: result.size, unpackedBytes: result.unpackedSize, fileCount: files.length, files, payloadHash: snapshot.payloadHash, integrity: result.integrity, shasum: result.shasum, tarballHash: sha256(readFileSync(tarball)), packageJsonHash: sha256(snapshot.packageBytes) };
}

try {
  if (map.packages.length !== 49 || releaseNames.size !== 49) fail('release set must contain 49 unique modular packages');
  if (selfTest) {
    const record = map.packages.find(({ id }) => id === '@kernlang/agon-kernel');
    const pkg = JSON.parse(readFileSync(join(root, 'packages', directory(record.id), 'package.json'), 'utf8'));
    validatePackage(record, pkg);
    assert.throws(() => validatePackage(record, { ...pkg, version: '9.9.9' }), /identity\/version\/license/);
    assert.throws(() => validatePackage(record, { ...pkg, dependencies: {} }), /dependencies differ/);
    assert.throws(() => validatePackage(record, { ...pkg, dependencies: { ...pkg.dependencies, '@kernlang/agon-mod-api': '^1.0.0' } }), /exact lockstep/);
    // Source changes after packing must not change archive identity or validation.
    const fixture = mkdtempSync(join(scratch, 'metadata-control-'));
    const fixturePackage = join(fixture, 'package');
    mkdirSync(fixturePackage);
    const packedMetadata = Buffer.from(JSON.stringify({ ...pkg, version: '9.9.9' }));
    writeFileSync(join(fixturePackage, 'package.json'), packedMetadata);
    const tarball = join(fixture, 'metadata.tgz');
    const packed = spawnSync('tar', ['-czf', tarball, '-C', fixture, 'package'], { encoding: 'utf8' });
    if (packed.status !== 0) fail(`metadata negative-control archive failed: ${packed.stderr}`);
    writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify(pkg));
    const archived = await packedSnapshot(tarball, [{ path: 'package.json', size: packedMetadata.byteLength }]);
    assert.deepEqual(archived.packageBytes, packedMetadata, 'archive metadata was replaced by source metadata');
    assert.throws(() => validatePackage(record, archived.pkg), /identity\/version\/license/);
    assert.notEqual(sha256(archived.packageBytes), sha256(readFileSync(join(fixturePackage, 'package.json'))));
    await assert.rejects(() => packedSnapshot(tarball, [{ path: 'package.json', size: 0 }]), /packed size differs/);
    await assert.rejects(() => packedSnapshot(tarball, [{ path: '../outside', size: 0 }]), /invalid packed path/);
  }
  const packages = [];
  for (const record of map.packages) packages.push(await inspect(record));
  const channel = { schemaVersion: 1, channel: 'local-release-candidate', version, packages: packages.map((pkg) => ({ id: pkg.id, version: pkg.version, dependencies: pkg.dependencies, ...(pkg.modId ? { modId: pkg.modId, manifestDependencies: pkg.manifestDependencies } : {}), sourceLocator: `${pkg.id}@${pkg.version}`, integrity: pkg.integrity, contentHash: pkg.tarballHash, manifestHash: pkg.manifestHash, payloadHash: pkg.payloadHash })) };
  const channelText = `${JSON.stringify(channel, null, 2)}\n`;
  if (check) {
    if (!existsSync(channelOutput) || readFileSync(channelOutput, 'utf8') !== channelText || !existsSync(builtChannelOutput) || readFileSync(builtChannelOutput, 'utf8') !== channelText) fail('CLI release channel drift');
  } else { writeFileSync(channelOutput, channelText); writeFileSync(builtChannelOutput, channelText); }
  const launcher = await inspectLauncher();
  const bom = { schemaVersion: 1, releaseSet: '@kernlang/agon-modular', version, packageCount: packages.length, artifactCount: packages.length + 1, dependencyEdgeCount: map.dependencyEdges.length, launcher, packages };
  const text = `${JSON.stringify(bom, null, 2)}\n`;
  if (check) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== text) fail('release-set/BOM drift');
  } else writeFileSync(output, text);
  console.log(JSON.stringify({ status: 'passed', version, packages: packages.length, dependencyEdges: map.dependencyEdges.length, artifacts: packages.length + 1, packedBytes: packages.reduce((sum, pkg) => sum + pkg.packedBytes, 0) + launcher.packedBytes }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
