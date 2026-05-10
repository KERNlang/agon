import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

/**
 * Resolve the built-in engines directory.
 *
 * In development (source mode) the engines live at the repo root:
 *   packages/cli/src/lib/ -> repo root engines/
 *
 * In a published/bundled build the engines are copied next to the
 * bundle entry (dist/index.js) so the relative path is simply ./engines.
 */
export function resolveBuiltinEnginesDir(): string {
  // __dirname in ESM ≈ dirname(fileURLToPath(import.meta.url))
  const here = dirname(fileURLToPath(import.meta.url));

  // 1. Try the bundled location first (dist/engines/ when published)
  const bundled = join(here, 'engines');
  if (existsSync(bundled)) return bundled;

  // 2. Development fallback: walk up to repo root (src/ -> packages/cli/ -> repo root)
  const dev = join(here, '..', '..', '..', 'engines');
  if (existsSync(dev)) return dev;

  // 3. Last resort — return the bundled path so callers get a clean "not found" warning
  return bundled;
}
