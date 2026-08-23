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

export { FIRST_PARTY_PACKAGE_GRAPH } from './generated/first-party-package-graph.js';

export { StaticDiscoveryError, assertContainedPackagePath, inspectStaticManifest } from './discovery.js';
export type { InspectStaticManifestOptions, StaticManifestInspection } from './discovery.js';

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
