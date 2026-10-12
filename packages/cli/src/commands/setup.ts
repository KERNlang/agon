import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, opendir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { persistencePath } from '@kernlang/agon-support-persistence';
import {
  DurableModHost,
  assertContainedPackagePath,
  inspectStaticManifest,
  hashInstalledPackagePayload,
  FOLDER_MOD_LIMITS,
  ManagedLifecycleService,
  canonicalJson,
  createManagedLifecyclePlan,
  createFirstPartyModCatalog,
  createReleaseSetupSelection,
  createFrozenNpmInstall,
  parseDesiredState,
  readMigrationSourceRevision,
  readGenerationConfiguration,
  resolveDesiredState,
  runBoundedCandidateProcess,
  runIsolatedNpmCandidateProcess,
  sha256Canonical,
  type BuiltInProfileId,
  type CandidateInstaller,
  type CandidateVerifier,
  type CandidateVerificationResult,
  type ManagedLifecyclePackagePlan,
  type ManagedLifecyclePlan,
  type ManagedLauncherIdentity,
  type ManagedNetworkPolicy,
  type ManagedPackageArtifact,
  type FrozenNpmCatalog,
} from '@kernlang/agon-kernel';
import { modularHostRoot } from '../surface-authority-runtime.js';

const PROFILE_IDS = new Set(['minimal', 'maker', 'reviewer', 'researcher', 'full-compat', 'custom']);
const VERSION = '1.0.0';
interface ReleaseEntry { id: string; modId?: string; manifestDependencies?: string[]; version: string; dependencies: string[]; sourceLocator: string; integrity: `sha512-${string}`; contentHash: `sha256:${string}`; manifestHash: `sha256:${string}`; payloadHash: `sha256:${string}` }
interface CompatibilityArtifact { id: string; version: string; sourceLocator: string; contentHash: `sha256:${string}`; integrity: string; payloadHash: `sha256:${string}` }
interface ReleaseChannel { schemaVersion: 1; channel: string; version: string; packages: ReleaseEntry[]; launcherFiles: string[]; npmCatalog: FrozenNpmCatalog; npmPayloads: Readonly<Record<string, `sha256:${string}`>>; compatibilityArtifacts: CompatibilityArtifact[] }

function csv(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export interface ManagedSetupArgs {
  profile?: string; with?: string; without?: string; interactive?: boolean;
  plan?: boolean; offline?: boolean; cache?: string; json?: boolean;
}

export async function runManagedSetup(args: ManagedSetupArgs, options: { preserveExistingState?: boolean } = {}): Promise<void> {
  const profile = String(args.profile ?? 'full-compat');
  if (!PROFILE_IDS.has(profile)) throw new TypeError(`unknown setup profile: ${profile}`);
  if (args.interactive) throw new Error('use bare `agon setup` in a terminal for interactive onboarding, or deterministic --profile/--with/--without flags for modular setup');
  const release = await channel();
  const launcherSpec = setupSource(process.env.AGON_SETUP_LAUNCHER_SPEC ?? `@kernlang/agon@${VERSION}`,
    `@kernlang/agon@${VERSION}`, release.npmCatalog.packages['node_modules/@kernlang/agon']?.resolved);
  const launcherIdentity = await bootstrapLauncherIdentity(release.launcherFiles, launcherSpec);
  const hostRoot = modularHostRoot();
  const host = new DurableModHost(hostRoot, { kernelVersion: VERSION, processIdentity: `setup-${process.pid}` });
  const service = new ManagedLifecycleService(host, { processIdentity: `setup-lifecycle-${process.pid}` });
  const selectedPointer = await host.readCurrentPointer();
  const existing = await service.readSelectedInstallation();
  let currentDesiredInput: unknown = null;
  if (selectedPointer) {
    currentDesiredInput = parseDesiredState(await host.readGenerationDesiredState(selectedPointer));
  }
  const assertSelectionCurrent = async () => {
    if (canonicalJson(await host.readCurrentPointer()) !== canonicalJson(selectedPointer)) {
      throw new Error('modular selection changed during setup; rerun setup to create a current plan');
    }
  };
  await assertSelectionCurrent();
  let selection: ReturnType<typeof createReleaseSetupSelection>;
  if (options.preserveExistingState && existing && currentDesiredInput) {
    const desiredState = parseDesiredState(currentDesiredInput);
    const resolved = resolveDesiredState(createFirstPartyModCatalog(), desiredState);
    selection = Object.freeze({ schemaVersion: 1, profile: 'custom', requestedWith: Object.freeze([]), requestedWithout: Object.freeze([]),
      desiredState, effectiveModIds: resolved.effective, effectivePackageIds: resolved.effectivePackages });
  } else {
    selection = createReleaseSetupSelection({ profile: profile as BuiltInProfileId, with: csv(args.with), without: csv(args.without), now: new Date().toISOString() });
  }
  const overrides = await locatorOverrides(release);
  const artifacts = buildArtifacts(release, selection.effectivePackageIds, overrides);
  await verifyLocalSpecs(artifacts);
  const compatibility = release.compatibilityArtifacts.map(entry => ({ ...entry, sourceLocator: overrides[entry.id] ?? entry.sourceLocator }));
  await verifyLocalSpecs(compatibility);
  const sources = Object.fromEntries([...artifacts, ...compatibility].map(entry => [entry.id, { version: entry.version, integrity: entry.integrity,
    resolved: localFile(entry.sourceLocator) ? `file:${localFile(entry.sourceLocator)}` : release.npmCatalog.packages[`node_modules/${entry.id}`]!.resolved! }]));
  sources['@kernlang/agon'] = { version: VERSION, integrity: '', resolved: localFile(launcherSpec) ? `file:${localFile(launcherSpec)}`
    : release.npmCatalog.packages['node_modules/@kernlang/agon']!.resolved! };
  const npmInput = createFrozenNpmInstall(release.npmCatalog, ['@kernlang/agon', ...artifacts.map(entry => entry.id)], sources);
  const ownedLocations = new Set(['node_modules/@kernlang/agon', ...artifacts.map(entry => `node_modules/${entry.id}`)]);
  const auxiliaryPayloads = { ...release.npmPayloads,
    ...Object.fromEntries(compatibility.map(entry => [`node_modules/${entry.id}`, entry.payloadHash])) };
  const dependencyPayloads = Object.freeze(Object.fromEntries(npmInput.requiredPaths.filter(path => !ownedLocations.has(path)).map(path => {
    const payloadHash = auxiliaryPayloads[path];
    if (typeof payloadHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(payloadHash)) throw new Error(`release dependency has no trusted payload identity: ${path}`);
    return [path, payloadHash];
  })));
  const lock = buildLock(artifacts, selection.desiredState, release);
  const desiredShape = (value: any) => value ? { selected: value.selected, disabled: value.disabled, constraints: value.constraints } : null;
  const packageShape = (values: readonly ManagedLifecyclePackagePlan[]) => values.map(({ id, version, source, sourceLocator, integrity, contentHash, manifestHash, payloadHash, dependencies, provenance }) =>
    ({ id, version, source, sourceLocator, integrity, contentHash, manifestHash, payloadHash: payloadHash ?? null, dependencies: [...dependencies].sort(), provenance })).sort((left, right) => left.id.localeCompare(right.id));
  if (!args.plan && existing && existing.kernelVersion === VERSION
    && canonicalJson(existing.launcher ?? null) === canonicalJson(launcherIdentity)
    && canonicalJson(packageShape(existing.packages)) === canonicalJson(packageShape(artifacts))
    && canonicalJson(desiredShape(currentDesiredInput)) === canonicalJson(desiredShape(selection.desiredState))) {
    const configuration = selectedPointer ? await readGenerationConfiguration(host, selectedPointer) : undefined;
    const expectedOwners = release.packages.filter(entry => entry.modId && selection.effectivePackageIds.includes(entry.id)).map(entry => entry.modId!).sort();
    if (configuration && configuration.source.path === persistencePath('config.json')
      && canonicalJson(configuration.owners.map(owner => owner.ownerId).sort()) === canonicalJson(expectedOwners)
      && await installedPayloadsMatch(hostRoot, existing.prefix, artifacts, launcherIdentity, dependencyPayloads)) {
      await assertSelectionCurrent();
      const launcher = await writeStableLauncher(hostRoot);
      console.log(JSON.stringify({ status: 'already-qualified', profile: selection.profile, generationUnchanged: true, launcher, packageCount: artifacts.length }, null, 2));
      return;
    }
  }
  const configSource = await readMigrationSourceRevision(persistencePath('config.json'));
  const plan = await createManagedLifecyclePlan(host, { operation: existing ? 'update' : 'install', networkPolicy: args.offline ? 'frozen-offline' : 'online', kernelVersion: VERSION, apiVersion: VERSION, configSource,
    requestedPackageIds: artifacts.map(({ id }) => id), artifacts, desiredState: selection.desiredState, lock, launcher: launcherIdentity });
  if (plan.basePointerHash !== (selectedPointer ? sha256Canonical(selectedPointer) : null)) {
    throw new Error('modular selection changed during setup; rerun setup to create a current plan');
  }
  if (args.plan) { console.log(JSON.stringify({ status: 'planned', selection, lifecycle: plan, launcherSpec }, null, 2)); return; }
  const result = await service.apply(plan, new ReleaseSetInstaller(npmInput, typeof args.cache === 'string' ? resolve(args.cache) : undefined), new ReleaseSetVerifier(dependencyPayloads));
  const launcher = await writeStableLauncher(hostRoot);
  console.log(JSON.stringify({ status: 'installed', generation: result.pointer.generation, restartRequired: result.restartRequired, profile: selection.profile, packageCount: plan.packages.length, launcher }, null, 2));
}
function platform(): 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64' {
  const value = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(value)) throw new TypeError(`unsupported Modular Agon platform: ${value}`);
  return value as ReturnType<typeof platform>;
}
async function channel(): Promise<ReleaseChannel> {
  const parsed = JSON.parse(await readFile(new URL('../release-channel.json', import.meta.url), 'utf8')) as ReleaseChannel;
  if (parsed.schemaVersion !== 1 || parsed.version !== VERSION || parsed.packages.length !== 49) throw new TypeError('bundled release channel is malformed');
  return parsed;
}
async function locatorOverrides(release: ReleaseChannel): Promise<Readonly<Record<string, string>>> {
  const file = process.env.AGON_SETUP_PACKAGE_SPECS_FILE;
  if (!file) return Object.freeze({});
  const parsed = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('setup package-spec map must be a JSON object');
  return Object.freeze(Object.fromEntries(Object.entries(parsed).map(([id, value]) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`invalid setup package spec: ${id}`);
    const entry = [...release.packages, ...release.compatibilityArtifacts].find(entry => entry.id === id);
    if (!entry) throw new TypeError(`unknown setup package override: ${id}`);
    return [id, setupSource(value, entry.sourceLocator, release.npmCatalog.packages[`node_modules/${id}`]?.resolved)];
  })));
}

function setupSource(spec: string, canonical: string, resolved: string | undefined): string {
  const file = localFile(spec);
  if (file) return `file:${file}`;
  if (spec === canonical || spec === resolved) return canonical;
  throw new TypeError(`unsupported setup package source for ${canonical}; use its frozen source or a local file`);
}

async function bootstrapLauncherIdentity(paths: readonly string[], sourceLocator: string): Promise<ManagedLauncherIdentity> {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > FOLDER_MOD_LIMITS.maxFiles
    || new Set(paths).size !== paths.length || paths.some(path => typeof path !== 'string'
      || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..'))
    || !['package.json', 'dist/index.js', 'release-channel.json', 'dist/release-channel.json'].every(path => paths.includes(path))) {
    throw new TypeError('bundled launcher inventory is malformed');
  }
  let root = dirname(fileURLToPath(import.meta.url));
  let found = false;
  for (let depth = 0; depth < 4; depth++) {
    try {
      const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (metadata.name === '@kernlang/agon' && metadata.version === VERSION) { found = true; break; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    root = dirname(root);
  }
  if (!found) throw new Error('cannot locate the trusted Agon bootstrap package');
  root = await realpath(root);
  const snapshot = await mkdtemp(join(tmpdir(), 'agon-bootstrap-'));
  try {
    let total = 0;
    for (const path of paths) {
      const source = await assertContainedPackagePath(root, path);
      if (source !== join(root, path)) throw new Error('bootstrap inventory contains a symbolic link');
      const info = await stat(source);
      total += info.size;
      if (!info.isFile() || info.size > FOLDER_MOD_LIMITS.maxFileBytes || total > FOLDER_MOD_LIMITS.maxTotalBytes) {
        throw new Error('bootstrap inventory exceeds package bounds');
      }
      await mkdir(dirname(join(snapshot, path)), { recursive: true });
      await cp(source, join(snapshot, path), { dereference: false });
    }
    return Object.freeze({ version: VERSION, sourceLocator, payloadHash: await hashInstalledPackagePayload(snapshot) });
  } finally { await rm(snapshot, { recursive: true, force: true }); }
}
function buildArtifacts(release: ReleaseChannel, packageIds: readonly string[], overrides: Readonly<Record<string, string>>): ManagedPackageArtifact[] {
  const byId = new Map(release.packages.map((entry) => [entry.id, entry]));
  return packageIds.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new TypeError(`selected package is absent from release channel: ${id}`);
    const sourceLocator = overrides[id] ?? entry.sourceLocator;
    return Object.freeze({ ...entry, sourceLocator, source: localFile(sourceLocator) ? 'local-cache' as const : 'registry' as const,
      lifecycleScripts: Object.freeze([]), available: true, provenance: 'verified' as const, trustTier: 'first-party' as const });
  });
}
function buildLock(artifacts: readonly ManagedPackageArtifact[], desiredState: unknown, release: ReleaseChannel) {
  const desiredStateHash = sha256Canonical(desiredState);
  const releaseById = new Map(release.packages.map((entry) => [entry.id, entry]));
  const packages = artifacts.map((entry, resolutionOrder) => {
    const identity = releaseById.get(entry.id);
    if (!identity) throw new TypeError(`release identity missing for ${entry.id}`);
    return Object.freeze({
    id: identity.modId ?? entry.id, version: entry.version, source: 'registry' as const, sourceLocator: entry.sourceLocator,
    contentHash: entry.contentHash, manifestHash: entry.manifestHash, platform: platform(), enabled: true,
    resolutionOrder, dependencies: Object.freeze([...(identity.manifestDependencies ?? entry.dependencies)].sort()),
    trustRecordId: `first-party:${entry.id}@${entry.version}`, grantRecordIds: Object.freeze([]),
  }); });
  const graphHash = sha256Canonical({ kernelVersion: VERSION, apiVersion: VERSION, desiredStateHash, packages });
  return Object.freeze({ schemaVersion: 1 as const, kernelVersion: VERSION, apiVersion: VERSION, desiredStateHash, graphHash, packages: Object.freeze(packages) });
}
function localFile(spec: string): string | null {
  if (spec.startsWith('file:') && spec.length > 5) return resolve(spec.slice(5));
  const candidate = spec.startsWith('file:') ? spec.slice(5) : spec;
  return isAbsolute(candidate) ? resolve(candidate) : null;
}
class ReleaseSetInstaller implements CandidateInstaller {
  #installed = false;
  constructor(private readonly input: ReturnType<typeof createFrozenNpmInstall>, private readonly cacheDirectory?: string) {}
  async install(_entry: ManagedLifecyclePackagePlan, candidatePrefix: string, context: { readonly ignoreLifecycleScripts: true; readonly networkPolicy: ManagedNetworkPolicy }): Promise<void> {
    if (this.#installed) return;
    this.#installed = true;
    const lockBytes = `${JSON.stringify(this.input.lock, null, 2)}\n`;
    await writeFile(join(candidatePrefix, 'package.json'), `${JSON.stringify(this.input.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(join(candidatePrefix, 'package-lock.json'), lockBytes, { flag: 'wx', mode: 0o600 });
    const result = await runIsolatedNpmCandidateProcess({ executable: 'npm', cwd: candidatePrefix, timeoutMs: 15 * 60_000, maxOutputBytes: 4 * 1024 * 1024,
      args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', '--bin-links=false',
        ...(context.networkPolicy === 'frozen-offline' ? ['--offline'] : [])] },
      { cacheDirectory: this.cacheDirectory });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(`release-set npm staging failed: exit=${result.exitCode} timeout=${result.timedOut} truncated=${result.outputTruncated} ${result.stderr.slice(0, 1000)}`);
    if (await readFile(join(candidatePrefix, 'package-lock.json'), 'utf8') !== lockBytes) throw new Error('npm staging changed the frozen dependency lock');
  }
}
async function packageRootWithinPrefix(prefix: string, id: string): Promise<string> {
  const root = await assertContainedPackagePath(prefix, join('node_modules', id));
  if (root !== join(prefix, 'node_modules', id)) throw new Error('candidate package path contains symbolic links');
  return root;
}

/** Check npm package boundaries without importing candidate code. */
async function assertCandidateDependencies(prefix: string, owned: readonly ManagedLifecyclePackagePlan[],
  dependencyPayloads: Readonly<Record<string, `sha256:${string}`>>): Promise<void> {
  const expected = new Set(['node_modules/@kernlang/agon', ...owned.map(entry => `node_modules/${entry.id}`)]);
  for (const [path, hash] of Object.entries(dependencyPayloads)) {
    if (expected.has(path) || !path.startsWith('node_modules/') || path.includes('\\')
      || path.split('/').some(part => !part || part === '.' || part === '..') || !/^sha256:[a-f0-9]{64}$/.test(hash)) {
      throw new Error(`invalid or duplicate dependency identity: ${path}`);
    }
    expected.add(path);
  }
  const modules = join(prefix, 'node_modules');
  const pending = [{ path: modules, scope: '', depth: 0 }];
  let entries = 0;
  let packages = 0;
  while (pending.length) {
    const { path, scope, depth } = pending.pop()!;
    if (depth > FOLDER_MOD_LIMITS.maxDepth) throw new Error('candidate dependency depth exceeds limit');
    if (await assertContainedPackagePath(prefix, relative(prefix, path)) !== path) throw new Error('candidate dependency path contains symbolic links');
    for await (const entry of await opendir(path)) {
      if (++entries > FOLDER_MOD_LIMITS.maxEntries) throw new Error('candidate dependency entry count exceeds limit');
      // npm bin links are not package roots. No bin is executed by this scan.
      if (!scope && ['.bin', '.package-lock.json'].includes(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('candidate dependency must be an unpacked directory');
      const child = join(path, entry.name);
      if ((!scope && entry.name.startsWith('@')) || (scope && entry.name === 'node_modules')) {
        pending.push({ path: child, scope: scope ? '' : entry.name, depth: depth + 1 });
        continue;
      }
      if (++packages > FOLDER_MOD_LIMITS.maxPackages) throw new Error('candidate dependency package count exceeds limit');
      const id = scope ? `${scope}/${entry.name}` : entry.name;
      if (['@kernlang/agon-kernel', '@kernlang/agon-mod-api'].includes(id) && child !== join(modules, id)) {
        throw new Error(`candidate contains a duplicate singleton package: ${id}`);
      }
      const location = relative(prefix, child);
      if (!expected.delete(location)) throw new Error(`candidate contains an unexpected dependency: ${location}`);
      if (Object.hasOwn(dependencyPayloads, location) && await hashInstalledPackagePayload(child) !== dependencyPayloads[location]) {
        throw new Error(`candidate dependency payload differs: ${location}`);
      }
      const nested = join(child, 'node_modules');
      try {
        const info = await lstat(nested);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('candidate nested dependencies must be an unpacked directory');
        pending.push({ path: nested, scope: '', depth: depth + 1 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  if (expected.size) throw new Error(`candidate dependencies are missing: ${[...expected].sort().join(', ')}`);
}

async function installedPayloadsMatch(hostRoot: string, relativePrefix: string, packages: readonly ManagedLifecyclePackagePlan[], launcher: ManagedLauncherIdentity,
  dependencyPayloads: Readonly<Record<string, `sha256:${string}`>>): Promise<boolean> {
  try {
    const canonicalHost = await realpath(hostRoot);
    const prefix = await assertContainedPackagePath(canonicalHost, relativePrefix);
    if (prefix !== resolve(canonicalHost, relativePrefix)) return false;
    await assertCandidateDependencies(prefix, packages, dependencyPayloads);
    for (const entry of packages) {
      if (!entry.payloadHash || await hashInstalledPackagePayload(await packageRootWithinPrefix(prefix, entry.id)) !== entry.payloadHash) return false;
    }
    return await hashInstalledPackagePayload(await packageRootWithinPrefix(prefix, '@kernlang/agon')) === launcher.payloadHash;
  } catch {
    // Unreadable or changed files require fresh staging, not shortcut approval.
    return false;
  }
}

export class ReleaseSetVerifier implements CandidateVerifier {
  readonly #dependencyPayloads: Readonly<Record<string, `sha256:${string}`>>;
  constructor(dependencyPayloads: Readonly<Record<string, `sha256:${string}`>>) {
    this.#dependencyPayloads = Object.freeze({ ...dependencyPayloads });
  }

  async verify(candidatePrefix: string, plan: ManagedLifecyclePlan,
    context: { readonly configurationFiles: Readonly<Record<string, Uint8Array>> } = { configurationFiles: {} }): Promise<CandidateVerificationResult> {
    const checks: Array<{ id: string; passed: boolean; detail?: string }> = [];
    let qualificationHome: string | undefined;
    try {
      candidatePrefix = await realpath(candidatePrefix);
      await assertCandidateDependencies(candidatePrefix, plan.packages, this.#dependencyPayloads);
      checks.push({ id: 'installed-npm-dependencies', passed: true });
      for (const entry of plan.packages) {
        const root = await packageRootWithinPrefix(candidatePrefix, entry.id);
        checks.push({ id: `installed-payload:${entry.id}`, passed: entry.payloadHash !== undefined
          && await hashInstalledPackagePayload(root) === entry.payloadHash });
        const packagePath = await assertContainedPackagePath(root, 'package.json');
        const bytes = await readFile(packagePath);
        const metadata = JSON.parse(bytes.toString('utf8'));
        checks.push({ id: `package:${entry.id}`, passed: metadata.name === entry.id && metadata.version === entry.version,
          detail: `${metadata.name}@${metadata.version}` });
        let hasManifest = true;
        try { await stat(join(root, 'agon.mod.json')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          hasManifest = false;
        }
        // The release channel hashes mod manifests and support package metadata.
        const manifestHash = hasManifest ? (await inspectStaticManifest(root)).manifestHash
          : `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        checks.push({ id: `static-identity:${entry.id}`, passed: manifestHash === entry.manifestHash });
      }
      const launcherRoot = await packageRootWithinPrefix(candidatePrefix, '@kernlang/agon');
      const launcherMetadata = JSON.parse(await readFile(await assertContainedPackagePath(launcherRoot, 'package.json'), 'utf8'));
      checks.push({ id: 'launcher-package', passed: launcherMetadata.name === '@kernlang/agon' && launcherMetadata.version === VERSION,
        detail: `${launcherMetadata.name}@${launcherMetadata.version}` });
      checks.push({ id: 'launcher-payload', passed: plan.launcher?.version === VERSION
        && await hashInstalledPackagePayload(launcherRoot) === plan.launcher.payloadHash });
      if (checks.some(check => !check.passed)) return Object.freeze({ passed: false, checks: Object.freeze(checks.map(check => Object.freeze(check))) });
      const kernelId = '@kernlang/agon-kernel';
      if (!plan.packages.some(entry => entry.id === kernelId)) throw new Error('candidate plan lacks a verified kernel');
      const kernelRoot = await packageRootWithinPrefix(candidatePrefix, kernelId);
      const activationRunner = await assertContainedPackagePath(kernelRoot, 'dist/candidate-activation-runner.js');
      qualificationHome = await mkdtemp(join(candidatePrefix, '.qualification-'));
      const isolatedEnvironment = { HOME: qualificationHome, AGON_HOME: join(qualificationHome, 'agon'),
        XDG_CONFIG_HOME: join(qualificationHome, 'config'), XDG_CACHE_HOME: join(qualificationHome, 'cache'),
        XDG_DATA_HOME: join(qualificationHome, 'data'), XDG_STATE_HOME: join(qualificationHome, 'state') };
      const inputPath = join(qualificationHome, 'activation.json');
      const input = JSON.stringify({ plan, hostRoot: join(qualificationHome, 'modular-host'),
        configurationFiles: Object.fromEntries(Object.entries(context.configurationFiles).map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')])) });
      if (Buffer.byteLength(input) > 8 * 1024 * 1024) throw new Error('candidate input exceeds byte limit');
      await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
      const activation = await runBoundedCandidateProcess({ executable: process.execPath, args: [activationRunner, inputPath],
        cwd: candidatePrefix, env: isolatedEnvironment, timeoutMs: 30_000, maxOutputBytes: 128 * 1024 });
      await assertCandidateDependencies(candidatePrefix, plan.packages, this.#dependencyPayloads);
      checks.push({ id: 'post-activation-npm-dependencies', passed: true });
      const records = activation.stdout.split('\n').filter(line => line.startsWith('AGON_CANDIDATE_RESULT:'));
      const receipt = records.length === 1 ? JSON.parse(records[0]!.slice('AGON_CANDIDATE_RESULT:'.length)) : null;
      const installed = new Set(plan.packages.map(entry => entry.id));
      const expectedActive = createFirstPartyModCatalog().mods.map(entry => entry.id).filter(id => installed.has(id)).sort();
      checks.push({ id: 'sacrificial-activation', passed: activation.exitCode === 0 && activation.signal === null
        && !activation.timedOut && !activation.outputTruncated && receipt?.schemaVersion === 1
        && receipt.planHash === plan.planHash && receipt.disposed === true
        && canonicalJson(receipt.activePackageIds) === canonicalJson(expectedActive)
        && ['cli', 'tui', 'mcp', 'cesar', 'docs'].every(surface => Number.isSafeInteger(receipt.surfaceCounts?.[surface]) && receipt.surfaceCounts[surface] >= 0),
        detail: `exit=${activation.exitCode} signal=${activation.signal} timeout=${activation.timedOut} truncated=${activation.outputTruncated} completionRecords=${records.length}` });
      for (const entry of plan.packages) {
        const root = await packageRootWithinPrefix(candidatePrefix, entry.id);
        checks.push({ id: `post-activation-payload:${entry.id}`, passed: await hashInstalledPackagePayload(root) === entry.payloadHash });
      }
      checks.push({ id: 'post-activation-launcher-payload', passed:
        await hashInstalledPackagePayload(await packageRootWithinPrefix(candidatePrefix, '@kernlang/agon')) === plan.launcher?.payloadHash });
      if (checks.some(check => !check.passed)) return Object.freeze({ passed: false, checks: Object.freeze(checks.map(check => Object.freeze(check))) });
      const executable = await assertContainedPackagePath(launcherRoot, 'dist/index.js');
      if (executable !== join(launcherRoot, 'dist/index.js')) throw new Error('candidate launcher executable contains symbolic links');
      const smoke = await runBoundedCandidateProcess({ executable: process.execPath, args: [executable, '--version'], cwd: candidatePrefix,
        env: { ...isolatedEnvironment, AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 30_000, maxOutputBytes: 128 * 1024 });
      await assertCandidateDependencies(candidatePrefix, plan.packages, this.#dependencyPayloads);
      checks.push({ id: 'post-smoke-npm-dependencies', passed: true });
      checks.push({ id: 'kernel-safe-mode-smoke',
        passed: smoke.exitCode === 0 && smoke.signal === null && !smoke.timedOut && !smoke.outputTruncated && smoke.stdout.trim() === VERSION,
        detail: `exit=${smoke.exitCode} signal=${smoke.signal} timeout=${smoke.timedOut} truncated=${smoke.outputTruncated}` });
      for (const entry of plan.packages) {
        const root = await packageRootWithinPrefix(candidatePrefix, entry.id);
        checks.push({ id: `post-smoke-payload:${entry.id}`, passed: await hashInstalledPackagePayload(root) === entry.payloadHash });
      }
      checks.push({ id: 'post-smoke-launcher-payload', passed:
        await hashInstalledPackagePayload(await packageRootWithinPrefix(candidatePrefix, '@kernlang/agon')) === plan.launcher?.payloadHash });
    } catch (error) { checks.push({ id: 'candidate-inspection', passed: false, detail: String(error) }); }
    finally { if (qualificationHome) await rm(qualificationHome, { recursive: true, force: true }); }
    return Object.freeze({ passed: checks.every(({ passed }) => passed), checks: Object.freeze(checks.map((check) => Object.freeze(check))) });
  }
}
async function verifyLocalSpecs(artifacts: readonly { readonly id: string; readonly sourceLocator: string; readonly contentHash: string }[]): Promise<void> {
  for (const artifact of artifacts) {
    const file = localFile(artifact.sourceLocator);
    if (!file) continue;
    const actual = `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`;
    if (actual !== artifact.contentHash) throw new TypeError(`local package hash does not match release channel: ${artifact.id}`);
  }
}
async function writeStableLauncher(hostRoot: string): Promise<string> {
  const binRoot = join(dirname(hostRoot), 'bin');
  const target = join(binRoot, 'agon');
  const temporary = `${target}.${process.pid}.tmp`;
  const body = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const home = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = join(home, ${JSON.stringify(relative(dirname(hostRoot), hostRoot))});
const pointer = JSON.parse(readFileSync(join(host, 'current-generation.json'), 'utf8'));
const generation = join(host, 'generations', String(pointer.generation).padStart(16, '0'));
const index = JSON.parse(readFileSync(join(generation, 'installed-index.json'), 'utf8'));
const prefix = resolve(host, index.installationPrefix);
if (isAbsolute(index.installationPrefix) || relative(host, prefix).startsWith('..')) throw new Error('managed installation prefix escapes host');
const cli = join(prefix, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, AGON_MODULAR_HOST_ROOT: host } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
  await mkdir(binRoot, { recursive: true, mode: 0o700 });
  await writeFile(temporary, body, { encoding: 'utf8', mode: 0o700, flag: 'wx' });
  await chmod(temporary, 0o700);
  await rename(temporary, target);
  return target;
}

export const setupCommand: any = defineCommand({
  meta: { name: 'setup', description: 'Plan or apply a durable Modular Agon installation and profile' },
  args: {
    profile: { type: 'string', default: 'full-compat', description: 'minimal | maker | reviewer | researcher | full-compat | custom' },
    with: { type: 'string', description: 'Comma-separated mods to add (short or agon.* IDs)' },
    without: { type: 'string', description: 'Comma-separated mods to remove; hard dependents cascade' },
    interactive: { type: 'boolean', description: 'Open the interactive setup wizard' },
    plan: { type: 'boolean', description: 'Print the exact package/profile plan without applying it' },
    offline: { type: 'boolean', description: 'Require a complete local npm cache with no network fallback' },
    cache: { type: 'string', description: 'Isolated npm cache directory for candidate staging' },
    json: { type: 'boolean', description: 'Emit machine-readable setup output' },
  },
  async run({ args }) {
    await runManagedSetup(args);
  },
});
