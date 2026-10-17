import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { linkWorktreeNodeModules, hydrateWorktreeBuildArtifacts } from './dependency-overlay.js';

export interface ForgeCandidateWorktree {
  readonly engineId: string;
  readonly path: string;
}

export interface ForgeArena {
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly rootPath: string;
  readonly dirtySourceExcluded: boolean;
  create(engineId: string): ForgeCandidateWorktree;
  diff(candidatePath: string): string;
  cleanup(): void;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
}

/** Capture the source revision before a builder can change its own HEAD. */
export function readWorktreeSource(cwd: string): { repoRoot: string; baseSha: string; dirtySourceExcluded: boolean } {
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  return {
    repoRoot,
    baseSha: git(repoRoot, ['rev-parse', 'HEAD']),
    dirtySourceExcluded: git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0,
  };
}

/** Reconstruct patch snapshots without changing the branch or its index. */
function patchTree(cwd: string, base: string, patches: readonly string[]): string {
  const indexRoot = mkdtempSync(join(tmpdir(), 'agon-diff-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(indexRoot, 'index') };
    const options = { cwd, env, encoding: 'utf8' as const, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };
    execFileSync('git', ['read-tree', base], options);
    for (const patch of patches) {
      if (patch) execFileSync('git', ['apply', '--cached', '--binary', '-'], { ...options, input: patch });
    }
    return execFileSync('git', ['write-tree'], options).trim();
  } finally {
    rmSync(indexRoot, { recursive: true, force: true });
  }
}

/** Compose retained work onto an accepted baseline; conflicts leave both intact. */
export function composeWorktreePatch(cwd: string, base: string, patches: readonly string[]): string {
  const tree = patchTree(cwd, base, patches);
  return execFileSync('git', ['diff', '--binary', '--no-ext-diff', base, tree, '--'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  });
}

/** Include tracked, binary and new files without staging their contents. */
export function readWorktreePatch(cwd: string, base: string, basePatch = ''): string {
  if (basePatch) base = patchTree(cwd, base, [basePatch]);
  git(cwd, ['add', '-N', '.']);
  return execFileSync('git', ['diff', '--binary', '--no-ext-diff', base, '--'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  });
}

function safeLeaf(value: string): string {
  const leaf = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return leaf || 'candidate';
}

function isInside(parent: string, child: string): boolean {
  const base = resolve(parent);
  const target = resolve(child);
  return target !== base && target.startsWith(base + sep);
}

/**
 * Create detached candidates with tracked files from one immutable HEAD.
 * Share external dependencies and copy existing build artifacts from the source.
 * Rebuild candidate artifacts after source edits. Do not stash checkout changes.
 */
export function createForgeArena(cwd: string): ForgeArena {
  const { repoRoot, baseSha, dirtySourceExcluded } = readWorktreeSource(cwd);
  const rootPath = mkdtempSync(join(tmpdir(), `agon-forge-${basename(repoRoot)}-`));
  const candidates: ForgeCandidateWorktree[] = [];
  let closed = false;

  function assertCandidate(candidatePath: string): void {
    if (!isInside(rootPath, candidatePath) || !candidates.some((candidate) => candidate.path === candidatePath)) {
      throw new Error(`Refusing Forge operation outside this arena: ${candidatePath}`);
    }
  }

  return Object.freeze({
    repoRoot,
    baseSha,
    rootPath,
    dirtySourceExcluded,
    create(engineId: string): ForgeCandidateWorktree {
      if (closed) throw new Error('Forge arena is already closed');
      const ordinal = candidates.length + 1;
      const path = join(rootPath, `${String(ordinal).padStart(2, '0')}-${safeLeaf(engineId)}`);
      git(repoRoot, ['worktree', 'add', '--detach', path, baseSha]);
      const candidate = Object.freeze({ engineId, path });
      candidates.push(candidate);
      linkWorktreeNodeModules(repoRoot, path);
      hydrateWorktreeBuildArtifacts(repoRoot, path);
      return candidate;
    },
    diff(candidatePath: string): string {
      assertCandidate(candidatePath);
      return readWorktreePatch(candidatePath, 'HEAD');
    },
    cleanup(): void {
      if (closed) return;
      closed = true;
      for (const candidate of [...candidates].reverse()) {
        if (!isInside(rootPath, candidate.path)) continue;
        try { execFileSync('git', ['worktree', 'remove', '--force', candidate.path], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* exact-path cleanup continues below */ }
        try { if (existsSync(candidate.path)) rmSync(candidate.path, { recursive: true, force: true }); } catch { /* receipt reports cleanup state */ }
      }
      try { execFileSync('git', ['worktree', 'prune'], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* best effort */ }
      try { if (isInside(tmpdir(), rootPath) && existsSync(rootPath)) rmSync(rootPath, { recursive: true, force: true }); } catch { /* caller can inspect cleanupComplete */ }
    },
  });
}
