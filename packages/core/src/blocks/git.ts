/** Preserve legacy imports. Shared worktree support owns Git operations. */
export {
  repoRoot, headSha, worktreePrune, activeWorktrees, registerExitHooks,
  worktreeCreate, absoluteGitDir, branchExists, worktreeAddOnBranch,
  worktreeRemove, worktreeRemoveBestEffort, worktreePruneAll, worktreePruneOrphaned,
  worktreeChangedDiff, worktreeChangedShortstat, stashSnapshot, worktreeDiff,
  readOnlyDiff, diffLineCount, diffFileCount, applyPatch, currentBranch, isDirty,
  recentCommits, coAuthorTrailer, appendCoAuthor, AGON_ATTRIBUTION,
  AGON_ATTRIBUTION_PR, appendAttribution, appendPrAttribution,
  normalizeGitHubRemote, githubRepoUrl, defaultBaseBranch, prefilledPrUrl,
  gitStatusShort, gitDiffStat, gitChangedFiles, gitTruncatedDiff,
  linkWorktreeNodeModules, hydrateWorktreeBuildArtifacts,
} from '@kernlang/agon-support-worktree';
