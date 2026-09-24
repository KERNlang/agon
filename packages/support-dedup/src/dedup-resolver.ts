import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';


/**
 * Resolve the Python interpreter for optional sidecars: explicit AGON_PYTHON, then Agon managed virtualenv, then python3.
 */
export function resolveSidecarPython(): string {
  if (process.env.AGON_PYTHON) return process.env.AGON_PYTHON;
  const managed = process.platform === 'win32'
    ? resolve(process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'), 'python-sidecar', 'Scripts', 'python.exe')
    : resolve(process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'), 'python-sidecar', 'bin', 'python');
  return existsSync(managed) ? managed : 'python3';
}

/**
 * Return the absolute path of a Python sidecar shipped in @kernlang/agon-dedup, or null if not found. `filename` is the bare filename (e.g. 'history-search.py'), not a path.
 */
export function resolveDedupSidecar(filename: string): string | null {
  // Canonical S4 package asset: src/ or dist/ sits beside python/.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const canonical = resolve(here, '..', 'python', filename);
    if (existsSync(canonical)) return canonical;
  } catch {
    // Fall through to the legacy compatibility package.
  }
  // Legacy package fallback while @kernlang/agon-dedup remains supported. This file compiles to
  //   packages/core/dist/blocks/dedup-resolver.js
  // and the sidecar lives at packages/dedup/<filename>: three ups
  // (blocks → dist → core) lands on packages/.
  try {
    const requireFn = createRequire(import.meta.url);
    const pkgJsonPath = requireFn.resolve('@kernlang/agon-dedup/package.json');
    const fallback = resolve(dirname(pkgJsonPath), filename);
    if (existsSync(fallback)) return fallback;
  } catch {
    // ignored — both paths failed
  }
  return null;
}
