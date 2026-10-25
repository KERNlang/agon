import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverUserFolderMods, inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { installVerifiedDirectory } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { discoverUserFolderModsDetailed } from '../../packages/mod-kernel/src/folder-mod-diagnostics.js';
import { FOLDER_MOD_LIMITS } from '../../packages/mod-kernel/src/folder-mod-limits.js';
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

  it('binds file boundaries so bytes cannot shift between adjacent declared files', async () => {
    const first = await folderFixture();
    await writeFile(join(first, 'dist/index.d.ts'), 'a');
    await writeFile(join(first, 'dist/index.js'), 'b\0dist/index.js\0c');
    const second = await folderFixture();
    await writeFile(join(second, 'dist/index.d.ts'), 'a\0dist/index.js\0b');
    await writeFile(join(second, 'dist/index.js'), 'c');
    const [left, right] = await Promise.all([inspectFolderMod(first), inspectFolderMod(second)]);
    expect(left.manifestHash).toBe(right.manifestHash);
    expect(left.contentHash).not.toBe(right.contentHash);
  });

  it('binds file boundaries when verifying an extracted managed package tree', async () => {
    const actualHash = async (files: Record<string, string>) => {
      const source = await mkdtemp(join(tmpdir(), 'agon-verified-tree-'));
      for (const [path, content] of Object.entries(files)) await writeFile(join(source, path), content);
      const prefix = await mkdtemp(join(tmpdir(), 'agon-verified-prefix-'));
      const error = await installVerifiedDirectory(source, { id: 'example.tree', contentHash: `sha256:${'0'.repeat(64)}` } as never, prefix).catch((caught) => caught);
      return (error as { details: { actual: string } }).details.actual;
    };
    expect(await actualHash({ a: 'x', b: 'y\0b\0z' })).not.toBe(await actualHash({ a: 'x\0b\0y', b: 'z' }));
  });

  it('ignores hidden OS metadata files in the mods root without blocking sibling mods', async () => {
    const mods = await mkdtemp(join(tmpdir(), 'agon-s8-mods-hidden-'));
    const root = join(mods, 'valid');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist/index.js'), 'export default {};');
    await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.hidden-sibling')));
    await writeFile(join(mods, '.DS_Store'), 'finder metadata');
    expect((await discoverUserFolderMods(mods)).map(({ manifest: value }) => value.id)).toEqual(['example.hidden-sibling']);
    const detailed = await discoverUserFolderModsDetailed(mods);
    expect(detailed.diagnostics).toEqual([]);
    expect(detailed.candidates.map(({ manifest: value }) => value.id)).toEqual(['example.hidden-sibling']);
  });

  it('does not count hidden root entries against the package-count limit', async () => {
    const mods = await mkdtemp(join(tmpdir(), 'agon-s8-mods-hidden-limit-'));
    const root = join(mods, 'valid');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist/index.js'), 'export default {};');
    await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.hidden-limit')));
    await Promise.all(Array.from({ length: FOLDER_MOD_LIMITS.maxPackages }, (_, index) => writeFile(join(mods, `.meta-${index}`), '')));
    expect((await discoverUserFolderMods(mods)).map(({ manifest: value }) => value.id)).toEqual(['example.hidden-limit']);
    expect((await discoverUserFolderModsDetailed(mods)).candidates.map(({ manifest: value }) => value.id)).toEqual(['example.hidden-limit']);
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
