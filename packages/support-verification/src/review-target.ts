import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export interface ReviewTarget { readonly diff: string; readonly label: string }
const git = (cwd: string, args: readonly string[]) => execFileSync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
const safeRef = (value: string) => { if (!value || value.startsWith('-') || /[\0\r\n]/.test(value)) throw new TypeError(`unsafe Git ref: ${JSON.stringify(value)}`); return value; };

/** Resolve a bounded, non-shell Git review target. Includes safe, small untracked text files for the uncommitted target. */
export function resolveReviewTarget(target: string | undefined, cwd: string, base?: string): ReviewTarget {
  const selected = (target ?? 'uncommitted').trim(); const baseRef = base?.trim(); let diff = ''; let label = '';
  if (baseRef && (selected.startsWith('commit:') || selected.startsWith('range:'))) throw new TypeError(`--base does not apply to ${selected}`);
  if (baseRef) git(cwd, ['rev-parse', '--verify', `${safeRef(baseRef)}^{commit}`]);
  if (selected === 'uncommitted') {
    label = baseRef ? `working tree vs ${baseRef}` : 'uncommitted changes'; diff = git(cwd, ['diff', baseRef || 'HEAD']);
    const root = resolve(cwd); const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']);
    for (const relative of untracked.split('\n').filter(Boolean)) { const file = resolve(root, relative); if (file !== root && !file.startsWith(root + sep)) continue; try { const stat = lstatSync(file); if (!stat.isFile() || stat.size > 512 * 1024) continue; const body = readFileSync(file, 'utf8'); diff += `\n\ndiff --git a/${relative} b/${relative}\nnew file mode 100644\n--- /dev/null\n+++ b/${relative}\n${body.split('\n').map((line) => `+${line}`).join('\n')}`; } catch { /* binary/unreadable/unraced file omitted */ } }
  } else if (selected.startsWith('branch:')) { const branch = safeRef(selected.slice(7)); label = `branch ${branch}`; diff = git(cwd, ['diff', `${safeRef(baseRef || branch)}...HEAD`]); }
  else if (selected.startsWith('commit:')) { const commit = safeRef(selected.slice(7)); label = `commit ${commit.slice(0, 8)}`; diff = git(cwd, ['show', commit]); }
  else if (selected.startsWith('range:')) { const range = selected.slice(6); if (!/^[^\0\r\n.][^\0\r\n]*\.\.\.[^\0\r\n.][^\0\r\n]*$/.test(range) || range.startsWith('-')) throw new TypeError(`invalid review range: ${range}`); label = `range ${range}`; diff = git(cwd, ['diff', range]); }
  else throw new TypeError(`Unknown review target: ${selected}`);
  diff = diff.replace(/\0/g, ''); if (diff.length > 100_000) diff = `${diff.slice(0, 100_000)}\n... [truncated — diff exceeds 100K chars]`;
  return { diff, label };
}
