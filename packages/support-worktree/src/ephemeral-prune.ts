import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ephemeralRoots = ['agent-worktrees', 'speculate-worktrees', 'runs', 'goals'];

export interface EphemeralPruneResult {
  paths: string[];
  errors: Array<{ path: string; message: string }>;
}

function isEphemeralPath(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep);
  return parts[0] === '.agon' && ephemeralRoots.includes(parts[1]) && parts.length >= 3;
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function registeredWorktrees(repoRoot: string): Array<{ path: string; locked: boolean }> {
  return git(repoRoot, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').flatMap((record) => {
    const fields = record.split('\0');
    const path = fields.find((field) => field.startsWith('worktree '))?.slice(9);
    if (!path || fields.includes('bare')) return [];
    return [{ path, locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')) }];
  });
}

/** Remove missing registrations only. A directory is not proof of an orphan. */
export function pruneMissingWorktreeRegistrations(repoRoot: string): EphemeralPruneResult {
  const root = realpathSync(repoRoot);
  const result: EphemeralPruneResult = { paths: [], errors: [] };
  for (const { path, locked } of registeredWorktrees(root)) {
    if (locked || !isEphemeralPath(root, path)) continue;
    try {
      lstatSync(path);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
    }
    try {
      // Target this registration only. Repository-wide prune affects unrelated work.
      git(root, ['worktree', 'remove', '--', path]);
      result.paths.push(path);
    } catch (error) {
      result.errors.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Preview and remove the same eligible, registered ephemeral worktrees. */
export function pruneEphemeralWorktrees(repoRoot: string, options: {
  olderThanMs: number;
  dryRun?: boolean;
  force?: boolean;
  agentOnly?: boolean;
  activePaths?: Iterable<string>;
}): EphemeralPruneResult {
  if (!Number.isFinite(options.olderThanMs) || options.olderThanMs < 0) {
    throw new Error('Worktree prune requires a finite, non-negative age.');
  }
  const root = realpathSync(repoRoot);
  const active = new Set(Array.from(options.activePaths ?? [], (path) => {
    try { return realpathSync(path); } catch { return resolve(path); }
  }));
  const cutoff = Date.now() - options.olderThanMs;
  function eligible(path: string, locked: boolean): boolean {
    if (locked || active.has(resolve(path))) return false;
    const parts = relative(root, path).split(sep);
    if (!isEphemeralPath(root, path)) return false;
    if (options.agentOnly && parts[1] !== 'agent-worktrees') return false;
    try {
      let current = root;
      for (const part of parts) {
        current = join(current, part);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
      }
      if (realpathSync(path) !== resolve(path) || lstatSync(path).mtimeMs > cutoff) return false;
      // Git still checks for dirty changes at removal when force is absent.
      return options.force === true || git(path, ['status', '--porcelain', '--untracked-files=all']).trim() === '';
    } catch {
      return false;
    }
  }
  const selected = registeredWorktrees(root).filter(({ path, locked }) => eligible(path, locked));
  if (options.dryRun) return { paths: selected.map(({ path }) => path), errors: [] };
  const result: EphemeralPruneResult = { paths: [], errors: [] };
  for (const candidate of selected) {
    try {
      const current = registeredWorktrees(root).find(({ path }) => path === candidate.path);
      if (!current || !eligible(current.path, current.locked)) {
        result.errors.push({ path: candidate.path, message: 'Worktree changed after selection; retained without removal.' });
        continue;
      }
      git(root, ['worktree', 'remove', ...(options.force ? ['--force'] : []), '--', current.path]);
      result.paths.push(current.path);
    } catch (error) {
      result.errors.push({ path: candidate.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
