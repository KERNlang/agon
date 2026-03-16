import { execFileSync } from 'node:child_process';

import { GitError, WorktreeError } from './errors.js';

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf-8', timeout: 30_000,
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

export function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd);
  
}

export function headSha(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd);
  
}

export function worktreePrune(cwd: string): void {
  git(['worktree', 'prune'], cwd);
  
}

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

export function worktreeRemove(repoDir: string, worktreePath: string): void {
  try { git(['worktree', 'remove', worktreePath, '--force'], repoDir); } catch {}
  
}

export function worktreeDiff(cwd: string): string {
  git(['add', '-A'], cwd);
  return git(['diff', '--cached'], cwd);
  
}

export function diffLineCount(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count++;
    if (line.startsWith('-') && !line.startsWith('---')) count++;
  }
  return count;
  
}

export function diffFileCount(cwd: string): number {
  try {
    const result = git(['diff', '--cached', '--name-only'], cwd);
    return result ? result.split('\n').filter(Boolean).length : 0;
  } catch { return 0; }
  
}

export function applyPatch(cwd: string, patchContent: string): void {
  if (!patchContent.trim()) return;
  try {
    execFileSync('git', ['apply', '--allow-empty', '-'], {
      cwd, input: patchContent, encoding: 'utf-8', timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    throw new GitError(`Failed to apply patch: ${e.stderr?.trim() ?? 'unknown error'}`);
  }
  
}

export function currentBranch(cwd: string): string {
  try { return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd); }
  catch { return 'unknown'; }
  
}

export function isDirty(cwd: string): boolean {
  try { return git(['status', '--porcelain'], cwd).length > 0; }
  catch { return false; }
  
}

export function recentCommits(cwd: string, count?: number): string {
  try { return git(['log', '--oneline', `-${count ?? 10}`], cwd); }
  catch { return ''; }
  
}

