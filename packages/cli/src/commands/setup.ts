import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import {
  DurableModHost,
  ManagedLifecycleService,
  canonicalJson,
  createManagedLifecyclePlan,
  createFirstPartyModCatalog,
  createReleaseSetupSelection,
  parseDesiredState,
  resolveDesiredState,
  runBoundedCandidateProcess,
  sha256Canonical,
  type BuiltInProfileId,
  type CandidateInstaller,
  type CandidateVerifier,
  type CandidateVerificationResult,
  type ManagedLifecyclePackagePlan,
  type ManagedLifecyclePlan,
  type ManagedNetworkPolicy,
  type ManagedPackageArtifact,
} from '@kernlang/agon-kernel';
import { modularHostRoot } from '../surface-authority-runtime.js';

const PROFILE_IDS = new Set(['minimal', 'maker', 'reviewer', 'researcher', 'full-compat', 'custom']);
const VERSION = '1.0.0';
interface ReleaseEntry { id: string; modId?: string; manifestDependencies?: string[]; version: string; dependencies: string[]; sourceLocator: string; integrity: `sha512-${string}`; contentHash: `sha256:${string}`; manifestHash: `sha256:${string}` }
interface ReleaseChannel { schemaVersion: 1; channel: string; version: string; packages: ReleaseEntry[] }

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
  const hostRoot = modularHostRoot();
  const host = new DurableModHost(hostRoot, { kernelVersion: VERSION, processIdentity: `setup-${process.pid}` });
  const service = new ManagedLifecycleService(host, { processIdentity: `setup-lifecycle-${process.pid}` });
  const existing = await service.readSelectedInstallation().catch(() => null);
  const currentDesiredInput = existing ? await readFile(join(hostRoot, 'desired-state.json'), 'utf8').then((text) => JSON.parse(text)).catch(() => null) : null;
  let selection: ReturnType<typeof createReleaseSetupSelection>;
  if (options.preserveExistingState && existing && currentDesiredInput) {
    const desiredState = parseDesiredState(currentDesiredInput);
    const resolved = resolveDesiredState(createFirstPartyModCatalog(), desiredState);
    selection = Object.freeze({ schemaVersion: 1, profile: 'custom', requestedWith: Object.freeze([]), requestedWithout: Object.freeze([]),
      desiredState, effectiveModIds: resolved.effective, effectivePackageIds: resolved.effectivePackages });
  } else {
    selection = createReleaseSetupSelection({ profile: profile as BuiltInProfileId, with: csv(args.with), without: csv(args.without), now: new Date().toISOString() });
  }
  const overrides = await locatorOverrides();
  const artifacts = buildArtifacts(release, selection.effectivePackageIds, overrides);
  await verifyLocalSpecs(artifacts);
  const lock = buildLock(artifacts, selection.desiredState, release);
  const desiredShape = (value: any) => value ? { selected: value.selected, disabled: value.disabled, constraints: value.constraints } : null;
  const packageShape = (values: readonly { id: string; version: string }[]) => values.map(({ id, version }) => ({ id, version })).sort((left, right) => left.id.localeCompare(right.id));
  if (existing && existing.kernelVersion === VERSION
    && canonicalJson(packageShape(existing.packages)) === canonicalJson(packageShape(artifacts))
    && canonicalJson(desiredShape(currentDesiredInput)) === canonicalJson(desiredShape(selection.desiredState))) {
    const launcher = await writeStableLauncher(hostRoot);
    console.log(JSON.stringify({ status: 'already-qualified', profile: selection.profile, generationUnchanged: true, launcher, packageCount: artifacts.length }, null, 2));
    return;
  }
  const plan = await createManagedLifecyclePlan(host, { operation: existing ? 'update' : 'install', networkPolicy: args.offline ? 'frozen-offline' : 'online', kernelVersion: VERSION, apiVersion: VERSION,
    requestedPackageIds: artifacts.map(({ id }) => id), artifacts, desiredState: selection.desiredState, lock });
  if (args.plan) { console.log(JSON.stringify({ status: 'planned', selection, lifecycle: plan, launcherSpec: process.env.AGON_SETUP_LAUNCHER_SPEC ?? `@kernlang/agon@${VERSION}` }, null, 2)); return; }
  const launcherSpec = process.env.AGON_SETUP_LAUNCHER_SPEC ?? `@kernlang/agon@${VERSION}`;
  const result = await service.apply(plan, new ReleaseSetInstaller(plan.packages, launcherSpec, typeof args.cache === 'string' ? resolve(args.cache) : undefined), new ReleaseSetVerifier());
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
async function locatorOverrides(): Promise<Readonly<Record<string, string>>> {
  const file = process.env.AGON_SETUP_PACKAGE_SPECS_FILE;
  if (!file) return Object.freeze({});
  const parsed = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('setup package-spec map must be a JSON object');
  return Object.freeze(Object.fromEntries(Object.entries(parsed).map(([id, value]) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`invalid setup package spec: ${id}`);
    return [id, value];
  })));
}
function buildArtifacts(release: ReleaseChannel, packageIds: readonly string[], overrides: Readonly<Record<string, string>>): ManagedPackageArtifact[] {
  const byId = new Map(release.packages.map((entry) => [entry.id, entry]));
  return packageIds.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new TypeError(`selected package is absent from release channel: ${id}`);
    const sourceLocator = overrides[id] ?? entry.sourceLocator;
    return Object.freeze({ ...entry, sourceLocator, source: overrides[id] ? 'local-cache' as const : 'registry' as const,
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
  const candidate = spec.startsWith('file:') ? spec.slice(5) : spec;
  return isAbsolute(candidate) ? resolve(candidate) : null;
}
class ReleaseSetInstaller implements CandidateInstaller {
  #installed = false;
  constructor(private readonly packages: readonly ManagedLifecyclePackagePlan[], private readonly launcherSpec: string, private readonly cacheDirectory?: string) {}
  async install(_entry: ManagedLifecyclePackagePlan, candidatePrefix: string, context: { readonly ignoreLifecycleScripts: true; readonly networkPolicy: ManagedNetworkPolicy }): Promise<void> {
    if (this.#installed) return;
    this.#installed = true;
    const result = await runBoundedCandidateProcess({ executable: 'npm', cwd: candidatePrefix, timeoutMs: 15 * 60_000, maxOutputBytes: 4 * 1024 * 1024,
      args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save=false', '--omit=optional', '--bin-links=false', '--prefix', candidatePrefix,
        ...(context.networkPolicy === 'frozen-offline' ? ['--offline'] : []), this.launcherSpec, ...this.packages.map(({ sourceLocator }) => sourceLocator)],
      env: { npm_config_ignore_scripts: 'true', ...(this.cacheDirectory ? { npm_config_cache: this.cacheDirectory } : {}) } });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(`release-set npm staging failed: exit=${result.exitCode} timeout=${result.timedOut} truncated=${result.outputTruncated} ${result.stderr.slice(0, 1000)}`);
  }
}
class ReleaseSetVerifier implements CandidateVerifier {
  async verify(candidatePrefix: string, plan: ManagedLifecyclePlan): Promise<CandidateVerificationResult> {
    const checks: Array<{ id: string; passed: boolean; detail?: string }> = [];
    try {
      for (const entry of plan.packages) {
        let installedVersion = 'missing';
        try { installedVersion = JSON.parse(await readFile(join(candidatePrefix, 'node_modules', ...entry.id.split('/'), 'package.json'), 'utf8')).version ?? 'missing'; } catch {}
        checks.push({ id: `package:${entry.id}`, passed: installedVersion === entry.version, detail: installedVersion });
      }
      let launcherVersion = 'missing';
      try { launcherVersion = JSON.parse(await readFile(join(candidatePrefix, 'node_modules', '@kernlang', 'agon', 'package.json'), 'utf8')).version ?? 'missing'; } catch {}
      checks.push({ id: 'launcher-package', passed: launcherVersion === VERSION, detail: launcherVersion });
      const executable = join(candidatePrefix, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
      const smoke = await runBoundedCandidateProcess({ executable: process.execPath, args: [executable, '--version'], cwd: candidatePrefix,
        env: { AGON_HOME: join(candidatePrefix, '.qualification-home'), AGON_MOD_SAFE_MODE: '1' }, timeoutMs: 30_000, maxOutputBytes: 128 * 1024 });
      checks.push({ id: 'kernel-safe-mode-smoke', passed: smoke.exitCode === 0 && smoke.stdout.includes(VERSION), detail: `exit=${smoke.exitCode}` });
    } catch (error) { checks.push({ id: 'candidate-inspection', passed: false, detail: String(error) }); }
    return Object.freeze({ passed: checks.every(({ passed }) => passed), checks: Object.freeze(checks.map((check) => Object.freeze(check))) });
  }
}
async function verifyLocalSpecs(artifacts: readonly ManagedPackageArtifact[]): Promise<void> {
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
const host = join(home, 'modular-host');
const pointer = JSON.parse(readFileSync(join(host, 'current-generation.json'), 'utf8'));
const generation = join(host, 'generations', String(pointer.generation).padStart(16, '0'));
const index = JSON.parse(readFileSync(join(generation, 'installed-index.json'), 'utf8'));
const prefix = resolve(host, index.installationPrefix);
if (isAbsolute(index.installationPrefix) || relative(host, prefix).startsWith('..')) throw new Error('managed installation prefix escapes host');
const cli = join(prefix, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
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
