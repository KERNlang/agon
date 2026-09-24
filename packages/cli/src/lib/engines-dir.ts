import { resolveEngineDefinitionsDir } from '@kernlang/agon-support-engine-runtime';

/**
 * Compatibility name for the engine-runtime package's owned asset directory.
 */
export function resolveBuiltinEnginesDir(): string {
  return resolveEngineDefinitionsDir();
}
