import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, statSync } from 'node:fs';

import { join, sep } from 'node:path';

import { createHash } from 'node:crypto';

import { getAgonHome, ensureAgonHome } from '../signals/config.js';

import { worktreeAddOnBranch, worktreeRemoveBestEffort, linkWorktreeNodeModules, hydrateWorktreeBuildArtifacts, absoluteGitDir, isDirty, worktreePrune } from './git.js';

export interface SessionWorktree {
  branch: string;
  repoRoot: string;
  gitDir: string;
  path: string;
  createdAt: string;
  packageManager: string | null;
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Canonicalize the repo root (macOS maps /var -> /private/var; symlinked checkouts differ) so the storage key is stable across equivalent paths.
 */
function canonicalRepoRoot(repoRoot: string): string {
  try { return realpathSync(repoRoot); } catch { return repoRoot; }
}

/**
 * Flatten a branch ref to a filesystem-safe leaf: collapse any run of non [A-Za-z0-9._-] (including '/') to a single dash.
 */
function slugifyBranch(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'branch';
}

/**
 * Flat, collision-proof directory name: <slug>-<sha256(branch)[:8]>. The hash disambiguates case-folding collisions (Feature/x vs feature/x) on case-insensitive filesystems.
 */
function worktreeDirName(branch: string): string {
  return `${slugifyBranch(branch)}-${sha256hex(branch).slice(0, 8)}`;
}

/**
 * The per-repo session-worktree storage directory under the Agon home.
 */
export function sessionWorktreesDir(repoRoot: string): string {
  return join(getAgonHome(), 'worktrees', sha256hex(canonicalRepoRoot(repoRoot)).slice(0, 12));
}

/**
 * Absolute path where a session worktree for <branch> lives (may not exist yet).
 */
export function worktreePathFor(repoRoot: string, branch: string): string {
  return join(sessionWorktreesDir(repoRoot), worktreeDirName(branch));
}

function manifestPathFor(repoRoot: string, branch: string): string {
  return join(sessionWorktreesDir(repoRoot), `${worktreeDirName(branch)}.json`);
}

/**
 * Best-effort package-manager detection from a project's lockfile. Package-manager-agnostic: returns the detected manager, or null when none is recognized (so callers never assume npm or pnpm).
 */
export function detectPackageManager(dir: string): string | null {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return null;
}

/**
 * Create a session worktree on <branch> (created off base/HEAD if absent) and record its manifest. When link is not false, node_modules + dist are overlaid so it is immediately buildable. Throws if a worktree for this branch already exists.
 */
export function createSessionWorktree(opts: { repoRoot: string, branch: string, base?: string, link?: boolean }): SessionWorktree {
  ensureAgonHome();
  const dir = worktreePathFor(opts.repoRoot, opts.branch);
  if (existsSync(dir)) {
    throw new Error(`A session worktree for "${opts.branch}" already exists at ${dir}`);
  }
  mkdirSync(sessionWorktreesDir(opts.repoRoot), { recursive: true });

  worktreeAddOnBranch(opts.repoRoot, dir, opts.branch, opts.base, opts.link !== false);

  const manifest: SessionWorktree = {
    branch: opts.branch,
    repoRoot: opts.repoRoot,
    // The worktree's OWN per-checkout git-dir (<repo>/.git/worktrees/<name>),
    // not the main checkout's — this is what a per-checkout advisory lock keys on.
    gitDir: absoluteGitDir(dir),
    path: dir,
    createdAt: new Date().toISOString(),
    packageManager: detectPackageManager(dir),
  };
  try {
    writeFileSync(manifestPathFor(opts.repoRoot, opts.branch), JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    // Don't strand a worktree that list/find can't see — roll it back.
    worktreeRemoveBestEffort(opts.repoRoot, dir);
    throw err;
  }
  return manifest;
}

/**
 * All recorded session worktrees for this repo, newest first. Corrupt manifests are skipped (with a warning) rather than aborting the listing.
 */
export function listSessionWorktrees(repoRoot: string): SessionWorktree[] {
  const base = sessionWorktreesDir(repoRoot);
  if (!existsSync(base)) return [];
  let entries: string[];
  try { entries = readdirSync(base).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out: SessionWorktree[] = [];
  for (const f of entries) {
    try {
      const m = JSON.parse(readFileSync(join(base, f), 'utf-8')) as SessionWorktree;
      if (typeof m?.branch === 'string' && typeof m?.path === 'string') out.push(m);
    } catch (err) {
      console.warn(`[agon] worktree: skipping unreadable manifest ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Find a session worktree by its EXACT recorded branch.
 */
export function findSessionWorktree(repoRoot: string, branch: string): SessionWorktree | null {
  const direct = manifestPathFor(repoRoot, branch);
  if (existsSync(direct)) {
    try {
      const m = JSON.parse(readFileSync(direct, 'utf-8')) as SessionWorktree;
      if (m?.branch === branch) return m;
    } catch { /* fall through to scan */ }
  }
  for (const m of listSessionWorktrees(repoRoot)) {
    if (m.branch === branch) return m;
  }
  return null;
}

/**
 * Guard against a tampered/corrupt manifest: only paths inside THIS repo's session-worktree store may ever be force-removed, never an arbitrary path the manifest claims.
 */
function isInsideStore(repoRoot: string, p: string): boolean {
  const baseDir = sessionWorktreesDir(repoRoot);
  return p === baseDir || p.startsWith(baseDir + sep);
}

/**
 * Force-remove a session worktree's directory + manifest, then prune git's registry so no stale .git/worktrees/<name> entry is left behind. Only ever called on store-validated paths.
 */
function destroyWorktree(repoRoot: string, m: SessionWorktree): void {
  worktreeRemoveBestEffort(repoRoot, m.path);
  try { if (existsSync(m.path)) rmSync(m.path, { recursive: true, force: true }); } catch { /* already gone or permission denied */ }
  try { rmSync(manifestPathFor(repoRoot, m.branch), { force: true }); } catch { /* non-fatal */ }
  try { worktreePrune(repoRoot); } catch { /* keep git's worktree registry tidy; non-fatal */ }
}

/**
 * Remove the worktree for <branch> and its manifest; the git BRANCH is kept. Returns false if no such worktree is recorded. Throws if the worktree has uncommitted changes unless force=true (so `agon worktree rm` cannot silently discard work).
 */
export function removeSessionWorktree(repoRoot: string, branch: string, force?: boolean): boolean {
  const m = findSessionWorktree(repoRoot, branch);
  if (!m) return false;
  if (!isInsideStore(repoRoot, m.path)) {
    throw new Error(`Refusing to remove ${m.path}: it is outside this repo's session-worktree store`);
  }
  if (force !== true && isDirty(m.path)) {
    throw new Error(`Worktree for "${branch}" has uncommitted changes. Commit them, or pass --force to discard them.`);
  }
  destroyWorktree(repoRoot, m);
  return true;
}

/**
 * Remove session worktrees not touched (dir mtime) within the threshold. Dirty worktrees are SKIPPED (uncommitted work is never discarded automatically) unless force=true. Returns the branches removed — or that WOULD be removed under dryRun.
 */
export function pruneSessionWorktrees(repoRoot: string, olderThanMs: number, dryRun?: boolean, force?: boolean): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const m of listSessionWorktrees(repoRoot)) {
    if (!isInsideStore(repoRoot, m.path)) continue;
    // Age by last activity (dir mtime), not creation — an actively edited
    // worktree must not be reaped just for being old. Falls back to the
    // manifest timestamp if the dir is already gone.
    let lastTouch: number;
    try { lastTouch = statSync(m.path).mtimeMs; } catch { lastTouch = new Date(m.createdAt).getTime(); }
    if (!(now - lastTouch > olderThanMs)) continue;
    if (force !== true && isDirty(m.path)) {
      console.warn(`[agon] worktree prune: skipping "${m.branch}" — it has uncommitted changes (pass --force to prune anyway).`);
      continue;
    }
    removed.push(m.branch);
    if (dryRun) continue;
    destroyWorktree(repoRoot, m);
  }
  return removed;
}

/**
 * Re-overlay node_modules + dist for an existing session worktree (fixes stale symlinks/artifacts after a root reinstall or rebuild). NOT a git branch sync — it touches dependencies/artifacts only.
 */
export function rehydrateSessionWorktree(repoRoot: string, branch: string): boolean {
  const m = findSessionWorktree(repoRoot, branch);
  if (!m) return false;
  linkWorktreeNodeModules(repoRoot, m.path);
  hydrateWorktreeBuildArtifacts(repoRoot, m.path);
  return true;
}
