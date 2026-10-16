import { preparePullRequest } from '@kernlang/agon-support-worktree';
import type { PullRequestDraft, PullRequestEffects, PreparedPullRequest } from '@kernlang/agon-support-worktree';

export type ConquerPrDraft = PullRequestDraft;
export type ConquerPrEffects = PullRequestEffects;
export type ConquerPullRequest = PreparedPullRequest;

/** Supply Conquer's verified claim to the shared PR preparation owner. */
export function prepareConquerPullRequest(options: {
  task: string; claim: string; gate: string; builder: string;
  branch: string; base: string; repoUrl: string;
}, effects: ConquerPrEffects): Promise<ConquerPullRequest> {
  return preparePullRequest({
    title: `conquer: ${options.task}`.slice(0, 72), body: options.claim,
    context: `Builder's verified done-claim: ${options.claim}\nAcceptance gate (passed): ${options.gate}`,
    intent: options.task, engineId: options.builder, branch: options.branch,
    base: options.base, remote: 'origin', repoUrl: options.repoUrl,
  }, effects);
}
