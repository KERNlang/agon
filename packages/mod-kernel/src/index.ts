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
