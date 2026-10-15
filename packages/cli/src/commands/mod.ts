import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { defineCommand } from 'citty';
import {
  AGON_RUNTIME_VERSION,
  DurableModHost,
  FolderModManager,
  createFirstPartyActivationService,
  type ModActivationService,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
  parseDesiredState,
  renderModManagementText,
  recoverManagedLifecycle,
  ManagedRetentionInspector,
  previewManagedPurge,
  applyManagedPurge,
  type ManagedPurgePlan,
  parseArtifactLeaseIdentity,
  type ArtifactGenerationLease,
  type ArtifactLeaseIdentity,
  rollbackGeneration,
  sha256Canonical,
  type FolderModActivationPreview,
  type FolderModApprovalPreview,
  type FolderModCandidate,
  type FolderModGrantRevocationPreview,
  type GrantDecision,
  type TrustPublisher,
} from '@kernlang/agon-kernel';
import { modularHostRoot } from '../surface-authority-runtime.js';

const PLAN_LIMIT = 256 * 1024;
const WARNING = 'folder mod executable code receives full code trust; worker isolation is a termination boundary, not a sandbox' as const;

function paths(): { hostRoot: string; modsRoot: string; plansRoot: string } {
  const hostRoot = modularHostRoot();
  return { hostRoot, modsRoot: process.env.AGON_MODS_ROOT ?? join(dirname(hostRoot), 'mods'), plansRoot: join(hostRoot, 'pending-authority') };
}
function publisherFor(candidate: FolderModCandidate): TrustPublisher {
  return Object.freeze({ registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
    provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' });
}
function manager(): FolderModManager { return new FolderModManager({ ...paths(), publisherFor }); }

async function firstPartyActivationService(): Promise<ModActivationService> {
  const hostRoot = paths().hostRoot; const pointer = JSON.parse(await readFile(join(hostRoot, 'current-generation.json'), 'utf8')) as { generation?: unknown };
  if (!Number.isSafeInteger(pointer.generation) || Number(pointer.generation) < 1) throw new TypeError('first-party activation requires a valid selected generation; use agon mod recover first');
  const generationRoot = join(hostRoot, 'generations', String(pointer.generation).padStart(16, '0'));
  const generation = JSON.parse(await readFile(join(generationRoot, 'generation.json'), 'utf8')) as { kernelVersion?: unknown };
  if (typeof generation.kernelVersion !== 'string') throw new TypeError('selected generation manifest is malformed');
  return createFirstPartyActivationService(new DurableModHost(hostRoot, { kernelVersion: generation.kernelVersion }));
}

async function summary(selected: FolderModManager, candidate: FolderModCandidate) {
  const identity = { id: candidate.manifest.id, name: candidate.manifest.name, version: candidate.manifest.version,
    group: candidate.manifest.display.group, source: candidate.source, sourceLocator: candidate.sourceLocator,
    contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
  try {
    const [authority, enabled, grantRecords, failures] = await Promise.all([selected.evaluate(candidate), selected.isEnabled(candidate), selected.authority.store.readGrants(), selected.activation.readFailures()]);
    const activationFailure = failures.filter((failure) => failure.modId === candidate.manifest.id && failure.contentHash === candidate.contentHash)
      .sort((left, right) => right.sequence - left.sequence)[0];
    const permissionKey = (capability: string, resources: readonly string[]) => JSON.stringify([capability, [...resources].sort()]);
    const permissions = candidate.manifest.permissions.map((permission) => {
      const latest = grantRecords.filter((record) => record.modId === candidate.manifest.id && record.contentHash === candidate.contentHash
        && permissionKey(record.capability, record.resources) === permissionKey(permission.capability, permission.resources))
        .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt) || right.recordId.localeCompare(left.recordId))[0];
      return { capability: permission.capability, resources: permission.resources, required: permission.required,
        decision: latest?.revokedAt ? 'revoked' : latest?.decision ?? 'not-granted' };
    });
    return { ...identity, status: !authority.allowed || activationFailure ? 'blocked' : enabled ? 'enabled-on-next-start' : 'trusted-disabled',
      blockedReason: authority.reason ?? (activationFailure ? 'activation-failed' : null), activationFailure: activationFailure ?? null, missingCapabilities: authority.missingCapabilities, permissions,
      enabled, trustModel: 'full-code', authorityError: null };
  } catch (error) {
    return { ...identity, status: 'blocked', blockedReason: 'untrusted-source' as const,
      missingCapabilities: candidate.manifest.permissions.filter(({ required }) => required),
      permissions: candidate.manifest.permissions.map((permission) => ({ ...permission, decision: 'authority-state-invalid' })),
      enabled: false, trustModel: 'full-code', authorityError: String(error) };
  }
}

type ArtifactRetentionPreview = ({ readonly action: 'retain'; readonly generation: number; readonly generationContentHash: string; readonly artifact: ArtifactLeaseIdentity }
  | { readonly action: 'release'; readonly lease: ArtifactGenerationLease }) & { readonly requestId: string; readonly planHash: string };

type PendingPlan =
  | { readonly schemaVersion: 2; readonly kind: 'purge'; readonly preview: ManagedPurgePlan }
  | { readonly schemaVersion: 2; readonly kind: 'artifact-retention'; readonly preview: ArtifactRetentionPreview }
  | { readonly schemaVersion: 2; readonly kind: 'authority'; readonly modId: string; readonly contentHash: string; readonly manifestHash: string; readonly preview: FolderModApprovalPreview }
  | { readonly schemaVersion: 2; readonly kind: 'activation'; readonly modId: string; readonly contentHash: string; readonly manifestHash: string; readonly preview: FolderModActivationPreview }
  | { readonly schemaVersion: 2; readonly kind: 'grant-revocation'; readonly modId: string; readonly contentHash: string; readonly manifestHash: string; readonly preview: FolderModGrantRevocationPreview }
  | { readonly schemaVersion: 2; readonly kind: 'first-party-activation'; readonly modId: string; readonly contentHash: string; readonly manifestHash: string; readonly preview: { readonly enabled: boolean; readonly transaction: Awaited<ReturnType<ModActivationService['preview']>>; readonly planHash: string } }
  | { readonly schemaVersion: 2; readonly kind: 'generation-recovery'; readonly modId: 'agon.kernel'; readonly contentHash: string; readonly manifestHash: string; readonly preview: { readonly targetGeneration: number; readonly kernelVersion: string; readonly generationContentHash: string; readonly planHash: string } };

async function writePlan(document: PendingPlan, hash: string): Promise<string> {
  const { plansRoot } = paths();
  await mkdir(plansRoot, { recursive: true, mode: 0o700 });
  const path = join(plansRoot, `${hash.slice('sha256:'.length)}.json`);
  await writeFile(path, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return path;
}

async function readPlan(pathInput: string): Promise<PendingPlan> {
  const { plansRoot } = paths();
  const [root, candidate] = await Promise.all([realpath(plansRoot), realpath(pathInput)]);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new TypeError('approval plan must be inside the operator-owned pending-authority folder');
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > PLAN_LIMIT) throw new TypeError('approval plan must be a real JSON file no larger than 256 KiB');
  const value = JSON.parse(await readFile(candidate, 'utf8')) as PendingPlan;
  if (value.kind === 'purge') {
    if (value.schemaVersion !== 2 || !value.preview || value.preview.schemaVersion !== 2
      || !Array.isArray(value.preview.installationPaths) || !Array.isArray(value.preview.dataPaths)
      || value.preview.installationPaths.length + value.preview.dataPaths.length === 0
      || [...value.preview.installationPaths, ...value.preview.dataPaths].some(path => typeof path !== 'string' || !isAbsolute(path))) {
      throw new TypeError('purge approval plan is malformed');
    }
    return value;
  }
  if (value.kind === 'artifact-retention') {
    if (value.schemaVersion !== 2 || !value.preview || typeof value.preview.requestId !== 'string' || !value.preview.requestId) {
      throw new TypeError('artifact retention plan requires a request ID');
    }
    return value;
  }
  if (value.schemaVersion !== 2 || !['authority', 'activation', 'grant-revocation', 'first-party-activation', 'generation-recovery'].includes(value.kind) || typeof value.modId !== 'string'
    || typeof value.contentHash !== 'string' || typeof value.manifestHash !== 'string' || !value.preview) throw new TypeError('approval plan is malformed');
  return value;
}

function decisions(candidate: FolderModCandidate, allowInput: unknown, denyInput: unknown): Readonly<Record<string, GrantDecision>> {
  const allow = new Set(String(allowInput ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const deny = new Set(String(denyInput ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const declared = new Set(candidate.manifest.permissions.map(({ capability }) => capability));
  for (const capability of [...allow, ...deny]) if (!declared.has(capability)) throw new TypeError(`manifest does not request capability: ${capability}`);
  for (const capability of allow) if (deny.has(capability)) throw new TypeError(`capability cannot be both allowed and denied: ${capability}`);
  return Object.freeze(Object.fromEntries([...allow].map((capability) => [capability, 'allow']).concat([...deny].map((capability) => [capability, 'deny']))));
}

async function listOutput(selected: FolderModManager): Promise<any> {
  const discovery = await selected.discover();
  const catalog = createFirstPartyModCatalog();
  let desired = createFullCompatDesiredState(catalog, new Date().toISOString());
  const host = new DurableModHost(paths().hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
  const pointer = await host.readCurrentPointer();
  if (pointer) desired = parseDesiredState(await host.readGenerationDesiredState(pointer));
  else {
    const orphan = await lstat(host.paths.desiredState).then(() => true, error => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
    if (orphan) throw new Error('modular desired state exists without a canonical generation pointer');
  }
  const mods = await Promise.all(discovery.candidates.map((candidate) => summary(selected, candidate)));
  const externalMods = mods.map((mod) => ({
    id: mod.id, packageId: mod.id, label: mod.name, source: mod.source, enabled: mod.enabled,
    trustSummary: mod.blockedReason && mod.blockedReason !== "permission-not-granted" ? "Full-code trust not granted for this exact identity" : "Full-code trust granted for this exact identity",
    permissionSummary: mod.permissions.length
      ? mod.permissions.map(({ capability, resources, required, decision }) => `${capability} (${resources.join(", ")}): ${decision}${required ? " [required]" : " [optional]"}`).join("; ")
      : "No permissions requested",
    ...(mod.authorityError ? { reason: {
      code: "authority-state-invalid" as const,
      message: "Authority state is unreadable; external execution is blocked.",
      recovery: "Run agon doctor mods, then restore or remove the malformed authority record before retrying.",
    } } : mod.blockedReason ? { reason: {
      code: mod.blockedReason === "permission-not-granted" ? "permission-not-granted" as const : mod.blockedReason === "activation-failed" ? "activation-failed" as const : "untrusted-source" as const,
      message: mod.blockedReason === "permission-not-granted"
        ? "One or more permissions requested by this exact package are not granted."
        : mod.blockedReason === "activation-failed" ? `The last activation failed: ${mod.activationFailure?.message ?? "unknown failure"}`
        : "This exact package identity, source, publisher, and content hash are not trusted.",
      recovery: mod.blockedReason === "permission-not-granted"
        ? "Review and approve the missing grants with agon mod trust " + mod.id + "."
        : mod.blockedReason === "activation-failed" ? "Inspect the durable failure with agon doctor mods, fix or disable the mod, then restart."
        : "Inspect the package, then preview and approve trust with agon mod trust " + mod.id + ".",
    } } : {}),
  }));
  const view = createModManagementView(catalog, desired, { externalMods });
  return { modsRoot: paths().modsRoot, mods, diagnostics: discovery.diagnostics, view, text: renderModManagementText(view) };
}

export async function loadModManagementView() { return (await listOutput(manager())).view; }

const listCommand = defineCommand({ meta: { name: 'list', description: 'List valid folder mods, inert/active state, and isolated diagnostics' },
  async run() { console.log(JSON.stringify(await listOutput(manager()), null, 2)); } });
const inspectCommand = defineCommand({ meta: { name: 'inspect', description: 'Inspect one folder mod without executing it' },
  args: { id: { type: 'positional', required: true } }, async run({ args }) {
    const selected = manager(); const candidate = (await selected.inspect(String(args.id)))[0]!;
    console.log(JSON.stringify({ ...await summary(selected, candidate), manifest: candidate.manifest }, null, 2));
  } });

const trustCommand = defineCommand({
  meta: { name: 'trust', description: 'Preview exact artifact trust and explicit per-capability decisions; does not enable code' },
  args: { id: { type: 'positional', required: true }, allow: { type: 'string', description: 'Comma-separated capabilities to allow' },
    deny: { type: 'string', description: 'Comma-separated capabilities to deny' }, reason: { type: 'string', default: 'approved through agon mod' } },
  async run({ args }) {
    const selected = manager(); const candidate = (await selected.inspect(String(args.id)))[0]!;
    const preview = selected.previewApproval(candidate, String(args.reason), decisions(candidate, args.allow, args.deny));
    const hashes = [preview.trust.planHash, ...preview.grants.map(({ planHash }) => planHash)];
    const planPath = await writePlan({ schemaVersion: 2, kind: 'authority', modId: candidate.manifest.id,
      contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, preview }, preview.trust.planHash);
    console.log(JSON.stringify({ warning: WARNING, planPath, planHashes: hashes,
      requestedPermissions: candidate.manifest.permissions, candidate: await summary(selected, candidate),
      next: `agon mod approve ${JSON.stringify(planPath)} --approve ${JSON.stringify(hashes.join(','))}` }, null, 2));
  },
});

const untrustCommand = defineCommand({
  meta: { name: 'untrust', description: 'Preview revocation of trust for one exact artifact; does not delete it' },
  args: { id: { type: 'positional', required: true }, reason: { type: 'string', default: 'revoked through agon mod' } },
  async run({ args }) {
    const selected = manager(); const candidate = (await selected.inspect(String(args.id)))[0]!;
    const preview = selected.previewRevocation(candidate, String(args.reason));
    const planPath = await writePlan({ schemaVersion: 2, kind: 'authority', modId: candidate.manifest.id,
      contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, preview }, preview.trust.planHash);
    console.log(JSON.stringify({ warning: WARNING, action: 'untrust-preview', planPath, planHashes: [preview.trust.planHash],
      next: `agon mod approve ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.trust.planHash)}` }, null, 2));
  },
});

const approveCommand = defineCommand({ meta: { name: 'approve', description: 'Apply an exact trust/grant plan without enabling the mod' },
  args: { plan: { type: 'positional', required: true }, approve: { type: 'string', required: true } }, async run({ args }) {
    const document = await readPlan(String(args.plan));
    if (document.kind !== 'authority') throw new TypeError('approve requires an authority plan');
    const selected = manager(); const candidate = (await selected.inspect(document.modId))[0]!;
    if (candidate.contentHash !== document.contentHash || candidate.manifestHash !== document.manifestHash) throw new TypeError('folder mod changed after authority preview');
    const preview = Object.freeze({ ...document.preview, candidate });
    const hashes = String(args.approve).split(',').map((value) => value.trim()).filter(Boolean);
    const result = await selected.approve(preview, hashes);
    const trustDecision = 'decision' in preview.trust.record ? preview.trust.record.decision : 'applied';
    console.log(JSON.stringify({ authorityDecision: trustDecision, modId: candidate.manifest.id, enabled: false, restartRequired: false,
      trustRecordId: result.trust.recordId, grantRecordIds: result.grants.map(({ recordId }) => recordId), warning: WARNING }, null, 2));
  } });

const revokeCommand = defineCommand({
  meta: { name: 'revoke', description: 'Preview or apply denial of one exact capability and resource set' },
  args: { target: { type: 'positional', required: true }, capability: { type: 'string' }, resources: { type: 'string' },
    approve: { type: 'string' }, reason: { type: 'string', default: 'grant revoked through agon mod' } },
  async run({ args }) {
    const selected = manager();
    if (!args.approve) {
      if (!args.capability) throw new TypeError('revoke preview requires --capability');
      const candidate = (await selected.inspect(String(args.target)))[0]!;
      const resources = String(args.resources ?? '').split(',').map((value) => value.trim()).filter(Boolean).sort();
      const preview = selected.previewGrantRevocation(candidate, String(args.capability), resources, String(args.reason));
      const planPath = await writePlan({ schemaVersion: 2, kind: 'grant-revocation', modId: candidate.manifest.id,
        contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, preview }, preview.grant.planHash);
      console.log(JSON.stringify({ action: 'grant-revocation-preview', modId: candidate.manifest.id, capability: args.capability,
        resources, planPath, planHash: preview.grant.planHash,
        next: `agon mod revoke ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.grant.planHash)}` }, null, 2));
      return;
    }
    const document = await readPlan(String(args.target));
    if (document.kind !== 'grant-revocation') throw new TypeError('revoke approval requires a grant-revocation plan');
    const candidate = (await selected.inspect(document.modId))[0]!;
    if (candidate.contentHash !== document.contentHash || candidate.manifestHash !== document.manifestHash) throw new TypeError('folder mod changed after grant revocation preview');
    const record = await selected.applyGrantRevocation(Object.freeze({ ...document.preview, candidate }), String(args.approve));
    console.log(JSON.stringify({ revokedGrant: record.recordId, modId: candidate.manifest.id, restartRequired: true }, null, 2));
  },
});

function activationCommand(enabled: boolean) {
  return defineCommand({ meta: { name: enabled ? 'enable' : 'disable', description: `${enabled ? 'Enable' : 'Disable'} an already inspected artifact through an exact activation plan` },
    args: { target: { type: 'positional', required: true }, approve: { type: 'string' }, reason: { type: 'string', default: `${enabled ? 'enabled' : 'disabled'} through agon mod` } },
    async run({ args }) {
      const target = String(args.target);
      if (!args.approve && target.startsWith('agon.')) {
        const service = await firstPartyActivationService(); const transaction = await service.preview({ kind: enabled ? 'enable' : 'disable', id: target });
        const unsigned = { enabled, transaction }; const preview = { ...unsigned, planHash: sha256Canonical(unsigned) };
        const planPath = await writePlan({ schemaVersion: 2, kind: 'first-party-activation', modId: target, contentHash: preview.planHash, manifestHash: preview.planHash, preview }, preview.planHash);
        console.log(JSON.stringify({ action: enabled ? 'enable-first-party-preview' : 'disable-first-party-preview', modId: target, planPath, planHash: preview.planHash, changes: transaction.desired, restartRequiredAfterApply: true, next: `agon mod ${enabled ? 'enable' : 'disable'} ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.planHash)}` }, null, 2)); return;
      }
      if (args.approve) {
        const possible = await readPlan(target);
        if (possible.kind === 'first-party-activation') {
          const { planHash, ...unsigned } = possible.preview;
          if (possible.preview.enabled !== enabled || planHash !== sha256Canonical(unsigned) || String(args.approve) !== planHash) throw new TypeError('first-party activation approval does not match the exact plan');
          const result = await (await firstPartyActivationService()).apply(possible.preview.transaction);
          console.log(JSON.stringify({ [enabled ? 'enabled' : 'disabled']: possible.modId, generation: result.pointer.generation, restartRequired: true }, null, 2)); return;
        }
      }
      const selected = manager();
      if (!args.approve) {
        const candidate = (await selected.inspect(target))[0]!;
        if (enabled && !(await selected.evaluate(candidate)).allowed) throw new TypeError('artifact must be trusted and all required permissions granted before enablement');
        const preview = selected.previewActivation(candidate, enabled, String(args.reason));
        const planPath = await writePlan({ schemaVersion: 2, kind: 'activation', modId: candidate.manifest.id,
          contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, preview }, preview.activation.planHash);
        console.log(JSON.stringify({ action: enabled ? 'enable-preview' : 'disable-preview', modId: candidate.manifest.id,
          planPath, planHash: preview.activation.planHash, restartRequiredAfterApply: true,
          next: `agon mod ${enabled ? 'enable' : 'disable'} ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.activation.planHash)}` }, null, 2));
        return;
      }
      const document = await readPlan(String(args.target));
      if (document.kind !== 'activation' || document.preview.activation.record.enabled !== enabled) throw new TypeError(`expected an ${enabled ? 'enable' : 'disable'} activation plan`);
      const candidate = (await selected.inspect(document.modId))[0]!;
      if (candidate.contentHash !== document.contentHash || candidate.manifestHash !== document.manifestHash) throw new TypeError('folder mod changed after activation preview');
      if (enabled && !(await selected.evaluate(candidate)).allowed) throw new TypeError('artifact authority was revoked or became incomplete before enablement');
      const record = await selected.applyActivation(Object.freeze({ ...document.preview, candidate }), String(args.approve));
      console.log(JSON.stringify({ [enabled ? 'enabled' : 'disabled']: candidate.manifest.id, activationRecordId: record.recordId, restartRequired: true }, null, 2));
    },
  });
}

const recoverCommand = defineCommand({ meta: { name: 'recover', description: 'Recover interrupted transactions, or preview and approve an exact verified generation' },
  args: { target: { type: 'positional', required: true, description: 'transactions to replay interrupted work; generation number to preview recovery; plan path with --approve' }, approve: { type: 'string' } }, async run({ args }) {
    const hostRoot = paths().hostRoot;
    if (args.target === 'transactions') {
      if (args.approve !== undefined) throw new TypeError('transaction recovery does not accept a generation approval');
      const host = new DurableModHost(hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
      const result = await recoverManagedLifecycle(host);
      console.log(JSON.stringify({ action: 'transaction-recovery', ...result, restartRequired: true }, null, 2));
      return;
    }
    if (!args.approve) {
      const targetGeneration = Number(args.target);
      if (!Number.isSafeInteger(targetGeneration) || targetGeneration < 1) throw new TypeError('recovery target must be a positive generation number');
      const generationPath = join(hostRoot, 'generations', String(targetGeneration).padStart(16, '0'), 'generation.json');
      const manifest = JSON.parse(await readFile(generationPath, 'utf8')) as { kernelVersion?: unknown; contentHash?: unknown };
      if (typeof manifest.kernelVersion !== 'string' || typeof manifest.contentHash !== 'string') throw new TypeError('recovery generation manifest is malformed');
      const unsigned = { targetGeneration, kernelVersion: manifest.kernelVersion, generationContentHash: manifest.contentHash };
      const preview = { ...unsigned, planHash: sha256Canonical(unsigned) };
      const planPath = await writePlan({ schemaVersion: 2, kind: 'generation-recovery', modId: 'agon.kernel', contentHash: preview.generationContentHash, manifestHash: preview.generationContentHash, preview }, preview.planHash);
      console.log(JSON.stringify({ action: 'generation-recovery-preview', warning: 'This atomically selects a previously verified generation without importing any mod.', planPath, ...preview, next: `agon mod recover ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.planHash)}` }, null, 2)); return;
    }
    const document = await readPlan(String(args.target)); if (document.kind !== 'generation-recovery') throw new TypeError('recover approval requires a generation-recovery plan');
    const { planHash, ...unsigned } = document.preview;
    if (planHash !== sha256Canonical(unsigned) || String(args.approve) !== planHash) throw new TypeError('generation recovery approval does not match the exact plan');
    const host = new DurableModHost(hostRoot, { kernelVersion: document.preview.kernelVersion });
    const manifest = await host.validateGeneration(document.preview.targetGeneration);
    if (manifest.contentHash !== document.preview.generationContentHash) throw new TypeError('recovery generation changed after preview');
    const result = await rollbackGeneration(host, document.preview.targetGeneration, { allowInvalidCurrent: true, ownerId: 'agon.kernel.safe-recovery' });
    console.log(JSON.stringify({ recoveredGeneration: result.pointer.generation, restartRequired: true }, null, 2));
  } });

export async function runTuiModAction(input: string): Promise<string> {
  const [action = 'list', id] = input.trim().split(/\s+/).filter(Boolean);
  const selected = manager();
  if (action === 'list') return JSON.stringify(await listOutput(selected), null, 2);
  if (action === 'inspect' && id) { const candidate = (await selected.inspect(id))[0]!; return JSON.stringify({ ...await summary(selected, candidate), manifest: candidate.manifest }, null, 2); }
  return 'Use: /mod list | /mod inspect <id>. Trust, grant, enable, and disable require the reviewable two-step `agon mod` CLI flow.';
}

function artifactRetentionCommand(action: 'retain' | 'release') {
  return defineCommand({ meta: { name: action, description: `${action === 'retain' ? 'Retain a generation for an artifact' : 'Release an artifact reference'} through exact preview approval; deletes no files` },
    args: {
      target: { type: 'positional', required: true, description: action === 'retain' ? 'Generation number, or approval plan path' : 'Artifact lease ID, or approval plan path' },
      owner: { type: 'string', description: 'Artifact owner ID for retain preview' },
      artifact: { type: 'string', description: 'Opaque artifact ID for retain preview; never opened as a path' },
      hash: { type: 'string', description: 'Declared artifact SHA-256 hash for retain preview' },
      approve: { type: 'string', description: 'Exact preview plan hash' },
    },
    async run({ args }) {
      const host = new DurableModHost(paths().hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
      if (!args.approve) {
        const requestId = randomUUID();
        let unsigned: Omit<Extract<ArtifactRetentionPreview, { action: 'retain' }>, 'planHash'> | Omit<Extract<ArtifactRetentionPreview, { action: 'release' }>, 'planHash'>;
        if (action === 'retain') {
          const generation = Number(args.target);
          if (!Number.isSafeInteger(generation) || generation < 1) throw new TypeError('retention target must be a positive generation number');
          const artifact = parseArtifactLeaseIdentity({ ownerId: args.owner ?? '', artifactId: args.artifact ?? '', artifactHash: args.hash ?? '' });
          const manifest = await host.validateGeneration(generation);
          unsigned = { action, generation, generationContentHash: manifest.contentHash, artifact, requestId };
        } else {
          if (args.owner || args.artifact || args.hash) throw new TypeError('release uses the exact stored artifact identity, not replacement flags');
          unsigned = { action, lease: await host.readArtifactGenerationLease(String(args.target)), requestId };
        }
        const preview = { ...unsigned, planHash: sha256Canonical(unsigned) };
        const planPath = await writePlan({ schemaVersion: 2, kind: 'artifact-retention', preview }, preview.planHash);
        console.log(JSON.stringify({ ...preview, action: `artifact-${action}-preview`, planPath,
          warning: action === 'retain' ? 'Artifact identity is declared, not independently verified. No artifact file is read.' : 'This releases retention protection only. No artifact, installation or generation is deleted.',
          next: `agon mod retention ${action} ${JSON.stringify(planPath)} --approve ${JSON.stringify(preview.planHash)}` }, null, 2));
        return;
      }
      if (args.owner || args.artifact || args.hash) throw new TypeError('approval uses the exact saved preview, not replacement flags');
      const document = await readPlan(String(args.target));
      if (document.kind !== 'artifact-retention') throw new TypeError('artifact retention approval requires an artifact-retention plan');
      const { planHash, ...preview } = document.preview;
      if (preview.action !== action || planHash !== sha256Canonical(preview) || String(args.approve) !== planHash) {
        throw new TypeError('artifact retention approval does not match the exact plan');
      }
      let lease: ArtifactGenerationLease;
      if (preview.action === 'retain') {
        const manifest = await host.validateGeneration(preview.generation);
        if (manifest.contentHash !== preview.generationContentHash) throw new TypeError('retained generation changed after preview');
        lease = await host.leaseArtifactGeneration(preview.generation, preview.artifact, undefined, preview.requestId);
      } else {
        const current = await host.readArtifactGenerationLease(preview.lease.leaseId);
        if (sha256Canonical({ ...current, releasedAt: preview.lease.releasedAt }) !== sha256Canonical(preview.lease)
          || (preview.lease.releasedAt !== null && current.releasedAt !== preview.lease.releasedAt)) {
          throw new TypeError('artifact lease changed after preview');
        }
        lease = await host.releaseArtifactGenerationLease(current.leaseId,
          { ownerId: current.ownerId, artifactId: current.artifactId, artifactHash: current.artifactHash });
      }
      console.log(JSON.stringify({ action: `artifact-${action}`, planHash, lease,
        status: lease.releasedAt ? 'released' : 'retained', deletedFiles: false }, null, 2));
    } });
}

async function printRetentionReport(duration?: unknown): Promise<void> {
  if (duration !== undefined && (typeof duration !== 'string' || !/^\d+$/.test(duration))) throw new TypeError('rollback window must be a non-negative integer in milliseconds');
  const host = new DurableModHost(paths().hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
  console.log(JSON.stringify(await new ManagedRetentionInspector(host,
    duration === undefined ? undefined : { durationMs: Number(duration) }).inspect(), null, 2));
}

const retentionCommand = defineCommand({ meta: { name: 'retention', description: 'Inspect retained references, sizes and leases; manage artifact protection without deleting files' },
  subCommands: {
    retain: artifactRetentionCommand('retain'), release: artifactRetentionCommand('release'),
    inspect: defineCommand({
      args: { 'rollback-window-ms': { type: 'string', description: 'Inspect rollback protection for this explicit duration; does not authorize deletion' } },
      async run({ args }) { await printRetentionReport(args['rollback-window-ms']); },
    }),
  },
  async run({ rawArgs }) {
    if (rawArgs.some(arg => !arg.startsWith('-'))) return;
    await printRetentionReport();
  } });

const purgeCommand = defineCommand({ meta: { name: 'purge', description: 'Preview irreversible removal; apply only an exactly approved saved plan' },
  args: {
    plan: { type: 'positional', required: false, description: 'Saved preview path, required with --approve' },
    installation: { type: 'string', description: 'Exact installation ID to preview; repeat for multiple IDs' },
    data: { type: 'string', description: 'Absolute managed data path to preview; repeat for multiple paths' },
    approve: { type: 'string', description: 'Exact saved preview hash; removal is irreversible' },
  },
  async run({ args }) {
    const host = new DurableModHost(paths().hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
    const warning = 'Removal is irreversible. Purge quarantine is not a backup.';
    if (args.plan !== undefined || args.approve !== undefined) {
      if (!args.plan || !args.approve) throw new TypeError('purge requires both a saved plan and --approve with its exact hash');
      if (args.installation !== undefined || args.data !== undefined) throw new TypeError('purge approval uses the saved preview, not replacement flags');
      const document = await readPlan(String(args.plan));
      if (document.kind !== 'purge') throw new TypeError('purge approval requires a purge plan');
      const deletedPaths = await applyManagedPurge(host, document.preview, String(args.approve));
      console.log(JSON.stringify({ action: 'purge', planHash: document.preview.planHash, deletedPaths, warning }, null, 2));
      return;
    }
    const targets = (value: unknown): string[] => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
      if (values.some(item => typeof item !== 'string' || !item.trim())) throw new TypeError('purge targets must be non-empty strings');
      return values as string[];
    };
    const installationIds = targets(args.installation);
    const dataPaths = targets(args.data);
    if (!installationIds.length && !dataPaths.length) throw new TypeError('purge preview requires --installation or --data; no automatic targets are selected');
    if (dataPaths.some(path => !isAbsolute(path))) throw new TypeError('purge data paths must be absolute');
    const preview = await previewManagedPurge(host, { installationIds, dataPaths });
    const planPath = await writePlan({ schemaVersion: 2, kind: 'purge', preview }, preview.planHash);
    console.log(JSON.stringify({ ...preview, action: 'purge-preview', planPath, warning,
      next: `agon mod purge '${planPath.replace(/'/g, "'\\''")}' --approve ${preview.planHash}` }, null, 2));
  } });

export const modCommand: any = defineCommand({ meta: { name: 'mod', description: 'Inspect, trust, grant, and activate modular Agon packages' },
  subCommands: { list: listCommand, inspect: inspectCommand, trust: trustCommand, untrust: untrustCommand, approve: approveCommand, revoke: revokeCommand,
    enable: activationCommand(true), disable: activationCommand(false), recover: recoverCommand, retention: retentionCommand, purge: purgeCommand } });
