export { CliAdapter } from './adapter.js';

import type { EngineRegistry } from '@kernlang/agon-core';
import { CliAdapter } from './adapter.js';

/**
 * Create a CliAdapter. No registration needed — engine JSON defines everything.
 */
export function createCliAdapter(registry: EngineRegistry): CliAdapter {
  return new CliAdapter(registry);
}
