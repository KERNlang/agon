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
  ModAvailabilityReason, ModAvailabilityReasonCode, ModManagementEntry, ModManagementGroup,
  ModManagementView, ModManagementViewOptions,
} from './mod-management-ui.js';

export { StaticDiscoveryError, assertContainedPackagePath, inspectStaticManifest } from './discovery.js';
export type { InspectStaticManifestOptions, StaticManifestInspection } from './discovery.js';

export { ModActivationService } from './activation-service.js';
export type {
  ActivationApplyResult, ActivationArtifactBuilder, ActivationArtifacts, ActivationRestartPolicy,
  ActivationTransactionPlan,
} from './activation-service.js';

export { DurableHostError } from './host-errors.js';
export type { DurableHostErrorCode } from './host-errors.js';
export { DurableModHost } from './durable-host.js';
export type {
  CommitGenerationInput, CommitGenerationResult, DisposableOwner, DurableHostOptions,
  GenerationLease, GenerationManifest, GenerationPointer, HostBootResult, HostFaultPoint,
  HostJournalState, HostJournalStep, HostTransactionJournal, HostTransactionOperation,
  HostTransactionReceipt,
} from './durable-host.js';
export type { HostIo } from './host-io.js';
export { migrateStagedCopy } from './migration-engine.js';
export type { MigrationReceipt, VersionedMigration } from './migration-engine.js';
export type { HostBlockedReason, HostDoctorReport, HostEvent, HostEventLevel } from './host-observability.js';
export { rollbackGeneration } from './host-rollback.js';
export type { RollbackGenerationOptions } from './host-rollback.js';

export { SUPPORT_PACKAGE_IDS } from './support-module.js';
export type { SupportPackageDescriptor, SupportPackageFactory, SupportPackageId } from './support-module.js';
