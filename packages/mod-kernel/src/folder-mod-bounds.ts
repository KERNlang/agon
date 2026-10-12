import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';

import { StaticDiscoveryError } from './discovery.js';
import { readExactBounded } from './bounded-file-read.js';
import { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';
import { sha256Canonical } from './lock.js';

const ARCHIVE_FILE = /(?:\.zip|\.tar|\.tgz|\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.7z|\.rar)$/i;
// Locked npm payloads can contain more files than drop-in folder mods.
// Keep byte, depth and no-follow limits shared; bound both inventories.
const INSTALLED_PACKAGE_COUNTS = Object.freeze({ maxFiles: 8_192, maxEntries: 16_384 });

export { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';

export interface BoundedPackageFile {
  readonly path: string; readonly bytes: number; readonly device: number; readonly inode: number;
}

/** Reject links observed in path components. This is not atomic traversal;
 * callers must also control concurrent writers and validate opened files. */
export async function assertNoSymlinkComponents(root: string, relativePath: string): Promise<void> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new StaticDiscoveryError('folder mod root changed during inspection');
  let current = root;
  for (const segment of relativePath.split('/').filter(Boolean)) {
    current = join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new StaticDiscoveryError('symbolic links are forbidden in folder mods', { path: relativePath });
  }
}

/** Iteratively enumerate a package without following links or allowing resource exhaustion. */
export async function walkBoundedPackage(root: string, options: { readonly omitRootNodeModules?: boolean } = {}): Promise<readonly BoundedPackageFile[]> {
  return walkPackage(root, options, FOLDER_MOD_LIMITS);
}

async function walkPackage(root: string, options: { readonly omitRootNodeModules?: boolean },
  counts: { readonly maxFiles: number; readonly maxEntries: number }): Promise<readonly BoundedPackageFile[]> {
  const pending: Array<{ readonly prefix: string; readonly depth: number }> = [{ prefix: '', depth: 0 }];
  const files: BoundedPackageFile[] = [];
  let totalBytes = 0;
  let totalEntries = 0;
  while (pending.length > 0) {
    const { prefix, depth } = pending.pop()!;
    if (depth > FOLDER_MOD_LIMITS.maxDepth) {
      throw new StaticDiscoveryError('folder mod exceeds the directory depth limit', { maxDepth: FOLDER_MOD_LIMITS.maxDepth });
    }
    await assertNoSymlinkComponents(root, prefix);
    const entries = await opendir(join(root, prefix));
    for await (const entry of entries) {
      await assertNoSymlinkComponents(root, prefix);
      totalEntries++;
      if (totalEntries > counts.maxEntries) {
        throw new StaticDiscoveryError('package exceeds the entry-count limit', { maxEntries: counts.maxEntries });
      }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) throw new StaticDiscoveryError('symbolic links are forbidden in folder mods', { path });
      if (stat.isDirectory()) {
        // npm dependencies have separate package identities, not payload identity.
        if (options.omitRootNodeModules && path === 'node_modules') continue;
        if (options.omitRootNodeModules && /(?:^|\/)node_modules\/@kernlang\/agon-(?:kernel|mod-api)$/i.test(path)) {
          throw new StaticDiscoveryError('package-owned directory contains a duplicate singleton', { path });
        }
        pending.push({ prefix: path, depth: depth + 1 });
        continue;
      }
      if (!stat.isFile()) throw new StaticDiscoveryError('device or special file is forbidden in folder mod', { path });
      if (ARCHIVE_FILE.test(path)) throw new StaticDiscoveryError('nested archives are forbidden in folder mods; provide unpacked declared files', { path });
      if (stat.size > FOLDER_MOD_LIMITS.maxFileBytes) {
        throw new StaticDiscoveryError('folder mod file exceeds the byte limit', { path, bytes: stat.size, maxBytes: FOLDER_MOD_LIMITS.maxFileBytes });
      }
      files.push(Object.freeze({ path, bytes: stat.size, device: stat.dev, inode: stat.ino }));
      totalBytes += stat.size;
      if (files.length > counts.maxFiles) {
        throw new StaticDiscoveryError('package exceeds the file-count limit', { maxFiles: counts.maxFiles });
      }
      if (totalBytes > FOLDER_MOD_LIMITS.maxTotalBytes) {
        throw new StaticDiscoveryError('folder mod exceeds the total-byte limit', { totalBytes, maxBytes: FOLDER_MOD_LIMITS.maxTotalBytes });
      }
    }
    await assertNoSymlinkComponents(root, prefix);
  }
  return Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path)));
}

/** Hash package-owned files. Dependency resolution needs separate verification. */
export async function hashInstalledPackagePayload(root: string): Promise<`sha256:${string}`> {
  const files = await walkPackage(root, { omitRootNodeModules: true }, INSTALLED_PACKAGE_COUNTS);
  const byPath = new Map(files.map(file => [file.path, file]));
  const inventory: Array<{ path: string; size: number; contentHash: string }> = [];
  for (const path of [...byPath.keys()].sort()) {
    const bytes = await readBoundedPackageFile(root, byPath.get(path)!);
    inventory.push({ path, size: bytes.byteLength, contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
  }
  return sha256Canonical(inventory);
}

/** Read one already-enumerated file while rechecking size and no-follow semantics. */
export async function readBoundedPackageFile(root: string, file: BoundedPackageFile): Promise<Uint8Array> {
  await assertNoSymlinkComponents(root, file.path);
  const handle = await open(join(root, file.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    await assertNoSymlinkComponents(root, file.path);
    const current = await lstat(join(root, file.path));
    if (!stat.isFile() || stat.size !== file.bytes || stat.dev !== file.device || stat.ino !== file.inode
      || current.dev !== stat.dev || current.ino !== stat.ino || stat.size > FOLDER_MOD_LIMITS.maxFileBytes) {
      throw new StaticDiscoveryError('folder mod file changed during inspection', { path: file.path });
    }
    try {
      return await readExactBounded(handle, file.bytes, FOLDER_MOD_LIMITS.maxFileBytes);
    } catch (error) {
      throw new StaticDiscoveryError('folder mod file changed during inspection', { path: file.path, cause: String(error) });
    }
  } finally {
    await handle.close();
  }
}
