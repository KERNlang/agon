import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, InvocationContext, Json } from '@kernlang/agon-mod-api';
import { hydrateWorktreeBuildArtifacts, linkWorktreeNodeModules, readWorktreeSource } from '@kernlang/agon-support-worktree';
import { runFitnessCommand } from '@kernlang/agon-support-verification';

export interface GoalDryRunPlan {
  readonly id: string;
  readonly intent: string;
  readonly branch: string;
  readonly gate: string;
  readonly gateTimeout: number;
  readonly maxAttempts: number;
  readonly budgetUsd: number;
  readonly maxHours: number;
  readonly tasks: readonly unknown[];
  readonly resume: boolean;
  readonly baseSha?: string;
}

const git = (cwd: string, args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function branchExists(repoRoot: string, branch: string): boolean {
  try { git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

/**
 * Check the gate on a private clone, because `git worktree add` writes branch and
 * worktree records into the user's repository. --shared borrows objects read-only.
 */
export async function runGoalDryRun(plan: GoalDryRunPlan, context: InvocationContext, assertCurrent: () => void): Promise<CommandResult> {
  let repoRoot: string;
  let baseSha: string;
  try {
    const source = readWorktreeSource(context.cwd);
    repoRoot = source.repoRoot;
    baseSha = plan.baseSha ?? source.baseSha;
    git(repoRoot, ['check-ref-format', '--branch', plan.branch]);
  } catch (error) {
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  if (!plan.resume && branchExists(repoRoot, plan.branch)) {
    return { exitCode: 1, stderr: `Goal branch already exists: ${plan.branch}; pass resume=true.\n` };
  }
  const root = mkdtempSync(join(tmpdir(), 'agon-goal-dry-run-'));
  try {
    const tree = join(root, 'tree');
    try {
      git(root, ['clone', '--quiet', '--shared', '--no-checkout', '--', repoRoot, tree]);
      git(tree, ['checkout', '--quiet', '--detach', baseSha]);
      linkWorktreeNodeModules(repoRoot, tree);
      hydrateWorktreeBuildArtifacts(repoRoot, tree);
    } catch (error) {
      return { exitCode: 1, stderr: `Goal dry run could not prepare a private clone: ${error instanceof Error ? error.message : String(error)}\n` };
    }
    const baseline = await runFitnessCommand(plan.gate, tree, plan.gateTimeout, context.signal);
    assertCurrent();
    if (baseline.aborted) {
      return { exitCode: 1, stderr: 'Goal dry run cancelled before the gate finished.\n' };
    }
    if (baseline.exitCode !== 0 || baseline.timedOut) {
      return {
        exitCode: 1,
        stderr: `Goal gate is red at base; refusing to start.\n${baseline.stderr}`,
        failure: { code: 'GOAL_BASELINE_RED', message: 'Goal gate must pass before task work', retryable: false },
      };
    }
    const result = {
      dryRun: true,
      state: { id: plan.id, intent: plan.intent, branch: plan.branch, gate: plan.gate, baseSha,
        status: 'planned', maxAttempts: plan.maxAttempts, budgetUsd: plan.budgetUsd, maxHours: plan.maxHours,
        tasks: plan.tasks },
      baseline,
      runDir: null,
    };
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result: result as unknown as Json };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
