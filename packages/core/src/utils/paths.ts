import { join, resolve } from 'node:path';

import { homedir } from 'node:os';

/**
 * Resolve a path under ~/.agon (or AGON_HOME if set). resolve() is a no-op on the already-absolute homedir path, so the override and default branches behave identically.
 */
export function runtimeAgonPath(...parts: string[]): string {
  return join(resolve(process.env.AGON_HOME?.trim() || join(homedir(), '.agon')), ...parts);
}

/**
 * Canonical cache directory under ~/.agon/cache.
 */
export function getCacheDir(): string {
  return runtimeAgonPath('cache');
}

/**
 * Canonical undo directory under ~/.agon/undo.
 */
export function getUndoDir(): string {
  return runtimeAgonPath('undo');
}
