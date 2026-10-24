export { SUPPORT_PACKAGE } from './package-metadata.js';
export * from './types.js';
export { guardEngineAdapter } from './adapter-guard.js';
export { tapDispatchIdentities, resolveCurrentIdentities } from './dispatch-identity.js';
export type { EngineIdentities } from './dispatch-identity.js';
export * from './errors.js';
export * from './engine-schema.js';
export * from './engine-discover.js';
export * from './engine-health.js';
export * from './engine-memory.js';
export * from './auth-store.js';
export * from './isolation.js';
export * from './process.js';
export * from './semaphore.js';
export * from './model-probe-assets.js';
export { DEFAULT_ENGINE_SETTINGS, normalizeEngineSettings } from './engine-settings.js';
export type { EngineSettings } from './engine-settings.js';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve engine definitions owned and shipped by this physical support package. */
export function resolveEngineDefinitionsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'engines');
}
export { WRITE_GRANTING_ARGS, seatGrantsWriteAccess } from './write-permissions.js';
