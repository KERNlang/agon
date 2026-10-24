import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the owned probe first. Retain legacy package layouts for compatibility. */
export function resolveAgonModelProbeWrapper(moduleUrl: string | URL = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(here, '..', 'python', 'agon-model-probe-wrapper.py'),
    // Workspace support package: src/ or dist/ sits under packages/<owner>/.
    join(here, '..', '..', 'cli', 'py', 'agon-model-probe-wrapper.py'),
    // Legacy Core source: packages/core/src/signals/.
    join(here, '..', '..', '..', 'cli', 'py', 'agon-model-probe-wrapper.py'),
    // Installed sibling CLI: node_modules/@kernlang/agon/.
    join(here, '..', '..', 'agon', 'py', 'agon-model-probe-wrapper.py'),
    // Legacy CLI bundle: <cli>/dist/.
    join(here, '..', 'py', 'agon-model-probe-wrapper.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
