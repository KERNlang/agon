import { readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { isSecretPath } from './secret-redaction.js';

/**
 * Repo grounding: read the CURRENT full content of each source file the diff touches and format it as a context block. A diff shows only the changed hunks, so reviewers raise false alarms that reading the whole file would kill instantly ('X is unhandled' when the wrapper handles it three lines down; 'unimported' when it's imported at the top). Bounded hard (per-file + total caps) to protect prompt size / TTFT, and skips generated/dist/min files (derived noise that would blow the budget). Best-effort: deleted/binary/unreadable files are skipped — the diff still covers them.
 */
export function gatherReviewFileContext(diff: string, cwd: string): string {
  const PER_FILE_MAX = 20_000;
  const TOTAL_MAX = 60_000;
  const root = resolve(cwd);
  let realRoot: string | undefined;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)) {
    const p = m[1];
    if (!p || seen.has(p)) continue;
    seen.add(p);
    // Derived/build noise — covered by the diff, would blow the budget.
    if (/(^|\/)(generated|dist|dist-tsc|node_modules|build|coverage|\.next|\.turbo)\//.test(p) || /\.min\.[a-z]+$/.test(p)) continue;
    paths.push(p);
  }
  const sections: string[] = [];
  let total = 0;
  for (const p of paths) {
    try {
      // Path containment: a diff is DATA (it can come from branch:/commit:
      // targets or be crafted), so a path that escapes the repo root via ../
      // or a symlink must never cause us to read arbitrary files into the prompt.
      if (isSecretPath(p)) continue;
      const lexical = resolve(cwd, p);
      if (!lexical.startsWith(root + sep)) continue;
      realRoot ??= realpathSync(root);
      const full = realpathSync(lexical);
      if (!full.startsWith(realRoot + sep) || isSecretPath(relative(realRoot, full))) continue;
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      let content = readFileSync(full, 'utf-8');
      // Skip binary: utf-8 decoding doesn't throw, so detect via NUL bytes.
      if (content.includes('\u0000')) continue;
      if (content.length > PER_FILE_MAX) content = content.slice(0, PER_FILE_MAX) + `\n... [truncated — ${p} exceeds ${PER_FILE_MAX} chars]`;
      const block = `### ${p}\n\`\`\`\n${content}\n\`\`\``;
      // Hard total cap: stop BEFORE appending a block that would overshoot,
      // so the advertised cap is actually a ceiling, not "cap + one block".
      if (total + block.length > TOTAL_MAX) {
        sections.push(`... [file context truncated — ${TOTAL_MAX}-char total cap reached; remaining files are covered by the diff]`);
        break;
      }
      sections.push(block);
      total += block.length;
    } catch { /* deleted/unreadable — skip; the diff still covers it */ }
  }
  return sections.length ? sections.join('\n\n') : '';
}
