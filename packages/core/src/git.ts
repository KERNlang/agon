import { execFileSync } from 'node:child_process';
import { GitError, WorktreeError } from './errors.js';

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    throw new GitError(
      `git ${args[0]} failed: ${e.stderr?.trim() ?? 'unknown error'}`,
      e.status ?? 1,
    );
  }
}

/**
 * Get the repository root directory.
 */
export function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

/**
 * Get the current HEAD SHA.
 */
export function headSha(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd);
}

/**
 * Prune dead worktrees.
 */
export function worktreePrune(cwd: string): void {
  git(['worktree', 'prune'], cwd);
}

/**
 * Create a detached worktree at a given path from a SHA.
 */
export function worktreeCreate(repoDir: string, worktreePath: string, sha: string): string {
  worktreePrune(repoDir);
  try {
    git(['worktree', 'add', '--detach', worktreePath, sha], repoDir);
    return worktreePath;
  } catch (err) {
    throw new WorktreeError(
      `Failed to create worktree at ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Remove a worktree.
 */
export function worktreeRemove(repoDir: string, worktreePath: string): void {
  try {
    git(['worktree', 'remove', worktreePath, '--force'], repoDir);
  } catch {
    // Best effort — worktree may already be gone
  }
}

/**
 * Generate a diff of all changes in a worktree (staged + unstaged).
 */
export function worktreeDiff(cwd: string): string {
  git(['add', '-A'], cwd);
  return git(['diff', '--cached'], cwd);
}

/**
 * Get the number of changed lines in a diff.
 */
export function diffLineCount(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count++;
    if (line.startsWith('-') && !line.startsWith('---')) count++;
  }
  return count;
}

/**
 * Get the number of files changed.
 */
export function diffFileCount(cwd: string): number {
  try {
    const result = git(['diff', '--cached', '--name-only'], cwd);
    return result ? result.split('\n').filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply a patch to a worktree.
 */
export function applyPatch(cwd: string, patchContent: string): void {
  if (!patchContent.trim()) return;
  try {
    execFileSync('git', ['apply', '--allow-empty', '-'], {
      cwd,
      input: patchContent,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    throw new GitError(`Failed to apply patch: ${e.stderr?.trim() ?? 'unknown error'}`);
  }
}

/**
 * Get recent commit log.
 */
export function recentCommits(cwd: string, count = 10): string {
  try {
    return git(['log', '--oneline', `-${count}`], cwd);
  } catch {
    return '';
  }
}
