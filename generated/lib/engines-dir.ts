// @kern-source: engines-dir:1
import { join, dirname } from 'node:path';

// @kern-source: engines-dir:2
import { fileURLToPath } from 'node:url';

// @kern-source: engines-dir:3
import { existsSync } from 'node:fs';

// @kern-source: engines-dir:5
/**
 * Resolve the built-in engines directory. Checks for the bundled dist/engines/ first (npm-published layout), then walks up to the repo root engines/ for source mode. Last resort returns the bundled path so callers see a clean 'not found' instead of a misleading dev path.
 */
export function resolveBuiltinEnginesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, 'engines');
  if (existsSync(bundled)) {
    return bundled;
  }
  const dev = join(here, '..', '..', '..', 'engines');
  if (existsSync(dev)) {
    return dev;
  }
  return bundled;
}

