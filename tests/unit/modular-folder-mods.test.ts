import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverUserFolderMods, inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { manifest } from '../helpers/modular-agon.js';

async function folderFixture(id = 'example.folder'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-folder-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), 'globalThis.__mustNotRun = true; export default {};');
  await writeFile(join(root, 'dist/index.d.ts'), 'declare const value: unknown; export default value;');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest(id)));
  return root;
}

describe('S8 folder mod discovery', () => {
  it('discovers and hashes without evaluating executable code', async () => {
    const mods = await mkdtemp(join(tmpdir(), 'agon-s8-mods-'));
    const source = await folderFixture();
    await symlink(source, join(mods, 'linked'));
    await expect(discoverUserFolderMods(mods)).rejects.toThrow(/real package directories/);
    const candidate = await inspectFolderMod(source);
    expect(candidate.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((globalThis as Record<string, unknown>).__mustNotRun).toBeUndefined();
  });

  it('changes content identity when one declared byte changes', async () => {
    const root = await folderFixture();
    const before = await inspectFolderMod(root);
    await writeFile(join(root, 'dist/index.js'), 'export default { changed: true };');
    const after = await inspectFolderMod(root);
    expect(after.contentHash).not.toBe(before.contentHash);
  });

  it('rejects undeclared files and symlinks anywhere in the package tree', async () => {
    const root = await folderFixture();
    await writeFile(join(root, 'payload.js'), 'undeclared');
    await expect(inspectFolderMod(root)).rejects.toThrow(/undeclared/);
    const clean = await folderFixture();
    await symlink('/etc/passwd', join(clean, 'escape'));
    await expect(inspectFolderMod(clean)).rejects.toThrow(/symbolic links/);
  });

  it('rejects oversized declared files and portable collisions in the actual tree', async () => {
    const oversized = await folderFixture();
    await writeFile(join(oversized, 'dist/index.js'), Buffer.alloc(16 * 1024 * 1024 + 1));
    await expect(inspectFolderMod(oversized)).rejects.toThrow(/file exceeds the byte limit/);

    const collision = await folderFixture();
    await writeFile(join(collision, 'README.md'), 'one');
    await writeFile(join(collision, 'readme.md'), 'two');
    const collidingEntries = (await readdir(collision)).filter((name) => name.toLowerCase() === 'readme.md');
    if (collidingEntries.length === 2) {
      await expect(inspectFolderMod(collision)).rejects.toThrow(/portable path collision/);
    } else {
      expect(collidingEntries).toHaveLength(1); // case-insensitive filesystems prevent constructing the invalid tree
    }

    const unicodeCollision = await folderFixture();
    await writeFile(join(unicodeCollision, 'café.txt'), 'one');
    await writeFile(join(unicodeCollision, 'café.txt'), 'two');
    const unicodeEntries = (await readdir(unicodeCollision)).filter((name) => name.normalize('NFC') === 'café.txt');
    if (unicodeEntries.length === 2) {
      await expect(inspectFolderMod(unicodeCollision)).rejects.toThrow(/portable path collision/);
    } else {
      expect(unicodeEntries).toHaveLength(1); // normalization-preserving filesystems prevent constructing the invalid tree
    }
  });

  it('refuses duplicate identities in one user folder', async () => {
    const mods = await mkdtemp(join(tmpdir(), 'agon-s8-mods-'));
    for (const name of ['a', 'b']) {
      const root = join(mods, name); await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(join(root, 'dist/index.js'), 'export default {};');
      await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
      await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
      await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.duplicate')));
    }
    await expect(discoverUserFolderMods(mods)).rejects.toThrow(/duplicate folder mod identity/);
  });
});
