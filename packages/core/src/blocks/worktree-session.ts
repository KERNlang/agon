/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-worktree. */
import {
  createSessionWorktree as createModularSessionWorktree,
  findSessionWorktree as findModularSessionWorktree,
  listSessionWorktrees as listModularSessionWorktrees,
  pruneSessionWorktrees as pruneModularSessionWorktrees,
  rehydrateSessionWorktree as rehydrateModularSessionWorktree,
  removeSessionWorktree as removeModularSessionWorktree,
  sessionWorktreesDir as modularSessionWorktreesDir,
  worktreePathFor as modularWorktreePathFor,
  type SessionWorktree,
  type WorktreeSessionRuntime,
} from "@kernlang/agon-support-worktree";

import { ensureAgonHome, getAgonHome } from "../signals/config.js";
import {
  absoluteGitDir,
  hydrateWorktreeBuildArtifacts,
  isDirty,
  linkWorktreeNodeModules,
  worktreeAddOnBranch,
  worktreePrune,
  worktreeRemoveBestEffort,
} from "./git.js";

const compatibilityRuntime: WorktreeSessionRuntime = Object.freeze<WorktreeSessionRuntime>({
  absoluteGitDir,
  ensureAgonHome,
  getAgonHome,
  hydrateWorktreeBuildArtifacts,
  isDirty,
  linkWorktreeNodeModules,
  worktreeAddOnBranch,
  worktreePrune,
  worktreeRemoveBestEffort,
});

export function sessionWorktreesDir(repoRoot: string): string {
  return modularSessionWorktreesDir(repoRoot, compatibilityRuntime);
}

export function worktreePathFor(repoRoot: string, branch: string): string {
  return modularWorktreePathFor(repoRoot, branch, compatibilityRuntime);
}

export function createSessionWorktree(opts: { repoRoot: string; branch: string; base?: string; link?: boolean }): SessionWorktree {
  return createModularSessionWorktree(opts, compatibilityRuntime);
}

export function listSessionWorktrees(repoRoot: string): SessionWorktree[] {
  return listModularSessionWorktrees(repoRoot, compatibilityRuntime);
}

export function findSessionWorktree(repoRoot: string, branch: string): SessionWorktree | null {
  return findModularSessionWorktree(repoRoot, branch, compatibilityRuntime);
}

export function removeSessionWorktree(repoRoot: string, branch: string, force?: boolean): boolean {
  return removeModularSessionWorktree(repoRoot, branch, force, compatibilityRuntime);
}

export function pruneSessionWorktrees(repoRoot: string, olderThanMs: number, dryRun?: boolean, force?: boolean): string[] {
  return pruneModularSessionWorktrees(repoRoot, olderThanMs, dryRun, force, compatibilityRuntime);
}

export function rehydrateSessionWorktree(repoRoot: string, branch: string): boolean {
  return rehydrateModularSessionWorktree(repoRoot, branch, compatibilityRuntime);
}

export * from "@kernlang/agon-support-worktree";
