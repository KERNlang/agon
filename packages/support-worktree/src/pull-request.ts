import { prefilledPrUrl } from './pr-links.js';

export interface PullRequestDraft {
  engineId: string;
  intent: string;
  context: string;
  commits: string;
  diff: string;
}

export interface PreparedPullRequest {
  title: string;
  body: string;
  url: string;
  mergeHint: string;
  usedTemplate: boolean;
}

export interface PullRequestEffects {
  git(args: string[], timeout: number): Promise<{
    exitCode: number; stdout: string; stderr: string; timedOut?: boolean; aborted?: boolean;
  }>;
  draft?(input: PullRequestDraft): Promise<{ ok: boolean; title: string; body: string }>;
  formatBody?(body: string): string;
}

/** Prepare a human merge handoff. Never publish a PR or retry a push. */
export async function preparePullRequest(options: {
  title: string; body: string; context: string; intent: string; engineId: string;
  branch: string; base: string; remote: string; repoUrl: string;
}, effects: PullRequestEffects): Promise<PreparedPullRequest> {
  let title = options.title;
  let body = options.body;
  let usedTemplate = true;
  if (options.branch !== options.base && effects.draft) {
    try {
      const log = await effects.git(['log', '--oneline', `${options.remote}/${options.base}..HEAD`], 15_000);
      const diff = await effects.git(['diff', `${options.remote}/${options.base}...HEAD`], 30_000);
      const rawDiff = diff.exitCode === 0 && !diff.timedOut && !diff.aborted ? diff.stdout : '';
      const lines = rawDiff.split('\n');
      const drafted = await effects.draft({
        engineId: options.engineId, intent: options.intent, context: options.context,
        commits: log.exitCode === 0 && !log.timedOut && !log.aborted ? log.stdout.trim() : '',
        diff: lines.length > 1200 ? `${lines.slice(0, 1200).join('\n')}\n... (${lines.length - 1200} more lines)` : rawDiff,
      });
      if (drafted.ok && drafted.title.trim() && drafted.body.trim()) {
        title = drafted.title; body = drafted.body; usedTemplate = false;
      }
    } catch { /* Optional prose cannot invalidate a completed push. */ }
  }
  try { body = effects.formatBody?.(body) ?? body; }
  catch { /* Retain the full body if optional formatting fails. */ }
  let url = '';
  try {
    if (options.branch !== options.base) url = prefilledPrUrl({
      repoUrl: options.repoUrl, base: options.base, branch: options.branch, title, body,
    });
  } catch { /* Keep manual recovery when a link cannot be encoded. */ }
  return { title, body, url, usedTemplate,
    mergeHint: url ? `Open the PR (form prefilled with the text above): ${url}`
      : `Open a PR from ${options.branch} to review + merge — this is your merge gate.` };
}
