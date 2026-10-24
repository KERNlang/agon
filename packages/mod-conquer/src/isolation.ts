import { randomUUID } from 'node:crypto';

export interface ConquerIsolation {
  repoRoot: string;
  branch: string;
  path: string;
}

export interface ConquerIsolationEffects {
  repoRoot(cwd: string): string;
  createSessionWorktree(options: { repoRoot: string; branch: string; base: string; link: boolean; fresh: boolean }): { path: string };
}

/** Keep a named HEAD-based worktree for operator review and recovery. */
export function createConquerIsolation(
  task: string, cwd: string, effects: ConquerIsolationEffects, runId?: string, base = 'HEAD',
): ConquerIsolation {
  const root = effects.repoRoot(cwd);
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'build';
  const suffix = (runId?.trim() || randomUUID().slice(0, 8)).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const branch = `conquer/${slug}-${suffix}`;
  const worktree = effects.createSessionWorktree({ repoRoot: root, branch, base, link: true, fresh: true });
  return { repoRoot: root, branch, path: worktree.path };
}
