import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { lstatSync, openSync, readSync, closeSync, constants } from 'node:fs';

export interface ReviewTarget { readonly diff: string; readonly label: string }

function assertSafeRef(value: string): void {
  if (!value || value.startsWith('-') || /[\0\r\n]/.test(value)) {
    throw new TypeError(`unsafe Git ref: ${JSON.stringify(value)}`);
  }
}

function resolveCommit(ref: string, cwd: string): string {
  assertSafeRef(ref);
  return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    { cwd, encoding: 'utf8' }).trim();
}

/**
 * True when `ref^{commit}` resolves to a real commit in the given repo (best-effort: a git failure means it does not).
 */
function refResolvesToCommit(ref: string, cwd: string): boolean {
  try {
    resolveCommit(ref, cwd);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the base ref for reviewing the currently checked-out branch: the repo's default branch via origin/HEAD, falling back to origin/main, origin/master, main, master. Returns null when the only candidates ARE the branch being reviewed (i.e. you are on the default branch) or nothing resolves — callers keep the loud no-base error for that case.
 */
export function resolveAutoReviewBase(cwd: string, branch: string): string|null {
  const branchName = (ref: string) => ref.replace(/^refs\/(?:heads|remotes)\//, '').replace(/^origin\//, '');
  try {
    const sym = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: cwd, encoding: 'utf-8' }).trim();
    if (sym) {
      // origin/main
      const cand = sym.replace(/^refs\/remotes\//, '');
      // A stale origin/HEAD pointing at a pruned ref must not short-circuit the fallback chain — verify it resolves before trusting it.
      if (refResolvesToCommit(cand, cwd)) {
        if (branchName(cand) === branchName(branch)) return null;
        return cand;
      }
    }
  } catch (e) {
    // no origin/HEAD (local-only repo) — fall through to candidates
  }
  for (const fallbackCand of ['origin/main', 'origin/master', 'main', 'master']) {
    if (refResolvesToCommit(fallbackCand, cwd)) {
      if (branchName(fallbackCand) === branchName(branch)) return null;
      return fallbackCand;
    }
  }
  return null;
}

export function resolveReviewTarget(target: string|undefined, cwd: string, base?: string): ReviewTarget {
  const t = (target ?? 'uncommitted').trim();
  const baseRef = (base ?? '').trim();
  let diff = '';
  let label = '';

  if (baseRef && (t.startsWith('commit:') || t.startsWith('range:'))) {
    throw new Error(`--base does not apply to "${t}" — it composes with "uncommitted" or "branch:NAME". For an explicit two-ref diff use "range:BASE...TARGET".`);
  }
  if (baseRef) {
    assertSafeRef(baseRef);
    try { resolveCommit(baseRef, cwd); }
    catch { throw new Error(`--base "${baseRef}" does not resolve to a commit.`); }
  }

  if (t === 'uncommitted') {
    // With --base, the diff spans base..working-tree (committed-since-base AND
    // uncommitted changes); without it, HEAD..working-tree as before.
    label = baseRef ? `working tree vs ${baseRef}` : 'uncommitted changes';
    try {
      // Use git diff HEAD to get a single consistent diff against HEAD
      // (covers both staged and unstaged changes against the same base)
      diff = execFileSync('git', ['diff', resolveCommit(baseRef || 'HEAD', cwd), '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();

      // Also include untracked files so new files aren't silently omitted.
      // FU-6: read each untracked file directly and synthesize a git-style
      // diff in memory, instead of spawning a
      // `git diff --no-index` process per file. The old path was O(N)
      // sync spawns with a 5MB ExecFileSync buffer per file — both
      // ENOBUFS-prone on large refactors and a hard event-loop stall.
      const untrackedRaw = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      if (untrackedRaw) {
        const MAX_UNTRACKED_FILE_BYTES = 512 * 1024;   // skip files > 512KB
        const untrackedFiles = untrackedRaw.split('\0').filter(Boolean);
        const untrackedDiffs: string[] = [];
        const repoRoot = resolve(cwd);
        for (const f of untrackedFiles) {
          const quotePath = (path: string) => /[\s"\\]/.test(path) ? JSON.stringify(path) : path;
          const header = `diff --git ${quotePath('a/' + f)} ${quotePath('b/' + f)}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ ${quotePath('b/' + f)}\n`;
          try {
            const fullPath = resolve(repoRoot, f);
            if (fullPath !== repoRoot && !fullPath.startsWith(repoRoot + sep)) continue;
            const stat = lstatSync(fullPath);
            if (!stat.isFile()) continue;
            if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
              untrackedDiffs.push(`${header}@@ [untracked file ${JSON.stringify(f)} skipped — ${stat.size} bytes exceeds ${MAX_UNTRACKED_FILE_BYTES} byte cap] @@`);
              continue;
            }
            let content: string;
            let fd: number | undefined;
            try {
              fd = openSync(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
              const buffer = Buffer.alloc(MAX_UNTRACKED_FILE_BYTES + 1);
              const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
              if (bytesRead > MAX_UNTRACKED_FILE_BYTES) {
                untrackedDiffs.push(`${header}@@ [untracked file ${JSON.stringify(f)} skipped — exceeds ${MAX_UNTRACKED_FILE_BYTES} byte cap] @@`);
                continue;
              }
              content = buffer.subarray(0, bytesRead).toString('utf-8');
            } catch {
              untrackedDiffs.push(`${header}@@ [binary or unreadable] @@`);
              continue;
            } finally {
              if (fd !== undefined) {
                try { closeSync(fd); } catch { /* ignore close failures */ }
              }
            }
            if (content.includes('\u0000')) {
              untrackedDiffs.push(`${header}@@ [binary or unreadable] @@`);
              continue;
            }
            const lines = content.split('\n');
            // Drop a trailing empty line from the final newline so the
            // synthesized diff doesn't show a phantom blank-line addition.
            if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
            const plusBlock = lines.map((l) => `+${l}`).join('\n');
            untrackedDiffs.push(`${header}@@ -0,0 +1,${lines.length} @@\n${plusBlock}`);
          } catch { /* skip files we can't stat */ }
        }
        if (untrackedDiffs.length > 0) {
          diff = diff ? `${diff}\n\n${untrackedDiffs.join('\n\n')}` : untrackedDiffs.join('\n\n');
        }
      }
    } catch (err) {
      throw new Error(`Failed to get uncommitted diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (t.startsWith('range:')) {
    // Explicit two-ref scope: range:BASE...TARGET (merge-base diff) or
    // range:BASE..TARGET (direct diff). Checkout-independent — the diff base
    // is exactly what the caller named, never the current branch's state.
    const spec = t.slice(6);
    const sep = spec.includes('...') ? '...' : (spec.includes('..') ? '..' : '');
    const endpoints = sep ? spec.split(sep) : [];
    const [from, to] = endpoints;
    if (!sep || endpoints.length !== 2 || !from || !to) {
      throw new Error(`Bad range "${spec}". Use range:BASE...TARGET (merge-base diff) or range:BASE..TARGET (direct diff).`);
    }
    for (const ref of [from, to]) {
      assertSafeRef(ref);
      try { resolveCommit(ref, cwd); }
      catch { throw new Error(`range ref "${ref}" does not resolve to a commit.`); }
    }
    label = `range ${from}${sep}${to}`;
    try {
      diff = execFileSync('git', ['diff', `${resolveCommit(from, cwd)}${sep}${resolveCommit(to, cwd)}`, '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch (err) {
      throw new Error(`Failed to diff ${from}${sep}${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (t.startsWith('branch:')) {
    const branch = t.slice(7);
    assertSafeRef(branch);
    label = baseRef ? `branch ${branch} vs ${baseRef}` : `branch ${branch}`;
    if (baseRef) {
      // Explicit base: review BRANCH's changes relative to BASE, regardless of
      // what is currently checked out. No self-diff guard — an empty diff with
      // deliberate refs is a real answer, surfaced by the no-diff warning.
      try {
        diff = execFileSync('git', ['diff', `${resolveCommit(baseRef, cwd)}...${resolveCommit(branch, cwd)}`, '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
      } catch (err) {
        throw new Error(`Failed to diff ${baseRef}...${branch}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // `git diff BRANCH...HEAD` reviews HEAD's changes relative to BRANCH as the
      // base — correct when BRANCH is the base (e.g. branch:main). The footgun:
      // when BRANCH resolves to the same commit as HEAD (targeting the branch you
      // are currently on), it's an empty self-diff that surfaces as a silent
      // "No changes to review" — which a caller (or Cesar) can mistake for a clean
      // review. Detect that and fail LOUDLY with the right targets instead.
      let branchSha = '';
      let headSha = '';
      try {
        branchSha = resolveCommit(branch, cwd);
        headSha = resolveCommit('HEAD', cwd);
      } catch (err) {
        throw new Error(`Failed to resolve branch "${branch}": ${err instanceof Error ? err.message : String(err)}`);
      }
      if (branchSha && branchSha === headSha) {
        // Targeting the branch you are currently on. The previous behavior
        // was a loud error (itself a fix for the silent empty self-diff that
        // read as "clean review"), but the caller's question is unambiguous —
        // "this branch's commits vs its base" — so ANSWER it: auto-resolve
        // the base to the repo default branch and diff merge-base...branch.
        // The loud error remains only when no base can be resolved (you are
        // on the default branch itself, or there is no main/master anchor).
        const autoBase = resolveAutoReviewBase(cwd, branch);
        if (!autoBase) {
          throw new Error(`branch:${branch} points at the commit you are currently on and no base branch could be auto-resolved (are you on the default branch?). Use "range:BASE...${branch}" for an explicit two-ref diff, or "uncommitted" to review working-tree changes.`);
        }
        label = `branch ${branch} vs ${autoBase} (auto-base)`;
        try {
          diff = execFileSync('git', ['diff', `${resolveCommit(autoBase, cwd)}...${branchSha}`, '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
        } catch (err) {
          throw new Error(`Failed to diff ${autoBase}...${branch}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        try {
          diff = execFileSync('git', ['diff', `${branchSha}...${headSha}`, '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
        } catch (err) {
          throw new Error(`Failed to get branch diff for ${branch}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } else if (t.startsWith('commit:')) {
    const sha = t.slice(7);
    assertSafeRef(sha);
    label = `commit ${sha.slice(0, 8)}`;
    try {
      diff = execFileSync('git', ['show', resolveCommit(sha, cwd), '--'], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch (err) {
      throw new Error(`Failed to get commit ${sha}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    throw new Error(`Unknown review target: "${t}". Use "uncommitted", "branch:NAME", "commit:SHA", or "range:BASE...TARGET".`);
  }

  // Engine CLIs receive the review prompt as an argv string; Node refuses
  // argv entries containing NUL, so never let binary diff content through.
  diff = diff.replace(/\u0000/g, '');

  // Cap diff at 100K chars
  if (diff.length > 100_000) {
    diff = diff.slice(0, 100_000) + '\n... [truncated — diff exceeds 100K chars]';
  }

  return { diff, label };
}
