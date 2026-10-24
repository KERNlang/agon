import { join } from 'node:path';
import type { HostIo } from './host-io.js';

export async function makeTreeRemovable(io: HostIo, root: string): Promise<void> {
  const entries = await io.readdir(root, { withFileTypes: true });
  await io.chmod(root, 0o700);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeTreeRemovable(io, path);
    else if (entry.isFile()) await io.chmod(path, 0o600);
  }
}
