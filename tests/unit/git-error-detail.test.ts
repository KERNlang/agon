import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot, currentBranch, isDirty } from '../../packages/core/src/blocks/git.js';

it('keeps compatibility Git exports bound to the shared worktree owner', async () => {
  const compatibility = await import('../../packages/core/src/blocks/git.js');
  const owner = await import('@kernlang/agon-support-worktree');
  const names = [
    'repoRoot', 'headSha', 'worktreePrune', 'activeWorktrees', 'registerExitHooks',
    'worktreeCreate', 'absoluteGitDir', 'branchExists', 'worktreeAddOnBranch',
    'worktreeRemove', 'worktreeRemoveBestEffort', 'worktreePruneAll', 'worktreePruneOrphaned',
    'worktreeChangedDiff', 'worktreeChangedShortstat', 'stashSnapshot', 'worktreeDiff',
    'readOnlyDiff', 'diffLineCount', 'diffFileCount', 'applyPatch', 'currentBranch', 'isDirty',
    'recentCommits', 'coAuthorTrailer', 'appendCoAuthor', 'AGON_ATTRIBUTION',
    'AGON_ATTRIBUTION_PR', 'appendAttribution', 'appendPrAttribution',
    'normalizeGitHubRemote', 'githubRepoUrl', 'defaultBaseBranch', 'prefilledPrUrl',
    'gitStatusShort', 'gitDiffStat', 'gitChangedFiles', 'gitTruncatedDiff',
    'linkWorktreeNodeModules', 'hydrateWorktreeBuildArtifacts',
  ] as const;
  expect(Object.keys(compatibility).sort()).toEqual([...names].sort());
  for (const name of names) {
    expect(compatibility[name], name).toBeDefined();
    expect(compatibility[name], name).toBe(owner[name]);
  }
});

// Pins the git() failure-detail precedence: stderr FIRST, then stdout, then
// the raw spawn message. Git puts its diagnosis ('fatal: not a git
// repository…') on stderr; degrading to err.message buries that diagnosis
// behind node's generic "Command failed: git …" wrapper, which is what every
// GitError consumer surfaces to the user.

const dirs: string[] = [];

function nonRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-nongit-'));
  dirs.push(dir);
  return dir;
}

/** What git itself reports on stderr for the same failing invocation. */
function directStderr(args: string[], cwd: string): string {
  try {
    execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: string | Buffer };
    const raw = Buffer.isBuffer(e.stderr) ? e.stderr.toString('utf-8') : (e.stderr ?? '');
    return raw.trim();
  }
  return '';
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('git() error detail', () => {
  it("surfaces git's own stderr, not node's 'Command failed' wrapper", () => {
    const dir = nonRepoDir();
    const stderr = directStderr(['rev-parse', '--show-toplevel'], dir);
    // Guard the fixture: if this ever comes back empty the assertion below
    // would be vacuous.
    expect(stderr.length).toBeGreaterThan(0);

    let message = '';
    try {
      repoRoot(dir);
      throw new Error('repoRoot should have thrown outside a git repository');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe(`git rev-parse failed: ${stderr}`);
    expect(message).not.toContain('Command failed');
  });

  it('keeps the callers that swallow the failure working', () => {
    const dir = nonRepoDir();
    expect(currentBranch(dir)).toBe('unknown');
    expect(isDirty(dir)).toBe(false);
  });
});
