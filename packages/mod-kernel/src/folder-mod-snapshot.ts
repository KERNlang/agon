import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectFolderMod, type FolderModCandidate } from './folder-mods.js';
import { assertNoSymlinkComponents, walkBoundedPackage, type BoundedPackageFile } from './folder-mod-bounds.js';
import { StaticDiscoveryError } from './discovery.js';
import { readExactBounded } from './bounded-file-read.js';
import { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';

export interface FolderModSnapshot {
  readonly candidate: FolderModCandidate;
  readonly dispose: () => Promise<void>;
}

async function copyNoFollow(packageRoot: string, file: BoundedPackageFile, destination: string): Promise<number> {
  const source = join(packageRoot, file.path);
  await assertNoSymlinkComponents(packageRoot, file.path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    await assertNoSymlinkComponents(packageRoot, file.path);
    const current = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const currentStat = await current.stat(); await current.close();
    if (!stat.isFile() || stat.dev !== file.device || stat.ino !== file.inode || currentStat.dev !== stat.dev || currentStat.ino !== stat.ino || stat.size > FOLDER_MOD_LIMITS.maxFileBytes) {
      throw new StaticDiscoveryError('snapshot source is not a bounded regular file', { source, bytes: stat.size });
    }
    let bytes: Buffer;
    try { bytes = await readExactBounded(input, stat.size, FOLDER_MOD_LIMITS.maxFileBytes); }
    catch (error) { throw new StaticDiscoveryError('snapshot source changed during bounded copy', { source, cause: String(error) }); }
    const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o400);
    try { await output.writeFile(bytes); await output.sync(); }
    finally { await output.close(); }
    return bytes.byteLength;
  } finally { await input.close(); }
}

async function freezeDirectories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) if (entry.isDirectory()) await freezeDirectories(join(root, entry.name));
  await chmod(root, 0o500);
}

async function thawDirectories(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isDirectory()) await thawDirectories(join(root, entry.name));
}

export async function createFolderModSnapshot(candidate: FolderModCandidate, parent = tmpdir()): Promise<FolderModSnapshot> {
  for (const path of ['agon.mod.json', ...candidate.manifest.pack.include]) await assertNoSymlinkComponents(candidate.packageRoot, path);
  const current = await inspectFolderMod(candidate.packageRoot, candidate.source);
  if (current.contentHash !== candidate.contentHash || current.manifestHash !== candidate.manifestHash) {
    throw new StaticDiscoveryError('folder mod changed after inspection; authority must be re-evaluated');
  }
  const sourceFiles = new Map((await walkBoundedPackage(current.packageRoot)).map((file) => [file.path, file]));
  const root = await mkdtemp(join(parent, 'agon-folder-mod-snapshot-'));
  let keep = false;
  try {
    const manifestFile = sourceFiles.get('agon.mod.json');
    if (!manifestFile) throw new StaticDiscoveryError('snapshot manifest identity is missing');
    let totalBytes = await copyNoFollow(current.packageRoot, manifestFile, join(root, 'agon.mod.json'));
    for (const path of current.manifest.pack.include) if (path !== 'agon.mod.json') {
      const file = sourceFiles.get(path);
      if (!file) throw new StaticDiscoveryError('snapshot source identity is missing', { path });
      totalBytes += await copyNoFollow(current.packageRoot, file, join(root, path));
      if (totalBytes > FOLDER_MOD_LIMITS.maxTotalBytes) {
        throw new StaticDiscoveryError('folder mod snapshot exceeds the total-byte limit', { totalBytes, maxBytes: FOLDER_MOD_LIMITS.maxTotalBytes });
      }
    }
    const snapshot = await inspectFolderMod(root, current.source);
    if (snapshot.contentHash !== current.contentHash || snapshot.manifestHash !== current.manifestHash) {
      throw new StaticDiscoveryError('folder mod snapshot does not match inspected bytes');
    }
    await freezeDirectories(root);
    keep = true;
    return Object.freeze({
      candidate: Object.freeze({ ...snapshot, sourceLocator: current.sourceLocator }),
      dispose: async () => { await thawDirectories(root); await rm(root, { recursive: true, force: true }); },
    });
  } finally {
    if (!keep) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
