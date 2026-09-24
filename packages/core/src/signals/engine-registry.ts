/**
 * @deprecated S4 compatibility adapter.
 *
 * The physical registry lives in @kernlang/agon-support-engine-catalog. Core
 * injects the legacy Glicko lookup until rating ownership moves with its mod.
 */
import { EngineRegistry as SupportEngineRegistry } from '@kernlang/agon-support-engine-catalog';

import { getEngineGlickoRating } from './glicko.js';

export * from '@kernlang/agon-support-engine-catalog';

export class EngineRegistry extends SupportEngineRegistry {
  constructor() {
    super((engineId, taskClass) => getEngineGlickoRating(engineId, taskClass));
  }
}
