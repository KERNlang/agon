import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReviewTarget } from '../../packages/support-verification/src/review-target.js';
import { resolveReviewTarget as cliResolveReviewTarget } from '../../packages/cli/src/handlers/review.js';
import { resolveReviewTarget as publicResolveReviewTarget } from '@kernlang/agon-support-verification';

let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitFile = (name: string, content: string) => {
  writeFileSync(join(root, name), content);
  git('add', '--', name);
  git('commit', '-m', name);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-review-contract-'));
  git('init', '-b', 'main');
  git('config', 'user.name', 'Review fixture');
  git('config', 'user.email', 'review@example.test');
  commitFile('base.txt', 'base\n');
  git('switch', '-c', 'feature');
  commitFile('feature.txt', 'requested branch\n');
  git('switch', '-c', 'other', 'main');
  commitFile('other.txt', 'ambient checkout\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('shared Review target contract', () => {
  it('keeps the legacy CLI export bound to the shared public resolver', () => {
    expect(cliResolveReviewTarget).toBe(publicResolveReviewTarget);
  });
  it('reviews the named branch with an explicit base, not the ambient checkout', () => {
    const result = resolveReviewTarget('branch:feature', root, 'main');
    expect(result.diff).toBe(git('diff', 'main...feature'));
    expect(result.diff).toContain('requested branch');
    expect(result.diff).not.toContain('ambient checkout');
    expect(result.label).toBe('branch feature vs main');
  });

  it('auto-bases the current feature branch and labels that choice', () => {
    git('switch', 'feature');
    const result = resolveReviewTarget('branch:feature', root);
    expect(result.diff).toBe(git('diff', 'main...feature'));
    expect(result.label).toBe('branch feature vs main (auto-base)');
  });

  it('rejects an implicit self-diff on the default branch', () => {
    git('switch', 'main');
    expect(() => resolveReviewTarget('branch:main', root)).toThrow(/no base branch/);
  });

  it.each(['..', '...'])('preserves the explicit %s range independently of checkout', separator => {
    const range = `other${separator}feature`;
    expect(resolveReviewTarget(`range:${range}`, root).diff).toBe(git('diff', range));
  });

  it('retains base-to-HEAD semantics when a different branch is supplied without a base', () => {
    expect(resolveReviewTarget('branch:main', root).diff).toBe(git('diff', 'main...HEAD'));
  });

  it('includes untracked text, marks binary data, and refuses symlinks', () => {
    writeFileSync(join(root, 'new.txt'), 'new text\n');
    writeFileSync(join(root, 'binary.dat'), Buffer.from([65, 0, 66]));
    symlinkSync('base.txt', join(root, 'linked.txt'));
    const { diff } = resolveReviewTarget('uncommitted', root);
    expect(diff).toContain('+new text');
    expect(diff).toContain('[binary or unreadable]');
    expect(diff).not.toContain('\0');
    expect(diff).not.toContain('linked.txt');
  });

  it.each(['branch:-R', 'commit:--stat', 'range:main...--stat'])('rejects Git options in %s', target => {
    expect(() => resolveReviewTarget(target, root)).toThrow(/unsafe Git ref/);
  });

  it('caps large review output and reports the truncation', () => {
    writeFileSync(join(root, 'base.txt'), 'long changed line\n'.repeat(10000));
    const { diff } = resolveReviewTarget('uncommitted', root);
    expect(diff).toHaveLength(100000 + '\n... [truncated — diff exceeds 100K chars]'.length);
    expect(diff).toContain('[truncated');
  });

  it.each(['main..feature..other', 'main...feature...other'])('rejects extra range endpoints in %s', range => {
    expect(() => resolveReviewTarget(`range:${range}`, root)).toThrow(/Bad range/);
  });

  it.each(['é.txt', 'tab\tname.txt', 'line\nname.txt', ' spaced.txt'])('includes untracked filename %j', name => {
    writeFileSync(join(root, name), 'unusual filename content\n');
    expect(resolveReviewTarget('uncommitted', root).diff).toContain('+unusual filename content');
  });

  it('does not use legacy master as a base when reviewing main itself', () => {
    git('branch', 'master', 'feature');
    git('switch', 'main');
    expect(() => resolveReviewTarget('branch:main', root)).toThrow(/no base branch/);
    expect(() => resolveReviewTarget('branch:refs/heads/main', root)).toThrow(/no base branch/);
  });

  it('requires a commit rather than a blob for commit targets', () => {
    expect(() => resolveReviewTarget('commit:HEAD:base.txt', root)).toThrow();
  });

  it('resolves a valid base even when a working-tree path has the same name', () => {
    commitFile('main', 'path named main\n');
    expect(resolveReviewTarget('uncommitted', root, 'main').diff).toBe(git('diff', 'main', '--'));
  });

  it('falls back from a stale remote default that names the current feature', () => {
    git('switch', 'feature');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature');
    expect(resolveReviewTarget('branch:feature', root).diff).toBe(git('diff', 'main...feature'));
  });

  it('uses a valid custom remote default and refuses its fully qualified self-diff', () => {
    git('update-ref', 'refs/remotes/origin/trunk', git('rev-parse', 'main'));
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    git('switch', 'feature');
    expect(resolveReviewTarget('branch:feature', root).label).toBe('branch feature vs origin/trunk (auto-base)');
    git('switch', '-c', 'trunk', 'main');
    expect(() => resolveReviewTarget('branch:refs/heads/trunk', root)).toThrow(/no base branch/);
  });

  it.each(['--stat', 'main\nother', 'main\0other', 'main\rother'])('rejects unsafe base %j', base => {
    expect(() => resolveReviewTarget('uncommitted', root, base)).toThrow(/unsafe Git ref/);
  });

  it.each(['commit:HEAD', 'range:main...feature'])('rejects --base with %s', target => {
    expect(() => resolveReviewTarget(target, root, 'main')).toThrow(/--base does not apply/);
  });

  it('keeps commit target output equal to the requested Git commit', () => {
    expect(resolveReviewTarget('commit:feature', root).diff).toBe(git('show', 'feature'));
  });

  it('includes committed, staged, unstaged and untracked changes against an explicit base', () => {
    writeFileSync(join(root, 'base.txt'), 'staged\n');
    git('add', 'base.txt');
    writeFileSync(join(root, 'base.txt'), 'unstaged\n');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    const { diff } = resolveReviewTarget('uncommitted', root, 'main');
    expect(diff).toContain('+ambient checkout');
    expect(diff).toContain('+unstaged');
    expect(diff).toContain('+untracked');
    expect(diff).not.toContain('+staged');
  });

  it('reports an explicit self-diff as empty without choosing another target', () => {
    expect(resolveReviewTarget('branch:feature', root, 'feature').diff).toBe('');
  });
});
