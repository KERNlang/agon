export { SUPPORT_PACKAGE } from './package-metadata.js';
export * from './types.js';
export * from './errors.js';
export * from './engine-schema.js';
export * from './engine-discover.js';
export * from './engine-health.js';
export * from './engine-memory.js';
export * from './auth-store.js';
export * from './isolation.js';
export * from './process.js';
export * from './semaphore.js';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve engine definitions owned and shipped by this physical support package. */
export function resolveEngineDefinitionsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'engines');
}
