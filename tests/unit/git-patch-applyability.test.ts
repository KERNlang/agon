import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyPatchToTree } from '../../packages/core/src/patch-apply.js';
import { worktreeDiff } from '../../packages/core/src/git.js';

const tempRoots: string[] = [];

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function createRepo(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `agon-git-patch-${label}-`));
  tempRoots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Agon Test']);
  git(root, ['config', 'user.email', 'agon@example.com']);
  writeFileSync(join(root, 'README.md'), '# test\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('git patch applyability', () => {
  it('keeps worktreeDiff patch output applyable when the last hunk has no file newline', async () => {
    const repo = createRepo('worktree-diff');
    const clean = join(repo, '..', `${repo.split('/').pop()}-clean`);
    tempRoots.push(clean);
    git(repo, ['worktree', 'add', '--detach', clean, 'HEAD']);

    try {
      writeFileSync(join(repo, 'created.txt'), 'no trailing newline');

      const patch = worktreeDiff(repo);
      expect(patch).toContain('created.txt');
      expect(patch.endsWith('\n')).toBe(true);

      execFileSync('git', ['apply', '--check', '-'], {
        cwd: clean,
        input: patch,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } finally {
      try { git(repo, ['worktree', 'remove', clean, '--force']); } catch { /* best effort */ }
      try { git(repo, ['worktree', 'prune']); } catch { /* best effort */ }
    }
  });

  it('normalizes missing final patch newline before applying', async () => {
    const repo = createRepo('normalize-apply');
    const patch = [
      'diff --git a/created.txt b/created.txt',
      'new file mode 100644',
      'index 0000000..3b18e51',
      '--- /dev/null',
      '+++ b/created.txt',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n');

    const result = applyPatchToTree(repo, patch);

    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, 'created.txt'))).toBe(true);
    expect(readFileSync(join(repo, 'created.txt'), 'utf-8')).toBe('hello\n');
  });
});
