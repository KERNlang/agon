import { LEGACY_SURFACE_CATALOG } from './generated/legacy-surface-catalog.js';
import { ModRegistry } from './registry.js';
import type { LegacyRegistryEntry, Surface, SurfaceProjection } from './registry.js';

export const LEGACY_COMPATIBILITY_GENERATION = 'legacy-builtin:slice-1a' as const;

export interface LegacyCompatibilityOptions {
  readonly disabledOwnerIds?: readonly string[];
}

export function createLegacyCompatibilityRegistry(options: LegacyCompatibilityOptions = {}): ModRegistry {
  const disabled = new Set(options.disabledOwnerIds ?? []);
  const owners = new Map(LEGACY_SURFACE_CATALOG.map(({ owner }) => [owner.id, owner]));
  const activeOwners = [...owners.values()].filter(({ id }) => !disabled.has(id));
  const entries: LegacyRegistryEntry[] = LEGACY_SURFACE_CATALOG.map((entry) => ({
    surface: entry.surface, kind: entry.kind, id: entry.id, owner: entry.owner, payload: entry.payload,
  }));
  return ModRegistry.fromLegacy(
    { generation: LEGACY_COMPATIBILITY_GENERATION, activeOwners },
    entries,
  );
}

export function generateLegacySurfaceProjections(options: LegacyCompatibilityOptions = {}): Readonly<Record<Surface, SurfaceProjection>> {
  return createLegacyCompatibilityRegistry(options).projections();
}

export { LEGACY_SURFACE_CATALOG };
