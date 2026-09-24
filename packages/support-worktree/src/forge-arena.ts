import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

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
 * Creates detached candidates from one immutable HEAD. Ambient source-checkout
 * changes are deliberately excluded, reported to the caller, and never stashed.
 */
export function createForgeArena(cwd: string): ForgeArena {
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const dirtySourceExcluded = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
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
      const rootModules = join(repoRoot, 'node_modules');
      const candidateModules = join(path, 'node_modules');
      if (existsSync(rootModules) && !existsSync(candidateModules)) {
        try { symlinkSync(rootModules, candidateModules, 'dir'); } catch { /* fitness may install or use another toolchain */ }
      }
      const candidate = Object.freeze({ engineId, path });
      candidates.push(candidate);
      return candidate;
    },
    diff(candidatePath: string): string {
      assertCandidate(candidatePath);
      git(candidatePath, ['add', '-N', '.']);
      return execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], { cwd: candidatePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
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
