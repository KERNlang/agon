import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VirtualFS,
  applyEffectPackage,
  createFileSnapshot,
  effectPackageDiff,
  relocateEffectPackage,
} from '../../packages/core/src/generated/forge/virtual-fs.js';

describe('VirtualFS', () => {
  it('relocates isolated worktree overlays before applying to the main workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-vfs-'));
    const main = join(root, 'main');
    const worktree = join(root, 'worktree');
    mkdirSync(join(main, 'src'), { recursive: true });
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(main, 'src/app.ts'), 'export const value = 1;\n');
    writeFileSync(join(worktree, 'src/app.ts'), 'export const value = 1;\n');

    const vfs = new VirtualFS(createFileSnapshot(worktree), 'shadow', 'run-1');
    vfs.write(join(worktree, 'src/app.ts'), 'export const value = 2;\n');

    const pkg = vfs.toEffectPackage('changed value', 1, 10);
    const relocated = relocateEffectPackage(pkg, worktree, main);
    const modified = applyEffectPackage(relocated, main);

    expect(readFileSync(join(main, 'src/app.ts'), 'utf-8')).toBe('export const value = 2;\n');
    expect(modified).toContain(join(main, 'src/app.ts'));
  });

  it('emits live change callbacks with diffable effect packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-vfs-preview-'));
    const filePath = join(root, 'src/app.ts');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(filePath, 'export const value = 1;\n');

    const previews: Array<{ path: string; diff: string }> = [];
    const vfs = new VirtualFS(createFileSnapshot(root), 'codex', 'run-preview', (changedPath) => {
      previews.push({ path: changedPath, diff: effectPackageDiff(vfs.toEffectPackage('', 0, 0)) });
    });

    vfs.write(filePath, 'export const value = 2;\n');

    expect(previews).toHaveLength(1);
    expect(previews[0].path).toBe(filePath);
    expect(previews[0].diff).toContain('-export const value = 1;');
    expect(previews[0].diff).toContain('+export const value = 2;');
  });
});
