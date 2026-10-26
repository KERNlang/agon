import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveWithinRoot } from './paths.js';

export const MAX_UNTRACKED_COPY_BYTES = 5 * 1024 * 1024;
export const MAX_UNTRACKED_COPY_FILES = 2000;

export function copyUntrackedWork(repoRoot: string, sandboxRoot: string): { copied: number; skipped: number } {
  let untracked: string[] = [];
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter((rel) => rel.length > 0);
  } catch { return { copied: 0, skipped: 0 }; }
  let copied = 0;
  let skipped = 0;
  for (const rel of untracked) {
    if (copied >= MAX_UNTRACKED_COPY_FILES) { skipped += 1; continue; }
    let destination: string;
    try { destination = resolveWithinRoot(sandboxRoot, rel); } catch { skipped += 1; continue; }
    const source = join(repoRoot, rel);
    try {
      const st = lstatSync(source);
      if (!st.isFile()) continue;
      if (st.size > MAX_UNTRACKED_COPY_BYTES) { skipped += 1; continue; }
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination);
      copied += 1;
    } catch { skipped += 1; }
  }
  if (skipped > 0) console.warn(`[agon] mutate: ${skipped} untracked file(s) were NOT copied into the sandbox (too large, too many, or unreadable)`);
  return { copied, skipped };
}
