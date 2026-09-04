import type { ModServices } from '@kernlang/agon-mod-api';
import type { FirstPartySurfacePackage } from './activated-surface-generation.js';
import { ExternalActivationStore, type ExternalActivationPlan, type ExternalActivationRecord } from './external-activation-state.js';
import { resolveExternalFolderMods } from './external-resolution.js';
import { discoverUserFolderModsDetailed, type FolderModDiscoveryResult } from './folder-mod-diagnostics.js';
import type { FolderModCandidate } from './folder-mods.js';
import { sha256Canonical } from './lock.js';
import type { ModRegistry } from './registry.js';
import { AGON_RUNTIME_VERSION } from './runtime-version.js';
import { activateTrustedFolderMod, type ThirdPartyActivationResult } from './third-party-activation.js';
import { TransactionalTrustGrantService, type AuthorityTransactionReceipt } from './transactional-authority.js';
import { evaluateThirdPartyAuthority, type AuthorityEvaluation, type AuthorityMutationPlan, type GrantDecision, type TrustPublisher } from './trust-authority.js';

export interface FolderModApprovalPreview {
  readonly candidate: FolderModCandidate;
  readonly trust: AuthorityMutationPlan;
  readonly grants: readonly AuthorityMutationPlan[];
  readonly warning: 'folder mod executable code receives full code trust; worker isolation is a termination boundary, not a sandbox';
}

export interface FolderModApprovalResult {
  readonly trust: AuthorityTransactionReceipt;
  readonly grants: readonly AuthorityTransactionReceipt[];
}

export interface FolderModGrantRevocationPreview {
  readonly candidate: FolderModCandidate;
  readonly grant: AuthorityMutationPlan;
  readonly warning: 'revocation affects new invocations immediately; restart long-lived hosts';
}

export interface FolderModActivationPreview {
  readonly candidate: FolderModCandidate;
  readonly activation: ExternalActivationPlan;
  readonly restartRequiredAfterApply: true;
}

export interface FolderModManagerOptions {
  readonly modsRoot: string;
  readonly hostRoot: string;
  readonly registry?: ModRegistry;
  readonly services?: ModServices;
  readonly publisherFor: (candidate: FolderModCandidate) => TrustPublisher;
  readonly hostPackages?: readonly FirstPartySurfacePackage[];
  readonly kernelVersion?: string;
}

function activationIdentity(candidate: FolderModCandidate, publisher: TrustPublisher) {
  return Object.freeze({
    modId: candidate.manifest.id,
    version: candidate.manifest.version,
    source: candidate.source,
    sourceLocator: candidate.sourceLocator,
    contentHash: candidate.contentHash,
    manifestHash: candidate.manifestHash,
    publisherHash: sha256Canonical(publisher),
  });
}

export class FolderModManager {
  readonly authority: TransactionalTrustGrantService;
  readonly activation: ExternalActivationStore;

  constructor(readonly options: FolderModManagerOptions) {
    this.authority = new TransactionalTrustGrantService(options.hostRoot);
    this.activation = new ExternalActivationStore(options.hostRoot);
  }

  async discover(): Promise<FolderModDiscoveryResult> {
    return discoverUserFolderModsDetailed(this.options.modsRoot);
  }

  async inspect(id?: string): Promise<readonly FolderModCandidate[]> {
    const candidates = (await this.discover()).candidates;
    if (!id) return candidates;
    const matches = candidates.filter(({ manifest }) => manifest.id === id);
    if (matches.length !== 1) throw new TypeError(matches.length ? `ambiguous folder mod: ${id}` : `folder mod not found: ${id}`);
    return Object.freeze(matches);
  }

  async evaluate(candidate: FolderModCandidate): Promise<AuthorityEvaluation> {
    return evaluateThirdPartyAuthority({
      modId: candidate.manifest.id,
      version: candidate.manifest.version,
      source: candidate.source,
      sourceLocator: candidate.sourceLocator,
      contentHash: candidate.contentHash,
      manifestHash: candidate.manifestHash,
      publisher: this.options.publisherFor(candidate),
    }, candidate.manifest, await this.authority.store.readTrust(), await this.authority.store.readGrants());
  }

  previewApproval(candidate: FolderModCandidate, reason: string, decisions: Readonly<Record<string, GrantDecision>> = {}, now = new Date().toISOString()): FolderModApprovalPreview {
    const publisher = this.options.publisherFor(candidate);
    const trust = this.authority.store.previewTrust({
      modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      decision: 'trusted', decidedAt: now, scope: candidate.source === 'explicit-dev' ? 'explicit-dev-path' : 'exact-artifact',
      publisher, reason,
    });
    const grants = candidate.manifest.permissions.filter((permission) => decisions[permission.capability] !== undefined).map((permission) => this.authority.store.previewGrant({
      modId: candidate.manifest.id, contentHash: candidate.contentHash, capability: permission.capability,
      resources: permission.resources, decision: decisions[permission.capability]!, grantedAt: now, grantedBy: 'local-user', reason,
    }));
    return Object.freeze({ candidate, trust, grants: Object.freeze(grants), warning: 'folder mod executable code receives full code trust; worker isolation is a termination boundary, not a sandbox' as const });
  }

  previewRevocation(candidate: FolderModCandidate, reason: string, now = new Date().toISOString()): FolderModApprovalPreview {
    const trust = this.authority.store.previewTrust({
      modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      decision: 'revoked', decidedAt: now, scope: candidate.source === 'explicit-dev' ? 'explicit-dev-path' : 'exact-artifact',
      publisher: this.options.publisherFor(candidate), reason,
    });
    return Object.freeze({ candidate, trust, grants: Object.freeze([]), warning: 'folder mod executable code receives full code trust; worker isolation is a termination boundary, not a sandbox' as const });
  }

  previewGrantRevocation(candidate: FolderModCandidate, capability: string, resources: readonly string[], reason: string, now = new Date().toISOString()): FolderModGrantRevocationPreview {
    const requested = candidate.manifest.permissions.find((permission) => permission.capability === capability
      && JSON.stringify([...permission.resources].sort()) === JSON.stringify([...resources].sort()));
    if (!requested) throw new TypeError(`folder mod did not request exact capability/resources: ${capability}`);
    const grant = this.authority.store.previewGrant({
      modId: candidate.manifest.id, contentHash: candidate.contentHash, capability, resources: [...resources].sort(),
      decision: 'deny', grantedAt: now, grantedBy: 'local-user', reason, revokedAt: now,
    });
    return Object.freeze({ candidate, grant, warning: 'revocation affects new invocations immediately; restart long-lived hosts' as const });
  }

  async approve(preview: FolderModApprovalPreview, approvedPlanHashes: readonly string[]): Promise<FolderModApprovalResult> {
    const expected = [preview.trust.planHash, ...preview.grants.map(({ planHash }) => planHash)];
    if (expected.length !== approvedPlanHashes.length || expected.some((hash, index) => approvedPlanHashes[index] !== hash)) {
      throw new TypeError('folder mod approval must match every exact plan hash in display order');
    }
    const receipts: AuthorityTransactionReceipt[] = [];
    try {
      receipts.push(await this.authority.applyResumable(preview.trust, { approvedPlanHash: approvedPlanHashes[0]! }));
      for (let index = 0; index < preview.grants.length; index += 1) {
        receipts.push(await this.authority.applyResumable(preview.grants[index]!, { approvedPlanHash: approvedPlanHashes[index + 1]! }));
      }
    } catch (error) {
      throw new AggregateError([error], 'folder mod authority bundle was partially applied; rerun the same exact approve command to resume safely');
    }
    return Object.freeze({ trust: receipts[0]!, grants: Object.freeze(receipts.slice(1)) });
  }

  async applyGrantRevocation(preview: FolderModGrantRevocationPreview, approvedPlanHash: string): Promise<AuthorityTransactionReceipt> {
    if (approvedPlanHash !== preview.grant.planHash) throw new TypeError('grant revocation approval does not match the exact plan');
    return this.authority.applyResumable(preview.grant, { approvedPlanHash });
  }

  async isEnabled(candidate: FolderModCandidate): Promise<boolean> {
    return this.activation.enabled(activationIdentity(candidate, this.options.publisherFor(candidate)));
  }

  previewActivation(candidate: FolderModCandidate, enabled: boolean, reason: string, now = new Date().toISOString()): FolderModActivationPreview {
    return Object.freeze({ candidate, activation: this.activation.preview(activationIdentity(candidate, this.options.publisherFor(candidate)), enabled, reason, now), restartRequiredAfterApply: true as const });
  }

  async applyActivation(preview: FolderModActivationPreview, approvedPlanHash: string): Promise<ExternalActivationRecord> {
    if (preview.activation.record.contentHash !== preview.candidate.contentHash || preview.activation.record.manifestHash !== preview.candidate.manifestHash) {
      throw new TypeError('folder mod changed after activation preview');
    }
    return this.activation.apply(preview.activation, approvedPlanHash);
  }

  async activate(candidate: FolderModCandidate, safeMode = false): Promise<ThirdPartyActivationResult> {
    if (!this.options.registry || !this.options.services) throw new TypeError('folder mod activation requires an active registry and injected services');
    if (!await this.isEnabled(candidate)) throw new TypeError(`folder mod is not enabled for this exact artifact: ${candidate.manifest.id}`);
    const resolved = resolveExternalFolderMods({ candidates: [candidate], hostPackages: this.options.hostPackages ?? [], kernelVersion: this.options.kernelVersion ?? AGON_RUNTIME_VERSION });
    if (resolved.length !== 1 || resolved[0] !== candidate) throw new TypeError(`folder mod did not resolve exactly: ${candidate.manifest.id}`);
    return activateTrustedFolderMod({
      candidate, publisher: this.options.publisherFor(candidate), trustRecords: await this.authority.store.readTrust(),
      grantRecords: await this.authority.store.readGrants(), registry: this.options.registry,
      services: this.options.services, safeMode,
    });
  }
}
