import { z } from 'zod';
import semver from 'semver';

const Semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Id = z.string().max(256).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/);
const Timestamp = z.string().datetime({ offset: true });
const Platform = z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
const Source = z.enum(['bundled', 'registry', 'user-folder', 'explicit-dev']);
const RelativePath = z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/);

const ContributionId = z.string().min(1).max(256).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const Contribution = z.object({ id: ContributionId, aliases: z.array(ContributionId).default([]) }).strict();
const Permission = z.object({ capability: z.string().min(1), resources: z.array(z.string()).default([]), required: z.boolean().default(true) }).strict();
const Dependency = z.object({ id: Id, range: z.string().min(1) }).strict();
const Asset = z.object({
  path: RelativePath, kind: z.enum(['static', 'native', 'schema', 'documentation']), mediaType: z.string().min(1),
  contentHash: Hash, bytes: z.number().int().nonnegative(), executable: z.boolean().default(false),
  platforms: z.array(Platform).min(1), consumerContributionId: ContributionId.optional(),
}).strict();

export const ManifestSchema = z.object({
  schemaVersion: z.literal(2), id: Id, name: z.string().min(1), version: Semver, apiRange: z.string().min(1),
  execution: z.enum(['executable', 'declarative']),
  compatibility: z.object({ kernelRange: z.string().min(1), nodeRange: z.string().min(1) }).strict(),
  packageClass: z.enum(['minimal-kernel-machinery', 'hidden-shared-support-package', 'user-toggleable-mod-package']),
  entrypoints: z.object({ runtime: RelativePath, types: RelativePath }).strict().optional(),
  display: z.object({ group: z.string().min(1), order: z.number().int(), parent: Id.optional() }).strict(),
  dependencies: z.object({ required: z.array(Dependency).default([]), optional: z.array(Dependency).default([]), conflicts: z.array(Id).default([]) }).strict(),
  permissions: z.array(Permission).default([]), platforms: z.array(Platform).min(1),
  assets: z.array(Asset).default([]),
  contributes: z.object({
    cliCommands: z.array(Contribution).default([]), tuiActions: z.array(Contribution).default([]), mcpTools: z.array(Contribution).default([]),
    cesarTools: z.array(Contribution).default([]), lifecycleHooks: z.array(Contribution).default([]), resultTypes: z.array(Contribution).default([]),
    configKeys: z.array(Contribution).default([]), generatedDocs: z.array(Contribution).default([]),
  }).strict(),
  pack: z.object({ include: z.array(RelativePath).min(1), executable: z.array(RelativePath).default([]) }).strict(),
}).strict();

/** Host-level manifest profile validation that supplements the portable JSON Schema shape. */
export function validateManifest(input) {
  const manifest = ManifestSchema.parse(input);
  if (manifest.execution === 'executable' && !manifest.entrypoints) throw new Error('executable manifest requires entrypoints');
  if (manifest.execution === 'declarative') {
    if (manifest.entrypoints) throw new Error('declarative manifest cannot declare entrypoints');
    if (manifest.permissions.length) throw new Error('declarative manifest cannot request permissions');
    const executableContributionKinds = ['cliCommands', 'tuiActions', 'mcpTools', 'cesarTools', 'lifecycleHooks', 'resultTypes'];
    if (executableContributionKinds.some((kind) => manifest.contributes[kind].length)) throw new Error('declarative manifest cannot register executable contributions');
    if (manifest.pack.executable.length || manifest.assets.some((asset) => asset.executable)) throw new Error('declarative manifest cannot contain executable artifacts');
  }
  if (!semver.validRange(manifest.apiRange) || !semver.validRange(manifest.compatibility.kernelRange) || !semver.validRange(manifest.compatibility.nodeRange)) {
    throw new Error('invalid compatibility range');
  }
  const dependencyIds = [...manifest.dependencies.required, ...manifest.dependencies.optional].map((dependency) => dependency.id);
  if (dependencyIds.includes(manifest.id)) throw new Error('manifest cannot depend on itself');
  if (new Set(dependencyIds).size !== dependencyIds.length) throw new Error('duplicate dependency id');
  if (manifest.dependencies.conflicts.some((id) => id === manifest.id || dependencyIds.includes(id))) throw new Error('dependency/conflict overlap');
  const assetPaths = manifest.assets.map((asset) => asset.path);
  if (new Set(assetPaths).size !== assetPaths.length) throw new Error('duplicate asset path');
  if (new Set(manifest.pack.include).size !== manifest.pack.include.length) throw new Error('duplicate pack path');
  if (new Set(manifest.pack.executable).size !== manifest.pack.executable.length) throw new Error('duplicate executable pack path');
  if (!manifest.pack.include.includes('agon.mod.json')) throw new Error('agon.mod.json missing from pack include');
  const requiredPackPaths = [...(manifest.entrypoints ? [manifest.entrypoints.runtime, manifest.entrypoints.types] : []), ...manifest.assets.map((asset) => asset.path), ...manifest.pack.executable];
  if (requiredPackPaths.some((path) => !manifest.pack.include.includes(path))) throw new Error('entrypoint, asset, or executable path missing from pack include');
  for (const [kind, contributions] of Object.entries(manifest.contributes)) {
    const names = contributions.flatMap((contribution) => [contribution.id, ...contribution.aliases]);
    if (new Set(names).size !== names.length) throw new Error(`duplicate ${kind} contribution or alias`);
  }
  const contributionIds = new Set(Object.values(manifest.contributes).flatMap((contributions) => contributions.map(({ id }) => id)));
  if (manifest.assets.some(({ consumerContributionId }) => consumerContributionId && !contributionIds.has(consumerContributionId))) {
    throw new Error('asset references unknown consumer contribution');
  }
  return manifest;
}

/** Canonical JSON reference used for deterministic lock/receipt fixtures. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function validateLock(input) {
  const lock = LockSchema.parse(input);
  const ids = lock.packages.map((pkg) => pkg.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate locked package id');
  lock.packages.forEach((pkg, index) => {
    if (pkg.resolutionOrder !== index) throw new Error('lock packages must be in contiguous resolution order');
    if ([...pkg.dependencies].sort().join('\0') !== pkg.dependencies.join('\0')) throw new Error('locked dependencies must be sorted');
  });
  return lock;
}

export const LockedPackageSchema = z.object({
  id: Id, version: Semver, source: Source, sourceLocator: z.string().min(1), contentHash: Hash, manifestHash: Hash,
  platform: Platform, enabled: z.boolean(), resolutionOrder: z.number().int().nonnegative(), dependencies: z.array(Id), trustRecordId: z.string().min(1), grantRecordIds: z.array(z.string().min(1)),
}).strict();
export const LockSchema = z.object({
  schemaVersion: z.literal(1), kernelVersion: Semver, apiVersion: Semver, desiredStateHash: Hash, graphHash: Hash,
  packages: z.array(LockedPackageSchema),
}).strict();

export const JournalSchema = z.object({
  schemaVersion: z.literal(1), transactionId: z.string().uuid(), operation: z.enum(['install', 'update', 'enable', 'disable', 'remove', 'import', 'profile-update', 'grant', 'revoke', 'trust', 'untrust', 'setup-action', 'rollback', 'purge', 'garbage-collect', 'kernel-switch']),
  state: z.enum(['preparing', 'verified', 'committed', 'rolled-back', 'failed']), startedAt: Timestamp, updatedAt: Timestamp,
  baseGeneration: z.number().int().nonnegative(), candidateGeneration: z.number().int().nonnegative(), fenceToken: z.string().uuid(),
  previousLockHash: Hash.nullable(), candidateLockHash: Hash.nullable(),
  steps: z.array(z.object({ id: z.string().min(1), state: z.enum(['pending', 'running', 'passed', 'failed', 'rolled-back']), receiptId: z.string().optional(), error: z.string().optional() }).strict()),
  rollback: z.object({ attempted: z.boolean(), completed: z.boolean(), receiptId: z.string().optional() }).strict(),
}).strict();

export const TrustRecordSchema = z.object({
  schemaVersion: z.literal(1), recordId: z.string().uuid(), modId: Id, version: Semver, source: Source, sourceLocator: z.string().min(1),
  contentHash: Hash, manifestHash: Hash, decision: z.enum(['trusted', 'rejected', 'revoked']), decidedAt: Timestamp,
  scope: z.enum(['exact-artifact', 'explicit-dev-path']),
  publisher: z.object({ registryOrigin: z.string().min(1), packageName: z.string().min(1), provenanceIdentity: z.string().min(1), provenanceStatus: z.enum(['verified', 'absent', 'invalid', 'not-applicable']) }).strict(),
  reason: z.string().min(1),
}).strict();

export const GrantRecordSchema = z.object({
  schemaVersion: z.literal(1), recordId: z.string().uuid(), modId: Id, contentHash: Hash, capability: z.string().min(1), resources: z.array(z.string()),
  decision: z.enum(['allow', 'ask', 'deny']), grantedAt: Timestamp, grantedBy: z.literal('local-user'), reason: z.string().min(1), revokedAt: Timestamp.optional(),
}).strict();

export const VerificationContractSchema = z.object({
  schemaVersion: z.literal(1), id: Id, version: Semver, owner: Id, platforms: z.array(Platform).min(1),
  checks: z.array(z.object({ id: z.string().min(1), authority: z.enum(['host', 'mod']), kind: z.enum(['command', 'schema', 'property', 'pack', 'manual']), command: z.array(z.string()).optional(), timeoutMs: z.number().int().positive(), maxOutputBytes: z.number().int().positive(), evidence: z.array(z.string()).min(1) }).strict()).min(1),
}).strict();

export const VerificationReceiptSchema = z.object({
  schemaVersion: z.literal(1), receiptId: z.string().uuid(), contractId: Id, contractVersion: Semver, contractHash: Hash, subjectHash: Hash,
  runner: z.object({ id: Id, version: Semver, contentHash: Hash }).strict(),
  platform: Platform, startedAt: Timestamp, finishedAt: Timestamp, status: z.enum(['passed', 'failed', 'blocked']),
  checks: z.array(z.object({ id: z.string().min(1), status: z.enum(['passed', 'failed', 'blocked']), exitCode: z.number().int().nullable(), durationMs: z.number().nonnegative(), evidenceHashes: z.array(Hash), note: z.string().optional() }).strict()),
}).strict();

const EnvelopeBase = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), createdAt: Timestamp, updatedAt: Timestamp, ownerModId: Id, ownerModVersion: Semver,
  ownerContentHash: Hash, kernelVersion: Semver, graphHash: Hash, contributionId: Id,
  sessionId: z.string().uuid(), traceId: z.string().uuid(), payloadVersion: Semver, payloadEncoding: z.literal('application/json'), receiptIds: z.array(z.string().uuid()), payload: z.unknown(),
}).strict();
export const PlanEnvelopeSchema = EnvelopeBase.extend({ kind: z.literal('plan'), status: z.enum(['draft', 'approved', 'running', 'paused', 'completed', 'failed', 'cancelled']) }).strict();
export const ResultEnvelopeSchema = EnvelopeBase.extend({ kind: z.literal('result'), status: z.enum(['succeeded', 'failed', 'cancelled', 'partial']) }).strict();
export const SessionEnvelopeSchema = EnvelopeBase.extend({ kind: z.literal('session'), status: z.enum(['active', 'closed', 'crashed']), childEnvelopeIds: z.array(z.string().uuid()) }).strict();
export const JobEnvelopeSchema = EnvelopeBase.extend({ kind: z.literal('job'), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']), leaseId: z.string().optional() }).strict();

export const CoverageLedgerSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: Timestamp,
  cells: z.array(z.object({ lifecycle: z.string().min(1), artifact: z.string().min(1), owner: z.string().min(1), normativeClause: z.string().min(1), evidenceId: z.string().min(1), platform: z.enum(['all', 'darwin', 'linux']), status: z.enum(['specified', 'tested', 'measured', 'blocked', 'deferred', 'not-applicable']) }).strict()),
}).strict();

export const schemas = {
  manifest: ManifestSchema, lock: LockSchema, journal: JournalSchema, trust: TrustRecordSchema, grant: GrantRecordSchema,
  'verification-contract': VerificationContractSchema, 'verification-receipt': VerificationReceiptSchema,
  'plan-envelope': PlanEnvelopeSchema, 'result-envelope': ResultEnvelopeSchema, 'session-envelope': SessionEnvelopeSchema,
  'job-envelope': JobEnvelopeSchema,
  'coverage-ledger': CoverageLedgerSchema,
};

export const SOURCE_PRECEDENCE = Object.freeze({ bundled: 0, registry: 1, 'user-folder': 2, 'explicit-dev': 3 });

/** Pure reference resolver: select by source precedence, reject equal-rank collisions, require an explicit closed desired set, and topologically sort with id tie-breaks. */
export function resolveCandidates(candidates, desiredIds, options = {}) {
  const groups = new Map();
  const rejected = [];
  for (const candidate of candidates) {
    validateManifest(candidate.manifest);
    if (candidate.manifest.id.startsWith('agon.')) {
      const permitted = candidate.source === 'bundled'
        || (candidate.source === 'registry' && candidate.publisherIdentity === 'kernlang:first-party-release-set' && candidate.provenanceVerified === true)
        || (candidate.source === 'explicit-dev' && candidate.explicitlySelected === true);
      if (!permitted) {
        rejected.push({ id: candidate.manifest.id, source: candidate.source, sourceLocator: candidate.sourceLocator, reason: 'reserved-first-party-id' });
        continue;
      }
    }
    const group = groups.get(candidate.manifest.id) ?? [];
    group.push(candidate);
    groups.set(candidate.manifest.id, group);
  }
  const candidateSets = new Map();
  const shadowed = [];
  for (const [id, group] of groups) {
    const ranked = [...group].sort((a, b) => SOURCE_PRECEDENCE[b.source] - SOURCE_PRECEDENCE[a.source] || a.sourceLocator.localeCompare(b.sourceLocator));
    const topRank = SOURCE_PRECEDENCE[ranked[0].source];
    const top = ranked.filter((candidate) => SOURCE_PRECEDENCE[candidate.source] === topRank);
    const byVersion = new Map();
    for (const candidate of top) {
      const versionGroup = byVersion.get(candidate.manifest.version) ?? [];
      versionGroup.push(candidate); byVersion.set(candidate.manifest.version, versionGroup);
    }
    for (const [version, versionGroup] of byVersion) if (versionGroup.length > 1) throw new Error(`same-precedence collision: ${id}@${version}`);
    const frozenVersion = options.frozenVersions?.[id];
    const currentVersion = options.currentVersions?.[id];
    const eligible = top.filter((candidate) => {
      if (candidate.yanked && frozenVersion !== candidate.manifest.version && options.allowYanked !== true) return false;
      if (semver.prerelease(candidate.manifest.version) && frozenVersion !== candidate.manifest.version && options.allowPrerelease !== true) return false;
      if (currentVersion && semver.lt(candidate.manifest.version, currentVersion) && frozenVersion !== candidate.manifest.version && options.allowDowngrade !== true) return false;
      return true;
    });
    eligible.sort((a, b) => {
      const aPre = semver.prerelease(a.manifest.version) ? 1 : 0; const bPre = semver.prerelease(b.manifest.version) ? 1 : 0;
      return aPre - bPre || semver.rcompare(a.manifest.version, b.manifest.version) || a.sourceLocator.localeCompare(b.sourceLocator);
    });
    if (!eligible.length) throw new Error(`no eligible version: ${id}`);
    candidateSets.set(id, eligible);
    shadowed.push(...ranked.filter((candidate) => !top.includes(candidate)).map((candidate) => ({ id, source: candidate.source, sourceLocator: candidate.sourceLocator })));
  }
  const desired = new Set(desiredIds);
  for (const id of desired) {
    if (!candidateSets.has(id)) throw new Error(`missing desired mod: ${id}`);
  }
  const ids = [...desired].sort(); const selected = new Map();
  function complete(index) {
    if (index === ids.length) {
      for (const id of ids) {
        const candidate = selected.get(id);
        for (const dep of candidate.manifest.dependencies.required) {
          if (!desired.has(dep.id)) throw new Error(`disabled dependency: ${id} requires ${dep.id}`);
          if (!semver.validRange(dep.range) || !semver.satisfies(selected.get(dep.id).manifest.version, dep.range)) return false;
        }
        for (const conflict of candidate.manifest.dependencies.conflicts) if (desired.has(conflict)) throw new Error(`conflict: ${id} conflicts with ${conflict}`);
      }
      return true;
    }
    const id = ids[index]; const frozenVersion = options.frozenVersions?.[id];
    for (const candidate of candidateSets.get(id)) {
      if (frozenVersion && candidate.manifest.version !== frozenVersion) continue;
      selected.set(id, candidate); if (complete(index + 1)) return true;
    }
    selected.delete(id); return false;
  }
  if (!complete(0)) throw new Error('unsatisfiable version ranges');
  const indegree = new Map([...desired].map((id) => [id, 0]));
  const outgoing = new Map([...desired].map((id) => [id, []]));
  for (const id of desired) for (const dep of selected.get(id).manifest.dependencies.required) { indegree.set(id, indegree.get(id) + 1); outgoing.get(dep.id).push(id); }
  const ready = [...desired].filter((id) => indegree.get(id) === 0).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift(); order.push(id);
    for (const child of outgoing.get(id).sort()) { indegree.set(child, indegree.get(child) - 1); if (indegree.get(child) === 0) { ready.push(child); ready.sort(); } }
  }
  if (order.length !== desired.size) throw new Error('dependency cycle');
  return {
    order, selected: order.map((id) => selected.get(id)),
    shadowed: shadowed.sort((a, b) => a.id.localeCompare(b.id) || a.sourceLocator.localeCompare(b.sourceLocator)),
    rejected: rejected.sort((a, b) => a.id.localeCompare(b.id) || a.sourceLocator.localeCompare(b.sourceLocator)),
  };
}
