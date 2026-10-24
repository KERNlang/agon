/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-worktree. */
import {
  acquireApplyLock as acquireModularApplyLock,
  branchChanged as modularBranchChanged,
  headChanged as modularHeadChanged,
  releaseApplyLock as releaseModularApplyLock,
  type ApplyLockResult,
  type WorktreeLockRuntime,
} from "@kernlang/agon-support-worktree";

import { absoluteGitDir, currentBranch, headSha } from "./git.js";

const compatibilityRuntime: WorktreeLockRuntime = Object.freeze<WorktreeLockRuntime>({ absoluteGitDir, currentBranch, headSha });

export function acquireApplyLock(cwd: string, action?: string): ApplyLockResult {
  return acquireModularApplyLock(cwd, action, compatibilityRuntime);
}

export function releaseApplyLock(cwd: string, sessionUUID: string): void {
  releaseModularApplyLock(cwd, sessionUUID, compatibilityRuntime);
}

export function headChanged(cwd: string, expectedSha: string | null): { changed: boolean; current: string | null } {
  return modularHeadChanged(cwd, expectedSha, compatibilityRuntime);
}

export function branchChanged(cwd: string, expectedBranch: string | null): { changed: boolean; current: string | null } {
  return modularBranchChanged(cwd, expectedBranch, compatibilityRuntime);
}

export * from "@kernlang/agon-support-worktree";
