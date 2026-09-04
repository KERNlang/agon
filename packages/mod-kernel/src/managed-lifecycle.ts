import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { valid as validSemver } from 'semver';
import type { ModManifest, ModSource } from '@kernlang/agon-mod-api';
import type { CanonicalModLock, LockedModPackage } from './lock.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import { DurableModHost, type GenerationPointer } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';
import { rollbackGeneration } from './host-rollback.js';
import { makeTreeRemovable } from './removable-tree.js';
import { WriterFence, type WriterLockOptions } from './writer-lock.js';
import { evaluateThirdPartyAuthority, TrustGrantStore, type TrustPublisher } from './trust-authority.js';

export type ManagedLifecycleOperation = 'install' | 'update' | 'downgrade';
export type ManagedNetworkPolicy = 'online' | 'frozen-offline';
export type ManagedPackageSourceKind = 'registry' | 'local-cache' | 'linked-development';

export interface ManagedPackageArtifact {
  readonly id: string;
  readonly version: string;
  readonly source: ManagedPackageSourceKind;
  readonly sourceLocator: string;
  readonly authoritySource?: Exclude<ModSource, 'bundled'>;
  readonly publisher?: TrustPublisher;
  readonly integrity: `sha512-${string}`;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly dependencies: readonly string[];
  readonly lifecycleScripts: readonly string[];
  readonly available: boolean;
  readonly provenance: 'verified' | 'unavailable' | 'failed';
  readonly trustTier: 'first-party' | 'third-party';
  readonly manifest?: ModManifest;
  readonly linkedRealpath?: string;
}
export interface ManagedThirdPartyAuthority {
  readonly trustRecordId: string;
  readonly grantRecordIds: readonly string[];
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly trustModel: 'full-code';
}

async function assertPersistedThirdPartyAuthority(
  host: DurableModHost,
  artifact: ManagedPackageArtifact,
  locked: LockedModPackage,
  authority: ManagedThirdPartyAuthority,
): Promise<void> {
  if (!artifact.authoritySource || !artifact.publisher) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party artifact lacks source and publisher provenance binding: ' + artifact.id);
  }
  const store = new TrustGrantStore(host.root, host.hostIo);
  const trustRecords = await store.readTrust();
  const grantRecords = await store.readGrants();
  const trust = trustRecords.find(({ recordId }) => recordId === authority.trustRecordId);
  if (!trust || trust.decision !== 'trusted'
    || trust.modId !== artifact.id || trust.version !== artifact.version
    || trust.source !== artifact.authoritySource || trust.source !== locked.source
    || trust.sourceLocator !== artifact.sourceLocator
    || sha256Canonical(trust.publisher) !== sha256Canonical(artifact.publisher)
    || trust.contentHash !== artifact.contentHash || trust.manifestHash !== artifact.manifestHash) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party trust authority is not backed by an exact immutable record: ' + artifact.id);
  }
  if (!artifact.manifest || artifact.manifest.id !== artifact.id || artifact.manifest.version !== artifact.version
    || sha256Canonical(artifact.manifest) !== artifact.manifestHash) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party artifact lacks an exact hash-bound manifest: ' + artifact.id);
  }
  const grantById = new Map(grantRecords.map((record) => [record.recordId, record]));
  const selectedGrants = [];
  for (const recordId of authority.grantRecordIds) {
    const grant = grantById.get(recordId);
    if (!grant || grant.modId !== artifact.id || grant.contentHash !== artifact.contentHash
      || grant.decision !== 'allow' || grant.revokedAt) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party grant authority is not backed by an exact active record: ' + artifact.id);
    }
    selectedGrants.push(grant);
  }
  const permissionKey = (capability: string, resources: readonly string[]) => JSON.stringify([capability, [...resources].sort()]);
  const declaredPermissions = new Map(artifact.manifest.permissions.map((permission) => [permissionKey(permission.capability, permission.resources), permission]));
  for (const grant of selectedGrants) {
    if (!declaredPermissions.has(permissionKey(grant.capability, grant.resources))) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party authority contains an undeclared capability grant: ' + artifact.id);
    }
  }
  for (const permission of artifact.manifest.permissions.filter(({ required }) => required)) {
    const matching = selectedGrants.filter((grant) => permissionKey(grant.capability, grant.resources) === permissionKey(permission.capability, permission.resources));
    if (matching.length !== 1) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party required permission lacks one exact active grant: ' + artifact.id + '/' + permission.capability);
    }
  }
  const latest = evaluateThirdPartyAuthority({
    modId: artifact.id,
    version: artifact.version,
    source: artifact.authoritySource,
    sourceLocator: artifact.sourceLocator,
    contentHash: artifact.contentHash,
    manifestHash: artifact.manifestHash,
    publisher: artifact.publisher,
  }, artifact.manifest, trustRecords, grantRecords);
  if (!latest.allowed || latest.trustRecordId !== authority.trustRecordId
    || JSON.stringify([...latest.grantRecordIds].sort()) !== JSON.stringify([...authority.grantRecordIds].sort())) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party authority is stale, revoked, denied, or does not match latest exact records: ' + artifact.id, {
      reason: latest.reason,
      missingCapabilities: latest.missingCapabilities,
    });
  }
  if (locked.trustRecordId !== trust.recordId) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'persisted third-party trust authority does not match the canonical lock: ' + artifact.id);
  }
}


export interface ManagedLifecycleRequest {
  readonly operation: ManagedLifecycleOperation;
  readonly networkPolicy: ManagedNetworkPolicy;
  readonly kernelVersion: string;
  readonly apiVersion: string;
  readonly requestedPackageIds: readonly string[];
  readonly artifacts: readonly ManagedPackageArtifact[];
  readonly desiredState: unknown;
  readonly lock: CanonicalModLock;
  readonly thirdPartyAuthority?: Readonly<Record<string, ManagedThirdPartyAuthority>>;
  readonly currentInvocation?: {
    readonly installationPrefix: string | null;
    readonly source: 'managed' | 'linked-development' | 'npx-ephemeral' | 'unknown';
  };
}

export interface ManagedLifecyclePackagePlan {
  readonly id: string;
  readonly version: string;
  readonly source: ManagedPackageSourceKind;
  readonly sourceLocator: string;
  readonly authoritySource?: Exclude<ModSource, 'bundled'>;
  readonly publisher?: TrustPublisher;
  readonly integrity: `sha512-${string}`;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly dependencies: readonly string[];
  readonly provenance: ManagedPackageArtifact['provenance'];
}

export interface ManagedLifecyclePlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly operation: ManagedLifecycleOperation;
  readonly networkPolicy: ManagedNetworkPolicy;
  readonly kernelVersion: string;
  readonly apiVersion: string;
  readonly baseGeneration: number;
  readonly basePointerHash: `sha256:${string}` | null;
  readonly requestedPackageIds: readonly string[];
  readonly packages: readonly ManagedLifecyclePackagePlan[];
  readonly missing: readonly string[];
  readonly approvalReasons: readonly string[];
  readonly desiredState: unknown;
  readonly lock: CanonicalModLock;
  readonly planHash: `sha256:${string}`;
}

export interface CandidateVerificationResult {
  readonly passed: boolean;
  readonly checks: readonly {
    readonly id: string;
    readonly passed: boolean;
    readonly detail?: string;
  }[];
}

export interface CandidateInstaller {
  install(
    packagePlan: ManagedLifecyclePackagePlan,
    candidatePrefix: string,
    context: { readonly ignoreLifecycleScripts: true; readonly networkPolicy: ManagedNetworkPolicy },
  ): Promise<void>;
}

export interface CandidateVerifier {
  verify(candidatePrefix: string, plan: ManagedLifecyclePlan): Promise<CandidateVerificationResult>;
}

export type ManagedLifecycleFaultPoint =
  | 'after-lifecycle-lock'
  | 'after-lifecycle-journal'
  | 'after-prefix-created'
  | 'after-packages-staged'
  | 'after-candidate-verified'
  | 'after-prefix-promoted'
  | 'after-generation-selected'
  | 'after-lifecycle-receipt';

export interface ManagedLifecycleOptions {
  readonly io?: HostIo;
  readonly now?: () => Date;
  readonly ownerId?: string;
  readonly processIdentity?: string;
  readonly writerLock?: Omit<WriterLockOptions, 'io' | 'now' | 'processIdentity'>;
  readonly fault?: (point: ManagedLifecycleFaultPoint) => void | Promise<void>;
}

export interface ManagedInstallationRecord {
  readonly schemaVersion: 1;
  readonly installationId: string;
  readonly planHash: `sha256:${string}`;
  readonly prefix: string;
  readonly kernelVersion: string;
  readonly apiVersion: string;
  readonly packages: readonly ManagedLifecyclePackagePlan[];
  readonly createdAt: string;
  readonly qualifiedAt: string;
  readonly verification: CandidateVerificationResult;
}

export interface ManagedLifecycleReceipt {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly operation: ManagedLifecycleOperation | 'rollback';
  readonly outcome: 'committed' | 'rolled-back' | 'failed';
  readonly planHash: `sha256:${string}` | null;
  readonly baseGeneration: number;
  readonly selectedGeneration: number | null;
  readonly installationId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly steps: readonly { readonly id: string; readonly state: 'passed' | 'failed'; readonly detail?: string }[];
  readonly error?: string;
}

export interface ManagedLifecycleApplyResult {
  readonly pointer: GenerationPointer;
  readonly installation: ManagedInstallationRecord;
  readonly receipt: ManagedLifecycleReceipt;
  readonly restartRequired: true;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const PACKAGE_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function safeId(value: string, label: string): string {
  if (!PACKAGE_ID.test(value)) throw new TypeError(`${label} is not a canonical package ID: ${value}`);
  return value;
}

function safeLocator(value: string): string {
  if (!value.trim() || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new TypeError('package source locator is malformed');
  }
  if (value.includes('://')) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new TypeError('package source locator URL is malformed'); }
    if (parsed.username || parsed.password) throw new TypeError('package source locator must not contain credentials');
    const sensitive = [...parsed.searchParams.keys()].filter((key) => /token|key|secret|password|auth/i.test(key));
    if (sensitive.length > 0) throw new TypeError('package source locator must not contain credential query parameters');
  }
  return value;
}

function safeInstallationId(planHash: string): string {
  if (!SHA256.test(planHash)) throw new TypeError('installation plan hash is malformed');
  return planHash.slice('sha256:'.length, 'sha256:'.length + 32);
}

function planSubject(plan: Omit<ManagedLifecyclePlan, 'planHash'>): `sha256:${string}` {
  return sha256Canonical(plan);
}

function assertExactLockPackage(artifact: ManagedPackageArtifact, locked: LockedModPackage): void {
  if (
    locked.version !== artifact.version
    || locked.source !== (artifact.authoritySource ?? (artifact.source === 'linked-development' ? 'explicit-dev' : 'registry'))
    || locked.sourceLocator !== artifact.sourceLocator
    || locked.contentHash !== artifact.contentHash
    || locked.manifestHash !== artifact.manifestHash
  ) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', `artifact does not match canonical lock: ${artifact.id}`);
  }
}

function topologicalClosure(
  requested: readonly string[],
  artifacts: ReadonlyMap<string, ManagedPackageArtifact>,
): ManagedPackageArtifact[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ManagedPackageArtifact[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new DurableHostError('MOD_TRANSACTION_FAILED', `package dependency cycle contains ${id}`);
    const artifact = artifacts.get(id);
    if (!artifact) throw new DurableHostError('MOD_TRANSACTION_FAILED', `package dependency is missing: ${id}`);
    visiting.add(id);
    for (const dependency of [...artifact.dependencies].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(artifact);
  };
  for (const id of [...requested].sort()) visit(id);
  return ordered;
}

export async function createManagedLifecyclePlan(
  host: DurableModHost,
  request: ManagedLifecycleRequest,
  _now = new Date().toISOString(),
): Promise<ManagedLifecyclePlan> {
  if (!validSemver(request.kernelVersion) || !validSemver(request.apiVersion)) throw new TypeError('kernel and API versions must be valid semver');
  if (request.lock.kernelVersion !== request.kernelVersion || request.lock.apiVersion !== request.apiVersion) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'candidate lock is incompatible with the requested kernel or API version');
  }
  if (new Set(request.requestedPackageIds).size !== request.requestedPackageIds.length) throw new TypeError('requested package IDs must be unique');
  const artifactMap = new Map<string, ManagedPackageArtifact>();
  for (const artifact of request.artifacts) {
    safeId(artifact.id, 'artifact ID');
    if (artifactMap.has(artifact.id)) throw new TypeError(`duplicate artifact: ${artifact.id}`);
    if (!validSemver(artifact.version)) throw new TypeError(`artifact version is invalid: ${artifact.id}`);
    safeLocator(artifact.sourceLocator);
    if (!SHA256.test(artifact.contentHash) || !SHA256.test(artifact.manifestHash) || !SHA512.test(artifact.integrity)) {
      throw new TypeError(`artifact integrity metadata is invalid: ${artifact.id}`);
    }
    if (new Set(artifact.dependencies).size !== artifact.dependencies.length) throw new TypeError(`duplicate dependency in artifact: ${artifact.id}`);
    artifactMap.set(artifact.id, artifact);
  }
  const closure = topologicalClosure(request.requestedPackageIds.map((id) => safeId(id, 'requested package ID')), artifactMap);
  const lockedById = new Map(request.lock.packages.map((entry) => [entry.id, entry]));
  if (lockedById.size !== request.lock.packages.length) throw new TypeError('canonical lock contains duplicate package IDs');
  if (closure.length !== request.lock.packages.length || closure.some((artifact) => !lockedById.has(artifact.id))) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'resolved package closure does not exactly match the canonical lock');
  }
  for (const artifact of closure) {
    const locked = lockedById.get(artifact.id)!;
    assertExactLockPackage(artifact, locked);
    if (artifact.lifecycleScripts.length > 0) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', `package lifecycle scripts are forbidden: ${artifact.id}`, {
        scripts: [...artifact.lifecycleScripts].sort(),
      });
    }
    if (artifact.trustTier === 'third-party') {
      if (!artifact.authoritySource || !artifact.publisher) {
        throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party artifact lacks source and publisher provenance binding: ' + artifact.id);
      }
      if (artifact.source === 'linked-development' && artifact.authoritySource !== 'explicit-dev') throw new DurableHostError('MOD_TRANSACTION_FAILED', 'linked third-party artifact must use explicit-dev authority: ' + artifact.id);
      if (artifact.source === 'registry' && artifact.authoritySource !== 'registry') throw new DurableHostError('MOD_TRANSACTION_FAILED', 'registry artifact authority source mismatch: ' + artifact.id);
      const authority = request.thirdPartyAuthority?.[artifact.id];
      if (!authority || authority.trustModel !== 'full-code' || authority.contentHash !== artifact.contentHash || authority.manifestHash !== artifact.manifestHash) {
        throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party artifact lacks exact S8 trust authority: ' + artifact.id);
      }
      if (!authority.trustRecordId.trim() || new Set(authority.grantRecordIds).size !== authority.grantRecordIds.length) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party trust/grant record IDs are malformed: ' + artifact.id);
      if (locked.trustRecordId !== authority.trustRecordId || [...locked.grantRecordIds].sort().join('\0') !== [...authority.grantRecordIds].sort().join('\0')) {
        throw new DurableHostError('MOD_TRANSACTION_FAILED', 'third-party authority does not match the canonical lock: ' + artifact.id);
      }
      await assertPersistedThirdPartyAuthority(host, artifact, locked, authority);
    }
    if (artifact.trustTier !== 'first-party' && artifact.trustTier !== 'third-party') throw new DurableHostError('MOD_TRANSACTION_FAILED', 'unknown trust tier: ' + artifact.id);
    if (artifact.provenance === 'failed') throw new DurableHostError('MOD_TRANSACTION_FAILED', `package provenance verification failed: ${artifact.id}`);
  }
  const pointer = await host.readCurrentPointer();
  const missing = closure.filter((artifact) => !artifact.available).map((artifact) => artifact.id).sort();
  if (request.networkPolicy === 'frozen-offline' && missing.length > 0) {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'frozen-offline cache is incomplete', { missing });
  }
  if (request.currentInvocation?.source === 'linked-development') {
    throw new DurableHostError('MOD_TRANSACTION_FAILED', 'linked development installations are never overwritten by the managed updater', {
      installationPrefix: request.currentInvocation.installationPrefix,
    });
  }
  const packages: ManagedLifecyclePackagePlan[] = closure.map((artifact) => freeze({
    id: artifact.id,
    version: artifact.version,
    source: artifact.source,
    sourceLocator: artifact.sourceLocator,
    ...(artifact.authoritySource ? { authoritySource: artifact.authoritySource } : {}),
    ...(artifact.publisher ? { publisher: artifact.publisher } : {}),
    integrity: artifact.integrity,
    contentHash: artifact.contentHash,
    manifestHash: artifact.manifestHash,
    dependencies: [...artifact.dependencies].sort(),
    provenance: artifact.provenance,
  }));
  const approvalReasons = closure.flatMap((entry) => [
    ...(entry.provenance === 'unavailable' ? [`provenance-unavailable:${entry.id}`] : []),
    ...(entry.source === 'linked-development' ? [`linked-source:${entry.id}`] : []),
    ...(entry.trustTier === 'third-party' ? [`full-code-trust:${entry.id}`] : []),
  ]).sort();
  const unsigned = freeze({
    schemaVersion: 1 as const,
    planId: sha256Canonical({ operation: request.operation, networkPolicy: request.networkPolicy, lock: request.lock, requestedPackageIds: [...request.requestedPackageIds].sort() }).slice(7, 39),
    operation: request.operation,
    networkPolicy: request.networkPolicy,
    kernelVersion: request.kernelVersion,
    apiVersion: request.apiVersion,
    baseGeneration: pointer?.generation ?? 0,
    basePointerHash: pointer ? sha256Canonical(pointer) : null,
    requestedPackageIds: [...request.requestedPackageIds].sort(),
    packages,
    missing,
    approvalReasons,
    desiredState: request.desiredState,
    lock: request.lock,
  });
  return freeze({ ...unsigned, planHash: planSubject(unsigned) });
}

interface LifecycleJournal {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly state: 'preparing' | 'verified' | 'committed' | 'failed';
  readonly planHash: `sha256:${string}`;
  readonly baseGeneration: number;
  readonly installationId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly fenceToken: string;
  readonly steps: readonly string[];
  readonly selectedGeneration: number | null;
}

async function listTree(io: HostIo, root: string, prefix = ''): Promise<string[]> {
  const entries = await io.readdir(join(root, prefix), { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listTree(io, root, child));
    else if (entry.isFile()) output.push(child);
    else throw new DurableHostError('MOD_TRANSACTION_FAILED', `candidate prefix contains unsupported entry: ${child}`);
  }
  return output.sort();
}

async function freezePrefix(io: HostIo, root: string): Promise<void> {
  const files = await listTree(io, root);
  for (const file of files) await io.chmod(join(root, file), 0o444);
  const directories = new Set<string>(['']);
  for (const file of files) {
    let current = dirname(file);
    while (current !== '.') { directories.add(current); current = dirname(current); }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) await io.chmod(join(root, directory), 0o555);
}

function relativeInstallationPath(hostRoot: string, installationPrefix: string): string {
  const value = relative(hostRoot, installationPrefix);
  if (!value || value.startsWith('..') || isAbsolute(value)) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'installation prefix escapes managed host');
  return value.split(String.fromCharCode(92)).join('/');
}

export class ManagedLifecycleService {
  readonly installationsRoot: string;
  readonly stagingRoot: string;
  readonly journalsRoot: string;
  readonly receiptsRoot: string;
  readonly #io: HostIo;
  readonly #now: () => Date;
  readonly #options: ManagedLifecycleOptions;

  constructor(readonly host: DurableModHost, options: ManagedLifecycleOptions = {}) {
    this.#io = options.io ?? nodeHostIo;
    this.#now = options.now ?? (() => new Date());
    this.#options = options;
    this.installationsRoot = join(host.root, 'installations');
    this.stagingRoot = join(host.root, 'installation-staging');
    this.journalsRoot = join(host.root, 'installation-transactions');
    this.receiptsRoot = join(host.root, 'installation-receipts');
  }

  async initialize(): Promise<void> {
    await this.host.initialize();
    for (const path of [this.installationsRoot, this.stagingRoot, this.journalsRoot, this.receiptsRoot]) {
      await this.#io.mkdir(path, { recursive: true, mode: 0o700 });
    }
  }

  async #fault(point: ManagedLifecycleFaultPoint): Promise<void> { await this.#options.fault?.(point); }

  async #writeJournal(journal: LifecycleJournal): Promise<void> {
    await atomicWrite(this.#io, join(this.journalsRoot, `${journal.transactionId}.json`), `${canonicalJson(journal)}\n`);
  }

  async #writeReceipt(receipt: ManagedLifecycleReceipt): Promise<void> {
    await writeNewImmutableFile(this.#io, join(this.receiptsRoot, `${receipt.transactionId}.${receipt.outcome}.json`), `${canonicalJson(receipt)}\n`);
  }

  async apply(plan: ManagedLifecyclePlan, installer: CandidateInstaller, verifier: CandidateVerifier, approval?: { readonly approvedPlanHash: string }): Promise<ManagedLifecycleApplyResult> {
    await this.initialize();
    const { planHash, ...unsignedPlan } = plan;
    if (planHash !== planSubject(unsignedPlan)) throw new TypeError('lifecycle plan hash mismatch');
    if (plan.approvalReasons.length > 0 && approval?.approvedPlanHash !== plan.planHash) {
      throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'lifecycle approval does not match the exact candidate plan', { approvalReasons: plan.approvalReasons });
    }
    if (plan.missing.length > 0) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'candidate plan has unavailable packages', { missing: plan.missing });
    const pointer = await this.host.readCurrentPointer();
    const actualPointerHash = pointer ? sha256Canonical(pointer) : null;
    if ((pointer?.generation ?? 0) !== plan.baseGeneration || actualPointerHash !== plan.basePointerHash) {
      throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'selected generation changed after lifecycle preview');
    }
    const transactionId = randomUUID();
    const installationId = safeInstallationId(plan.planHash);
    const staging = join(this.stagingRoot, transactionId);
    const destination = join(this.installationsRoot, installationId);
    const startedAt = this.#now().toISOString();
    const fence = await WriterFence.acquire(join(this.host.root, 'locks', 'lifecycle-writer.json'), this.#options.ownerId ?? 'agon.kernel.lifecycle', {
      ...this.#options.writerLock,
      io: this.#io,
      now: this.#now,
      processIdentity: this.#options.processIdentity ?? `lifecycle-${process.pid}`,
    });
    let promoted = false;
    let selectedGeneration: number | null = null;
    let journal: LifecycleJournal = freeze({
      schemaVersion: 1,
      transactionId,
      state: 'preparing',
      planHash: plan.planHash,
      baseGeneration: plan.baseGeneration,
      installationId,
      startedAt,
      updatedAt: startedAt,
      fenceToken: fence.record.fenceToken,
      steps: [],
      selectedGeneration: null,
    });
    const steps: Array<{ id: string; state: 'passed' | 'failed'; detail?: string }> = [];
    try {
      await this.#fault('after-lifecycle-lock');
      await this.#writeJournal(journal);
      await this.#fault('after-lifecycle-journal');
      if (await pathExists(this.#io, destination)) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'qualified installation already exists');
      await this.#io.mkdir(staging, { recursive: false, mode: 0o700 });
      await this.#fault('after-prefix-created');
      for (const packagePlan of plan.packages) {
        await installer.install(packagePlan, staging, { ignoreLifecycleScripts: true, networkPolicy: plan.networkPolicy });
      }
      steps.push({ id: 'stage-complete-closure', state: 'passed' });
      await this.#fault('after-packages-staged');
      const verification = freeze(await verifier.verify(staging, plan));
      if (!verification.passed || verification.checks.some((check) => !check.passed)) {
        throw new DurableHostError('MOD_TRANSACTION_FAILED', 'sacrificial candidate verification failed', {
          failedChecks: verification.checks.filter((check) => !check.passed).map((check) => check.id),
        });
      }
      steps.push({ id: 'sacrificial-verification', state: 'passed' });
      const qualifiedAt = this.#now().toISOString();
      const installation: ManagedInstallationRecord = freeze({
        schemaVersion: 1,
        installationId,
        planHash: plan.planHash,
        prefix: relativeInstallationPath(this.host.root, destination),
        kernelVersion: plan.kernelVersion,
        apiVersion: plan.apiVersion,
        packages: plan.packages,
        createdAt: startedAt,
        qualifiedAt,
        verification,
      });
      await this.#io.writeFile(join(staging, 'agon-installation.json'), `${canonicalJson(installation)}\n`, { flag: 'wx', mode: 0o600 });
      await this.#io.syncFile(join(staging, 'agon-installation.json'));
      await this.#io.syncDirectory(staging);
      await this.#fault('after-candidate-verified');
      await fence.assertOwned();
      await this.#io.rename(staging, destination);
      await freezePrefix(this.#io, destination);
      await this.#io.syncDirectory(this.installationsRoot);
      promoted = true;
      steps.push({ id: 'promote-immutable-prefix', state: 'passed' });
      await this.#fault('after-prefix-promoted');
      journal = freeze({ ...journal, state: 'verified', updatedAt: this.#now().toISOString(), steps: steps.map((step) => step.id) });
      await this.#writeJournal(journal);
      const result = await this.host.commitGeneration({
        operation: plan.operation === 'downgrade' ? 'update' : plan.operation,
        expectedBaseGeneration: plan.baseGeneration,
        lock: plan.lock,
        desiredState: plan.desiredState,
        installedIndex: {
          schemaVersion: 1,
          installationId,
          installationPrefix: installation.prefix,
          packages: plan.packages,
          planHash: plan.planHash,
        },
        files: { 'installation.json': `${canonicalJson(installation)}\n` },
      });
      selectedGeneration = result.pointer.generation;
      steps.push({ id: 'select-generation', state: 'passed' });
      await this.#fault('after-generation-selected');
      journal = freeze({ ...journal, state: 'committed', updatedAt: this.#now().toISOString(), steps: steps.map((step) => step.id), selectedGeneration });
      await this.#writeJournal(journal);
      const receipt: ManagedLifecycleReceipt = freeze({
        schemaVersion: 1,
        transactionId,
        operation: plan.operation,
        outcome: 'committed',
        planHash: plan.planHash,
        baseGeneration: plan.baseGeneration,
        selectedGeneration,
        installationId,
        startedAt,
        finishedAt: this.#now().toISOString(),
        steps: [...steps],
      });
      await this.#writeReceipt(receipt);
      await this.#fault('after-lifecycle-receipt');
      return freeze({ pointer: result.pointer, installation, receipt, restartRequired: true });
    } catch (error) {
      steps.push({ id: 'transaction', state: 'failed', detail: error instanceof Error ? error.message : String(error) });
      if (selectedGeneration === null) {
        await this.#io.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        if (promoted) {
          await makeTreeRemovable(this.#io, destination).catch(() => undefined);
          await this.#io.rm(destination, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      journal = freeze({ ...journal, state: 'failed', updatedAt: this.#now().toISOString(), steps: steps.map((step) => step.id), selectedGeneration });
      await this.#writeJournal(journal).catch(() => undefined);
      const receipt: ManagedLifecycleReceipt = freeze({
        schemaVersion: 1,
        transactionId,
        operation: plan.operation,
        outcome: 'failed',
        planHash: plan.planHash,
        baseGeneration: plan.baseGeneration,
        selectedGeneration,
        installationId: promoted ? installationId : null,
        startedAt,
        finishedAt: this.#now().toISOString(),
        steps: [...steps],
        error: error instanceof Error ? error.message : String(error),
      });
      await this.#writeReceipt(receipt).catch(() => undefined);
      if (error instanceof DurableHostError) throw error;
      throw new DurableHostError(selectedGeneration === null ? 'MOD_TRANSACTION_FAILED' : 'MOD_RESTART_REQUIRED', 'managed lifecycle transaction failed', {
        transactionId,
        selectedGeneration,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await fence.release().catch(() => undefined);
    }
  }

  async readSelectedInstallation(): Promise<ManagedInstallationRecord | null> {
    const pointer = await this.host.readCurrentPointer();
    if (!pointer) return null;
    await this.host.validateGeneration(pointer.generation);
    const record = await readJson<ManagedInstallationRecord>(this.#io, join(this.host.generationPath(pointer.generation), 'installation.json'));
    const prefix = resolve(this.host.root, record.prefix);
    if (relative(this.host.root, prefix).startsWith('..') || !await pathExists(this.#io, prefix)) {
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'selected installation prefix is missing or escapes the managed host');
    }
    const onDisk = await readJson<ManagedInstallationRecord>(this.#io, join(prefix, 'agon-installation.json'));
    if (canonicalJson(onDisk) !== canonicalJson(record)) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'selected installation record does not match its immutable prefix');
    return freeze(record);
  }

  async rollback(targetGeneration: number): Promise<{ readonly pointer: GenerationPointer; readonly installation: ManagedInstallationRecord }> {
    const targetRecord = await readJson<ManagedInstallationRecord>(this.#io, join(this.host.generationPath(targetGeneration), 'installation.json'));
    const prefix = resolve(this.host.root, targetRecord.prefix);
    if (relative(this.host.root, prefix).startsWith('..') || !await pathExists(this.#io, prefix)) {
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'rollback installation prefix is unavailable');
    }
    const qualified = await readJson<ManagedInstallationRecord>(this.#io, join(prefix, 'agon-installation.json'));
    if (canonicalJson(qualified) !== canonicalJson(targetRecord)) throw new DurableHostError('MOD_GENERATION_CORRUPT', 'rollback installation record is corrupt');
    const result = await rollbackGeneration(this.host, targetGeneration, { ownerId: this.#options.ownerId ?? 'agon.kernel.lifecycle.rollback' });
    return freeze({ pointer: result.pointer, installation: targetRecord });
  }
}

export async function installVerifiedDirectory(
  sourceDirectory: string,
  packagePlan: ManagedLifecyclePackagePlan,
  candidatePrefix: string,
  io: HostIo = nodeHostIo,
): Promise<void> {
  const source = resolve(sourceDirectory);
  const packageRoot = resolve(candidatePrefix, 'node_modules', packagePlan.id);
  if (relative(candidatePrefix, packageRoot).startsWith('..')) throw new TypeError('package destination escapes candidate prefix');
  const files = await listTree(io, source);
  const hash = createHash('sha256');
  for (const file of files) {
    const from = resolve(source, file);
    if (relative(source, from).startsWith('..')) throw new DurableHostError('MOD_TRANSACTION_FAILED', `package path escapes source: ${file}`);
    const bytes = await io.readFile(from);
    hash.update(file).update('\0').update(bytes).update('\0');
    const to = resolve(packageRoot, file);
    if (relative(packageRoot, to).startsWith('..')) throw new DurableHostError('MOD_TRANSACTION_FAILED', `package path escapes destination: ${file}`);
    await io.mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await io.writeFile(to, bytes, { flag: 'wx', mode: 0o600 });
  }
  const actual = `sha256:${hash.digest('hex')}`;
  if (actual !== packagePlan.contentHash) throw new DurableHostError('MOD_TRANSACTION_FAILED', `extracted tree hash mismatch: ${packagePlan.id}`, { expected: packagePlan.contentHash, actual });
}
