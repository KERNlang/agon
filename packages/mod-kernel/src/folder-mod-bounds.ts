import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { StaticDiscoveryError } from './discovery.js';
import { readExactBounded } from './bounded-file-read.js';
import { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';

const ARCHIVE_FILE = /(?:\.zip|\.tar|\.tgz|\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.7z|\.rar)$/i;

export { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';

export interface BoundedPackageFile {
  readonly path: string; readonly bytes: number; readonly device: number; readonly inode: number;
}

/** Reject links in every currently resolved component. Used before and after opens to close path-swap races. */
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
export async function walkBoundedPackage(root: string): Promise<readonly BoundedPackageFile[]> {
  const pending: Array<{ readonly prefix: string; readonly depth: number }> = [{ prefix: '', depth: 0 }];
  const files: BoundedPackageFile[] = [];
  let totalBytes = 0;
  while (pending.length > 0) {
    const { prefix, depth } = pending.pop()!;
    if (depth > FOLDER_MOD_LIMITS.maxDepth) {
      throw new StaticDiscoveryError('folder mod exceeds the directory depth limit', { maxDepth: FOLDER_MOD_LIMITS.maxDepth });
    }
    await assertNoSymlinkComponents(root, prefix);
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    await assertNoSymlinkComponents(root, prefix);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)).reverse()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) throw new StaticDiscoveryError('symbolic links are forbidden in folder mods', { path });
      if (stat.isDirectory()) {
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
      if (files.length > FOLDER_MOD_LIMITS.maxFiles) {
        throw new StaticDiscoveryError('folder mod exceeds the file-count limit', { maxFiles: FOLDER_MOD_LIMITS.maxFiles });
      }
      if (totalBytes > FOLDER_MOD_LIMITS.maxTotalBytes) {
        throw new StaticDiscoveryError('folder mod exceeds the total-byte limit', { totalBytes, maxBytes: FOLDER_MOD_LIMITS.maxTotalBytes });
      }
    }
  }
  return Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path)));
}

/** Read one already-enumerated file while rechecking size and no-follow semantics. */
export async function readBoundedPackageFile(root: string, file: BoundedPackageFile): Promise<Buffer> {
  await assertNoSymlinkComponents(root, file.path);
  const handle = await open(join(root, file.path), constants.O_RDONLY | constants.O_NOFOLLOW);
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
