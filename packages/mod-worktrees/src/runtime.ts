import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { WorktreeSessionRuntime } from '@kernlang/agon-support-worktree';
import { linkWorktreeNodeModules, hydrateWorktreeBuildArtifacts } from '@kernlang/agon-support-worktree';
export { pruneEphemeralWorktrees } from '@kernlang/agon-support-worktree';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

export function repositoryRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

export function agonHome(): string {
  return resolve(process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'));
}

/** Keep setup failures visible to the worktrees command. */
export function linkDependencies(repoRoot: string, worktreePath: string): void {
  linkWorktreeNodeModules(repoRoot, worktreePath, { throwOnSetupError: true });
}

export function hydrateArtifacts(repoRoot: string, worktreePath: string): void {
  hydrateWorktreeBuildArtifacts(repoRoot, worktreePath, { throwOnSetupError: true });
}

export const sessionRuntime: WorktreeSessionRuntime = Object.freeze({
  getAgonHome: agonHome,
  ensureAgonHome(): void { mkdirSync(agonHome(), { recursive: true }); },
  worktreeAddOnBranch(repoRoot: string, path: string, branch: string, base?: string, link = true, fresh = false): string {
    git(repoRoot, ['worktree', 'prune']);
    if (fresh) git(repoRoot, ['worktree', 'add', '-b', branch, path, base?.trim() || 'HEAD']);
    else try { git(repoRoot, ['worktree', 'add', path, branch]); }
    catch { git(repoRoot, ['worktree', 'add', '-b', branch, path, base?.trim() || 'HEAD']); }
    if (link) { linkDependencies(repoRoot, path); hydrateArtifacts(repoRoot, path); }
    return path;
  },
  worktreeRemoveBestEffort(repoRoot: string, path: string): void {
    try { git(repoRoot, ['worktree', 'remove', '--force', '--', path]); }
    catch (error) { console.warn(`[agon] session worktree retained: ${error instanceof Error ? error.message : String(error)}`); }
  },
  linkWorktreeNodeModules: linkDependencies,
  hydrateWorktreeBuildArtifacts: hydrateArtifacts,
  absoluteGitDir(cwd: string): string { return git(cwd, ['rev-parse', '--absolute-git-dir']); },
  isDirty(cwd: string): boolean { return git(cwd, ['status', '--porcelain']).length > 0; },
  worktreePrune(cwd: string): void { git(cwd, ['worktree', 'prune']); },
});

export function runDependencyInstall(packageManager: string | null, cwd: string): { ok: boolean; command: string; message?: string } {
  const command = packageManager || 'npm';
  try {
    execFileSync(command, ['install'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, command };
  } catch (error) {
    return { ok: false, command, message: error instanceof Error ? error.message : String(error) };
  }
}

export function parseDuration(value: string): number | null {
  const match = /^(\d+)\s*([dhm])$/.exec(value.trim());
  if (!match) return null;
  const amount = Number.parseInt(match[1], 10);
  return match[2] === 'd' ? amount * 86_400_000 : match[2] === 'h' ? amount * 3_600_000 : amount * 60_000;
}
