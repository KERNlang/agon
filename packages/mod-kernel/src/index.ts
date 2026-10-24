export type { TeamRole, TeamComposeMode, TeamCoopStrategy, TeamMember, TeamSpec, TeamFormat, TeamRoundTrace, TeamSubmission, TeamScoreCard, TeamMatchResult, TeamEventType, TeamEvent } from './team-contracts.js';
export { validatePersistedEnvelope } from '@kernlang/agon-mod-api';
export { parseArtifactLeaseIdentity } from './host-contracts.js';
export type { Json, PersistedEnvelope } from '@kernlang/agon-mod-api';
export { createScopedConfigStore } from './scoped-config-store.js';
export type { ConfigMemoEntry, ScopedConfigStoreOptions } from './scoped-config-store.js';
export { readGenerationConfiguration, readSelectedGenerationConfigurationSync } from './configuration-migration.js';
export { LEGACY_MOD_SETTING_OWNERS } from './legacy-config-assignments.generated.js';
export type { GenerationConfiguration } from './configuration-migration.js';
export { currentInvocationConfiguration, currentInvocationOwnerAvailable } from './configuration-scope.js';
export type { InvocationConfigurationScope } from './configuration-scope.js';
export { DEFAULT_KERNEL_SETTINGS, normalizeKernelSettings } from './settings.js';
export type { KernelSettings } from './settings.js';
export { selectModSettings, mergeModSettingsLayers, projectLegacyModSettings, applyModSettingsDefaults, readLegacyConfigAliases, resolveRegisteredModSettings } from './mod-settings.js';

export {
  ModResolutionError,
  SOURCE_PRECEDENCE,
  normalizeCandidates,
  resolveCandidates,
} from './resolver.js';
export type {
  ModCandidate,
  NormalizedModCandidate,
  RejectedCandidate,
  ResolvedModGraph,
  ResolutionFailureCode,
  ResolveOptions,
  ShadowedCandidate,
} from './resolver.js';
export {
  SurfaceGeneration, SurfaceGenerationError, SurfaceGenerationSelector, SurfaceClient, assertGeneratedSurfaceAccessibility,
} from './surface-generation.js';
export type { GeneratedSurfaceCatalogEntry, GeneratedSurfaceRuntime, SurfaceAccessibility, SurfaceGenerationMode } from './surface-generation.js';
export { activateFirstPartySurfaceGeneration } from './activated-surface-generation.js';
export type { ActivatedSurfaceGeneration, FirstPartySurfacePackage } from './activated-surface-generation.js';
export { bootstrapFirstPartySurfaceGeneration } from './first-party-surface-bootstrap.js';
export { createFirstPartyActivationService } from './first-party-activation.js';
export { ModStateStore, ModStateStoreError } from './mod-state-store.js';
export type { FirstPartySurfaceBoot } from './first-party-surface-bootstrap.js';

export {
  RegistryInvariantError,
  ModRegistry,
} from './registry.js';
export type {
  LegacyRegistryEntry,
  ModRegistryOptions,
  RegistrationSession,
  RegistryKind,
  RegistryRecord,
  Surface,
  SurfaceProjection,
} from './registry.js';
export {
  canonicalJson,
  createCanonicalLock,
  sha256Canonical,
} from './lock.js';
export type {
  CanonicalModLock,
  CreateLockOptions,
  LockedModPackage,
} from './lock.js';

export {
  LEGACY_COMPATIBILITY_GENERATION,
  LEGACY_SURFACE_CATALOG,
  createLegacyCompatibilityRegistry,
  generateLegacySurfaceProjections,
} from './compatibility.js';
export type { LegacyCompatibilityOptions } from './compatibility.js';

export { FIRST_PARTY_SURFACE_CATALOG } from './generated/first-party-surface-catalog.js';
export { FIRST_PARTY_PACKAGE_GRAPH } from './generated/first-party-package-graph.js';
export { FIRST_PARTY_UI_HIERARCHY } from './generated/first-party-ui-hierarchy.js';

export {
  DesiredStateConflictError, DesiredStateError, applyDesiredStatePlan, createFirstPartyModCatalog,
  createFullCompatDesiredState, parseDesiredState, parseProfileDefinition, planDesiredStateChange, resolveDesiredState,
  projectRepositoryModSettings,
} from './desired-state.js';
export type {
  AppliedProfileSnapshot, DesiredModState, DesiredStateAction, DesiredStateErrorCode, DesiredStatePlan,
  FirstPartyModCatalog, FirstPartyModDefinition, FirstPartyPackageClass, FirstPartyPackageDefinition,
  ProfileDefinition, RepositoryModSettingsProjection,
} from './desired-state.js';
export {
  assertModManagementAccessibility, createModManagementView, reduceModManagementFocus, renderModManagementText,
} from './mod-management-ui.js';
export type {
  ExternalModManagementDefinition, ModAvailabilityReason, ModAvailabilityReasonCode, ModManagementEntry, ModManagementGroup,
  ModManagementView, ModManagementViewOptions,
} from './mod-management-ui.js';

export { StaticDiscoveryError, assertContainedPackagePath, inspectStaticManifest } from './discovery.js';
export type { InspectStaticManifestOptions, StaticManifestInspection } from './discovery.js';
export { discoverUserFolderMods, inspectFolderMod } from './folder-mods.js';
export type { FolderModCandidate } from './folder-mods.js';
export { discoverUserFolderModsDetailed } from './folder-mod-diagnostics.js';
export type { FolderModDiagnostic, FolderModDiscoveryResult } from './folder-mod-diagnostics.js';
export { FOLDER_MOD_LIMITS } from './folder-mod-bounds.js';
export { createFolderModSnapshot } from './folder-mod-snapshot.js';
export type { FolderModSnapshot } from './folder-mod-snapshot.js';
export { FolderModManager } from './folder-mod-manager.js';
export type { FolderModActivationPreview, FolderModApprovalPreview, FolderModApprovalResult, FolderModGrantRevocationPreview, FolderModManagerOptions } from './folder-mod-manager.js';
export { ExternalActivationStore } from './external-activation-state.js';
export type { ExternalActivationFaultPoint, ExternalActivationIdentity, ExternalActivationPlan, ExternalActivationRecord, ExternalActivationStoreOptions } from './external-activation-state.js';
export { resolveExternalFolderMods, resolveExternalFolderModsIsolated } from './external-resolution.js';
export type { IsolatedExternalResolution } from './external-resolution.js';
export { assertContributionInput, validateContributionInput } from './json-schema-input.js';
export { createSafeExternalModServices } from './external-mod-services-safe.js';
export { TrustGrantStore, evaluateThirdPartyAuthority, parseGrantRecord, parseTrustRecord } from './trust-authority.js';
export type {
  AuthorityEvaluation, AuthorityMutationPlan, GrantDecision, GrantRecord, ThirdPartyArtifactIdentity,
  TrustDecision, TrustPublisher, TrustRecord, TrustScope,
} from './trust-authority.js';
export { TransactionalTrustGrantService } from './transactional-authority.js';
export { HOST_PROVIDED_DEPENDENCY_IDS } from './package-activation-order.js';
export type {
  AuthorityFaultPoint, AuthorityOperation, AuthorityTransactionJournal, AuthorityTransactionReceipt, TransactionalAuthorityOptions,
} from './transactional-authority.js';

export { ModActivationService } from './activation-service.js';
export type {
  ActivationApplyResult, ActivationArtifactBuilder, ActivationArtifacts, ActivationRestartPolicy,
  ActivationTransactionPlan,
} from './activation-service.js';

export { AgonError, ConfigError, DurableHostError } from './host-errors.js';
export type { DurableHostErrorCode } from './host-errors.js';
export { DurableModHost } from './durable-host.js';
export type {
  CommitGenerationInput, CommitGenerationResult, DisposableOwner, DurableHostOptions,
  ArtifactGenerationLease, ArtifactLeaseIdentity, GenerationLease, GenerationManifest, GenerationPointer, HostBootResult, HostFaultPoint,
  HostJournalState, HostJournalStep, HostTransactionJournal, HostTransactionOperation,
  HostTransactionReceipt,
} from './durable-host.js';
export type { HostIo } from './host-io.js';
export { migrateStagedCopy, readMigrationSourceRevision } from './migration-engine.js';
export { WriterFence, withSynchronousWriterFence } from './writer-lock.js';
export type { MigrationReceipt, MigrationSourceRevision, VersionedMigration } from './migration-engine.js';
export type { HostBlockedReason, HostDoctorReport, HostEvent, HostEventLevel } from './host-observability.js';
export { rollbackGeneration } from './host-rollback.js';
export type { RollbackGenerationOptions } from './host-rollback.js';

export {
  ManagedLifecycleService, createManagedLifecyclePlan, installVerifiedDirectory,
} from './managed-lifecycle.js';
export type {
  CandidateInstaller, CandidateVerificationResult, CandidateVerifier, ManagedInstallationRecord,
  ManagedLifecycleApplyResult, ManagedLifecycleFaultPoint, ManagedLifecycleOperation, ManagedLifecycleOptions, ManagedThirdPartyAuthority,
  ManagedLifecyclePackagePlan, ManagedLifecyclePlan, ManagedLifecycleReceipt, ManagedLifecycleRequest,
  ManagedNetworkPolicy, ManagedPackageArtifact, ManagedPackageSourceKind, ManagedLauncherIdentity,
} from './managed-lifecycle.js';

export { NpmCandidateInstaller, SubprocessCandidateVerifier, runBoundedCandidateProcess, runIsolatedNpmCandidateProcess } from './candidate-process.js';
export { hashInstalledPackagePayload } from './folder-mod-bounds.js';
export type {
  BoundedProcessRequest, BoundedProcessResult, BoundedProcessRunner,
  NpmCandidateInstallerOptions, SubprocessCandidateVerifierOptions,
} from './candidate-process.js';

export { applyManagedPurge, applyManagedGenerationCollection, ManagedRetentionInspector, previewManagedPurge, previewManagedGenerationCollection, recoverManagedLifecycle } from './lifecycle-recovery.js';
export type { ManagedGenerationCollectionPlan } from './generation-retirement.js';
export type { LifecycleRecoveryOptions, LifecycleRecoveryResult, ManagedPurgePlan, ManagedRetentionReport } from './lifecycle-recovery.js';
export { applyManagedQuotaCollection, previewManagedQuotaCollection, parseManagedQuotaPlan } from './quota-retention.js';
export type { ManagedQuotaPlan, RetentionCacheOwner, RetentionCacheSnapshot } from './quota-retention.js';

export { createSetupActionPlan, executeSetupAction } from './setup-actions.js';
export type { SetupActionDefinition, SetupActionKind, SetupActionPlan, SetupActionReceipt } from './setup-actions.js';

export { SUPPORT_PACKAGE_IDS } from './support-module.js';
export type { SupportPackageDescriptor, SupportPackageFactory, SupportPackageId } from './support-module.js';
export { ThirdPartyActivationError, activatePreparedThirdPartyMod, activateTrustedFolderMod, prepareTrustedFolderMod } from './third-party-activation.js';
export type {
  PreparedThirdPartyMod, ThirdPartyActivationOptions, ThirdPartyActivationResult,
} from './third-party-activation.js';
export { createExternalSurfaceCatalog } from './external-surface-catalog.js';
export { KERNEL_MANAGEMENT_SURFACE_CATALOG } from './kernel-management-surfaces.js';
export { createBuiltInProfileDefinition, createReleaseSetupSelection } from './release-setup.js';
export type { BuiltInProfileId, ReleaseSetupRequest, ReleaseSetupSelection } from './release-setup.js';
export { AGON_RUNTIME_VERSION } from './runtime-version.js';
export { createSidechainLogger } from './sidechain-logger.js';
export type { SidechainEvent, SidechainLogger } from './sidechain-logger.js';
export { createNpmReleaseCatalog, createFrozenNpmInstall } from './npm-lock.js';
export type { FrozenNpmArtifact, FrozenNpmCatalog, NpmLockRecord } from './npm-lock.js';
