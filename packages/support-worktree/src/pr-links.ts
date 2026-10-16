import { execFileSync } from 'node:child_process';

/** Read local Git metadata. Callers supply their documented fallback on error. */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd, encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Normalize a github.com remote URL (scp-like ssh, ssh://, http(s), with/without .git) to https://github.com/<org>/<repo>. Returns '' for non-GitHub or unparseable remotes — callers then skip the prefilled-PR link and just print the PR text. Pure; exported for unit tests.
 */
export function normalizeGitHubRemote(url: string): string {
  const u = url.trim();
  let m = u.match(/^(?:ssh:\/\/)?git@github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  m = u.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  return '';
}

/**
 * https://github.com/<org>/<repo> for the given remote (default 'origin'), or '' (no such remote / not GitHub). Callers that push to a --remote MUST pass it through so the PR link targets the repo that actually received the branch.
 */
export function githubRepoUrl(cwd: string, remote?: string): string {
  try {
    return normalizeGitHubRemote(git(['remote', 'get-url', remote ?? 'origin'], cwd));
  } catch {
    return '';
  }
}

/**
 * The remote default branch for the given remote (default 'origin'). Resolution order, all local (never hits the network): <remote>/HEAD symbolic-ref → an existing refs/remotes/<remote>/main → …/master → 'main'. The existence probes cover clones where <remote>/HEAD was never populated but the real default branch is fetched. Used as the PR base for prefilled compare links.
 */
export function defaultBaseBranch(cwd: string, remote?: string): string {
  const r = remote ?? 'origin';
  try {
    const ref = git(['symbolic-ref', '--short', `refs/remotes/${r}/HEAD`], cwd).trim();
    const name = ref.startsWith(`${r}/`) ? ref.slice(r.length + 1) : ref;
    if (name) return name;
  } catch { /* fall through to existence probes */ }
  for (const candidate of ['main', 'master']) {
    try {
      git(['show-ref', '--verify', '--quiet', `refs/remotes/${r}/${candidate}`], cwd);
      return candidate;
    } catch { /* try next */ }
  }
  return 'main';
}

/**
 * GitHub compare URL with ?quick_pull=1&title=…&body=… — clicking it opens the new-PR form already filled in. This is agon's no-gh PR path: after a push, the human clicks the link and merges; no GitHub CLI/token needed. The title is clamped to 256 chars and the body shrunk until the whole URL fits in ~7500 chars (GitHub/browsers reject very long URLs) — callers print the full body in the terminal first so nothing is lost. Returns '' when repoUrl is empty. Pure; exported for unit tests.
 */
export function prefilledPrUrl(opts: {repoUrl:string,base:string,branch:string,title:string,body:string}): string {
  if (!opts.repoUrl) return '';
  const head = `${opts.repoUrl}/compare/${encodeURIComponent(opts.base)}...${encodeURIComponent(opts.branch)}?quick_pull=1&title=${encodeURIComponent(opts.title.slice(0, 256))}`;
  let url = `${head}&body=${encodeURIComponent(opts.body)}`;
  const note = '\n\n…(body truncated — the full description was printed in the terminal)';
  let keep = opts.body.length;
  while (url.length > 7500 && keep > 0) {
    keep = Math.floor(keep * 0.7);
    url = `${head}&body=${encodeURIComponent(opts.body.slice(0, keep) + note)}`;
  }
  return url;
}
