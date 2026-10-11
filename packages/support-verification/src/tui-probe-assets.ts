import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the probe shipped by this package. The caller supplies the CLI binary. */
export function resolveTuiProbeScript(): string | null {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'python', 'agon-tui-probe.py');
  return existsSync(script) ? script : null;
}
