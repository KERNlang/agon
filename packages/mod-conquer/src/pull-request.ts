import { prefilledPrUrl } from '@kernlang/agon-support-worktree';
import type { ConquerPublicationGit } from './publication.js';

export interface ConquerPrDraft {
  engineId: string;
  intent: string;
  context: string;
  commits: string;
  diff: string;
}

export interface ConquerPullRequest {
  title: string;
  body: string;
  url: string;
  mergeHint: string;
  usedTemplate: boolean;
}

export interface ConquerPrEffects {
  git: ConquerPublicationGit;
  draft?(input: ConquerPrDraft): Promise<{ ok: boolean; title: string; body: string }>;
  formatBody?(body: string): string;
}

/** Prepare a human merge handoff. Never publish a PR or retry the push. */
export async function prepareConquerPullRequest(options: {
  task: string; claim: string; gate: string; builder: string;
  branch: string; base: string; repoUrl: string;
}, effects: ConquerPrEffects): Promise<ConquerPullRequest> {
  let title = `conquer: ${options.task}`.slice(0, 72);
  let body = options.claim;
  let usedTemplate = true;
  if (options.branch !== options.base && effects.draft) {
    try {
      const log = await effects.git(['log', '--oneline', `origin/${options.base}..HEAD`], 15_000);
      const diff = await effects.git(['diff', `origin/${options.base}...HEAD`], 30_000);
      const rawDiff = diff.exitCode === 0 && !diff.timedOut && !diff.aborted ? diff.stdout : '';
      const lines = rawDiff.split('\n');
      const drafted = await effects.draft({
        engineId: options.builder, intent: options.task,
        context: `Builder's verified done-claim: ${options.claim}\nAcceptance gate (passed): ${options.gate}`,
        commits: log.exitCode === 0 && !log.timedOut && !log.aborted ? log.stdout.trim() : '',
        diff: lines.length > 1200 ? `${lines.slice(0, 1200).join('\n')}\n... (${lines.length - 1200} more lines)` : rawDiff,
      });
      if (drafted.ok && drafted.title.trim() && drafted.body.trim()) {
        title = drafted.title; body = drafted.body; usedTemplate = false;
      }
    } catch { /* The completed push remains successful when optional prose fails. */ }
  }
  try { body = effects.formatBody?.(body) ?? body; }
  catch { /* Keep the full body if optional attribution fails. */ }
  let url = '';
  try {
    if (options.branch !== options.base) url = prefilledPrUrl({
      repoUrl: options.repoUrl, base: options.base, branch: options.branch, title, body,
    });
  } catch { /* Invalid text must not hide a successfully pushed branch. */ }
  return { title, body, url, usedTemplate,
    mergeHint: url ? `Open the PR (form prefilled with the text above): ${url}`
      : `Open a PR from ${options.branch} to review + merge — this is your merge gate.` };
}
