import { isProtectedPushBranch } from './workflow.js';

export interface ConquerPublicationOptions {
  readonly cwd: string;
  readonly task: string;
  readonly expectedBranch?: string;
  readonly commitBody: () => string;
  readonly protectedPushBranches?: readonly string[];
}

export type ConquerPublicationGit = (args: string[], timeout: number) => Promise<{
  exitCode: number; stdout: string; stderr: string;
  timedOut?: boolean; aborted?: boolean;
}>;

export type ConquerPublicationResult =
  | { ok: true; branch: string }
  | { ok: false; stage: 'branch' | 'add' | 'status' | 'commit' | 'push'; branch: string; message: string;
      remoteOutcome?: 'not-attempted' | 'unknown' };

/** Publish a verified Conquer result after the caller approves the push. */
export async function publishConquerBranch(
  options: ConquerPublicationOptions,
  git: ConquerPublicationGit,
): Promise<ConquerPublicationResult> {
  let stage: Extract<ConquerPublicationResult, { ok: false }>['stage'] = 'branch';
  let branch = options.expectedBranch ?? '';
  try {
    const resolved = await git(['rev-parse', '--abbrev-ref', 'HEAD'], 15_000);
    branch = String(resolved.stdout ?? '').trim();
    if (resolved.exitCode !== 0 || resolved.timedOut || resolved.aborted || !branch || branch === 'HEAD') {
      return { ok: false, stage: 'branch', branch,
        message: "Could not resolve a branch to push (detached HEAD?). The builder's changes are uncommitted in the tree — review + commit + push manually." };
    }
    if (options.expectedBranch !== undefined && branch !== options.expectedBranch) {
      return { ok: false, stage: 'branch', branch,
        message: `Conquer branch changed from '${options.expectedBranch}' to '${branch}'. Refusing publication; review the worktree at ${options.cwd}.` };
    }
    if (isProtectedPushBranch(branch, options)) {
      return { ok: false, stage: 'branch', branch,
        message: `Refusing to push protected branch '${branch}' from an unattended run. The work is in the worktree at ${options.cwd} — review and push it manually (or set protectedPushBranches in config).` };
    }
    stage = 'add';
    const added = await git(['add', '-A'], 30_000);
    if (added.exitCode !== 0 || added.timedOut || added.aborted) {
      return { ok: false, stage: 'add', branch,
        message: `git add failed: ${String(added.stderr ?? '').slice(0, 200)} — review the tree manually.` };
    }
    stage = 'status';
    const staged = await git(['diff', '--cached', '--quiet', '--exit-code'], 15_000);
    if (staged.timedOut || staged.aborted || (staged.exitCode !== 0 && staged.exitCode !== 1)) {
      return { ok: false, stage: 'status', branch,
        message: `git staged-change check failed: ${String(staged.stderr ?? '').slice(0, 200)} — review the tree manually.` };
    }
    // A builder can commit its own changes. Do not create an empty second commit.
    if (staged.exitCode === 1) {
      stage = 'commit';
      const committed = await git(['commit', '-m', `conquer: ${options.task}`, '-m', options.commitBody()], 30_000);
      if (committed.exitCode !== 0 || committed.timedOut || committed.aborted) {
        return { ok: false, stage: 'commit', branch,
          message: `git commit failed: ${String(committed.stderr ?? '').slice(0, 200)} — review the tree manually.` };
      }
    }
    if (options.expectedBranch !== undefined) {
      stage = 'branch';
      const current = await git(['rev-parse', '--abbrev-ref', 'HEAD'], 15_000);
      if (current.exitCode !== 0 || current.timedOut || current.aborted || current.stdout.trim() !== branch) {
        return { ok: false, stage: 'branch', branch,
          message: `Conquer branch changed or could not be verified before push. Refusing publication; review the worktree at ${options.cwd}.` };
      }
    }
    stage = 'push';
    const pushed = await git(['push', '-u', 'origin', branch], 120_000);
    if (pushed.exitCode !== 0 || pushed.timedOut || pushed.aborted) {
      return { ok: false, stage: 'push', branch, remoteOutcome: 'unknown',
        message: `git push failed: ${String(pushed.stderr ?? '').slice(0, 200)} — remote outcome is unknown. Inspect origin and local branch ${branch} before retrying.` };
    }
    return { ok: true, branch };
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error).slice(0, 200);
    const recovery = stage === 'push'
      ? 'Remote outcome is unknown. Inspect origin and the local branch before retrying.'
      : 'Push was not attempted. Inspect the retained worktree before retrying.';
    return { ok: false, stage, branch, remoteOutcome: stage === 'push' ? 'unknown' : 'not-attempted',
      message: `Conquer publication stopped during ${stage}: ${detail}. ${recovery} Worktree: ${options.cwd}` };
  }
}
