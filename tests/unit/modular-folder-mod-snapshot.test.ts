import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFolderModSnapshot } from '../../packages/mod-kernel/src/folder-mod-snapshot.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { manifest } from '../helpers/modular-agon.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-snapshot-source-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), 'export default {};\n');
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.snapshot')));
  return root;
}

describe('S8 immutable folder mod snapshots', () => {
  it('copies only declared bytes, preserves the authority locator, and re-hashes independently', async () => {
    const source = await fixture();
    const candidate = await inspectFolderMod(source);
    const snapshot = await createFolderModSnapshot(candidate);
    expect(snapshot.candidate.packageRoot).not.toBe(candidate.packageRoot);
    expect(snapshot.candidate.sourceLocator).toBe(candidate.sourceLocator);
    expect(snapshot.candidate.contentHash).toBe(candidate.contentHash);
    await snapshot.dispose();
  });

  it('rejects an intermediate directory replaced by an outside symlink before hashing or copying it', async () => {
    const source = await fixture(); const candidate = await inspectFolderMod(source);
    const outside = await mkdtemp(join(tmpdir(), 'agon-s8-outside-'));
    await writeFile(join(outside, 'index.js'), 'outside sentinel'); await writeFile(join(outside, 'index.d.ts'), 'outside type sentinel');
    await rm(join(source, 'dist'), { recursive: true }); await symlink(outside, join(source, 'dist'), 'dir');
    await expect(createFolderModSnapshot(candidate)).rejects.toThrow(/symbolic links are forbidden/);
    expect(await readFile(join(outside, 'index.js'), 'utf8')).toBe('outside sentinel');
  });

  it('refuses source bytes edited after the operator inspected them', async () => {
    const source = await fixture();
    const candidate = await inspectFolderMod(source);
    await writeFile(join(source, 'dist/index.js'), 'export default { changed: true };\n');
    await expect(createFolderModSnapshot(candidate)).rejects.toThrow(/changed after inspection/);
  });
});
