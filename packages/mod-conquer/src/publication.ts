import { isProtectedPushBranch } from './workflow.js';

export interface ConquerPublicationOptions {
  readonly cwd: string;
  readonly task: string;
  readonly commitBody: () => string;
  readonly protectedPushBranches?: readonly string[];
}

export type ConquerPublicationGit = (args: string[], timeout: number) => Promise<{
  exitCode: number; stdout: string; stderr: string;
}>;

export type ConquerPublicationResult =
  | { ok: true; branch: string }
  | { ok: false; stage: 'branch' | 'add' | 'commit' | 'push'; branch: string; message: string };

/** Publish a verified Conquer result after the caller approves the push. */
export async function publishConquerBranch(
  options: ConquerPublicationOptions,
  git: ConquerPublicationGit,
): Promise<ConquerPublicationResult> {
  const resolved = await git(['rev-parse', '--abbrev-ref', 'HEAD'], 15_000);
  const branch = String(resolved.stdout ?? '').trim();
  if (resolved.exitCode !== 0 || !branch || branch === 'HEAD') {
    return { ok: false, stage: 'branch', branch,
      message: "Could not resolve a branch to push (detached HEAD?). The builder's changes are uncommitted in the tree — review + commit + push manually." };
  }
  if (isProtectedPushBranch(branch, options)) {
    return { ok: false, stage: 'branch', branch,
      message: `Refusing to push protected branch '${branch}' from an unattended run. The work is in the worktree at ${options.cwd} — review and push it manually (or set protectedPushBranches in config).` };
  }
  const added = await git(['add', '-A'], 30_000);
  if (added.exitCode !== 0) {
    return { ok: false, stage: 'add', branch,
      message: `git add failed: ${String(added.stderr ?? '').slice(0, 200)} — review the tree manually.` };
  }
  const committed = await git(['commit', '-m', `conquer: ${options.task}`, '-m', options.commitBody()], 30_000);
  if (committed.exitCode !== 0) {
    return { ok: false, stage: 'commit', branch,
      message: `git commit failed: ${String(committed.stderr ?? '').slice(0, 200)} — review the tree manually.` };
  }
  const pushed = await git(['push', '-u', 'origin', branch], 120_000);
  if (pushed.exitCode !== 0) {
    return { ok: false, stage: 'push', branch,
      message: `git push failed: ${String(pushed.stderr ?? '').slice(0, 200)} — committed locally on ${branch}; push it manually.` };
  }
  return { ok: true, branch };
}
