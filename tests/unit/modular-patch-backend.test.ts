import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as physical from '@kernlang/agon-support-worktree';
import { applyPatchToTree, preflightApply, applyPatchWithUndo, undoPatch } from '../../packages/core/src/blocks/patch-apply.js';

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agon-patch-owner-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, 'file.txt'), 'before\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}
const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n';
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('physical patch backend ownership', () => {
  it('exposes the actual backend through the support package, not a second core implementation', () => {
    expect(physical).toHaveProperty('preflightApply', preflightApply);
    expect(physical).toHaveProperty('applyPatchToTree', applyPatchToTree);
  });
  it('preserves clean preflight, real Git apply, and conflict refusal', () => {
    const cwd = fixture();
    const artifactRoot = mkdtempSync(join(tmpdir(), 'agon-patch-artifact-'));
    roots.push(artifactRoot);
    const artifact = join(artifactRoot, 'change.patch');
    writeFileSync(artifact, patch);
    expect(preflightApply(cwd, artifact, null)).toMatchObject({ ok: true, dirtyTree: false,
      patch: { content: patch, lineCount: 2, engineId: 'unknown' } });
    expect(applyPatchToTree(cwd, patch)).toEqual({ ok: true });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
    expect(applyPatchToTree(cwd, patch).ok).toBe(false);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
    expect(preflightApply(cwd, artifact, null)).toMatchObject({ ok: false, dirtyTree: true });
  });
  it('preserves failure without changing workspace bytes', () => {
    const cwd = fixture();
    expect(applyPatchToTree(cwd, patch.replace('@@ -1 +1 @@', '@@ broken @@')).ok).toBe(false);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });
  it.each(['compatibility', 'physical'])('preserves %s undo storage and restores the previous bytes', route => {
    const cwd = fixture();
    const home = mkdtempSync(join(tmpdir(), 'agon-patch-undo-'));
    roots.push(home);
    vi.stubEnv('AGON_HOME', home);
    const apply = route === 'physical'
      ? (content: string) => physical.applyPatchWithUndo(cwd, content, join(home, 'undo'))
      : (content: string) => applyPatchWithUndo(cwd, content);
    const undo = route === 'physical'
      ? (token: string) => physical.undoPatch(cwd, token, join(home, 'undo'))
      : (token: string) => undoPatch(cwd, token);
    const applied = apply(patch);
    expect(applied.ok).toBe(true);
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('after\n');
    expect(readFileSync(join(home, 'undo', `${applied.undoToken}.patch`), 'utf8')).toContain('+before');
    expect(undo(applied.undoToken!)).toEqual({ ok: true });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
    expect(undo('missing')).toEqual({ ok: false, error: 'Undo token not found: missing' });
  });
  it('preserves the empty-diff no-op contract', () => {
    const cwd = fixture();
    expect(applyPatchToTree(cwd, '')).toEqual({ ok: true });
    expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  });
});
