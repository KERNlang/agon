import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  createSessionWorktree, listSessionWorktrees, findSessionWorktree,
  removeSessionWorktree, pruneSessionWorktrees, detectPackageManager,
  sessionWorktreesDir, worktreePathFor,
} from '../../packages/core/src/generated/blocks/worktree-session.js';

// ── Session worktrees: per-session isolation contract ────────────────────
// These pin the behavior the worktree hardening depends on, so a logic flip
// (e.g. nesting raw branch paths, or rm deleting the git branch) fails loudly.

describe('session worktrees', () => {
  let base: string;
  let home: string;
  const prevHome = process.env.AGON_HOME;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'agon-wt-session-'));
    home = join(base, 'agon-home');
    process.env.AGON_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prevHome;
    try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  // ── pure path / slug / PM logic (no git) ──
  describe('package-manager detection', () => {
    it('detects each manager by its lockfile, with pnpm winning precedence', () => {
      const d = join(base, 'proj');
      mkdirSync(d, { recursive: true });
      expect(detectPackageManager(d)).toBe(null);
      writeFileSync(join(d, 'package-lock.json'), '{}');
      expect(detectPackageManager(d)).toBe('npm');
      writeFileSync(join(d, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(d)).toBe('pnpm'); // pnpm takes precedence over npm
    });
    it('detects yarn and bun', () => {
      const y = join(base, 'y'); mkdirSync(y); writeFileSync(join(y, 'yarn.lock'), '');
      expect(detectPackageManager(y)).toBe('yarn');
      const b = join(base, 'b'); mkdirSync(b); writeFileSync(join(b, 'bun.lockb'), '');
      expect(detectPackageManager(b)).toBe('bun');
    });
  });

  describe('worktree path derivation', () => {
    it('flattens slashes — the directory leaf never nests', () => {
      const p = worktreePathFor('/some/repo', 'feat/x');
      expect(basename(p).includes('/')).toBe(false);
      expect(basename(p)).toMatch(/^feat-x-[0-9a-f]{8}$/);
    });
    it('disambiguates same-slug / case-folded branches by branch hash', () => {
      // 'feat/x' and 'feat-x' slug identically but must map to DIFFERENT dirs.
      expect(worktreePathFor('/r', 'feat/x')).not.toBe(worktreePathFor('/r', 'feat-x'));
      // case-fold collision (matters on case-insensitive filesystems)
      expect(worktreePathFor('/r', 'Feature/x')).not.toBe(worktreePathFor('/r', 'feature/x'));
    });
    it('keys storage per-repo and under AGON_HOME', () => {
      expect(sessionWorktreesDir('/repo/a')).not.toBe(sessionWorktreesDir('/repo/b'));
      expect(sessionWorktreesDir('/repo/a').startsWith(join(home, 'worktrees'))).toBe(true);
    });
  });

  // ── lifecycle against a real git repo ──
  describe('create / list / find / remove / prune', () => {
    let repo: string;
    const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

    beforeEach(() => {
      repo = join(base, 'repo');
      mkdirSync(repo, { recursive: true });
      git(['init', '-q'], repo);
      git(['config', 'user.email', 'test@agon.dev'], repo);
      git(['config', 'user.name', 'Agon Test'], repo);
      writeFileSync(join(repo, 'README.md'), '# test');
      git(['add', '-A'], repo);
      git(['commit', '-q', '-m', 'init'], repo);
    });

    it('checks out a NAMED branch in an isolated worktree and records a manifest', () => {
      const m = createSessionWorktree({ repoRoot: repo, branch: 'feat/iso', link: false });
      expect(m.branch).toBe('feat/iso');
      expect(existsSync(m.path)).toBe(true);
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], m.path)).toBe('feat/iso');
      expect(m.gitDir.length).toBeGreaterThan(0);

      const list = listSessionWorktrees(repo);
      expect(list.map((w) => w.branch)).toEqual(['feat/iso']);
      expect(findSessionWorktree(repo, 'feat/iso')?.path).toBe(m.path);
      expect(findSessionWorktree(repo, 'no-such')).toBe(null);
    });

    it('refuses to clobber an existing worktree for the same branch', () => {
      createSessionWorktree({ repoRoot: repo, branch: 'feat/dup', link: false });
      expect(() => createSessionWorktree({ repoRoot: repo, branch: 'feat/dup', link: false })).toThrow(/already exists/);
    });

    it('rm removes the worktree but KEEPS the git branch', () => {
      const m = createSessionWorktree({ repoRoot: repo, branch: 'feat/keepbranch', link: false });
      expect(removeSessionWorktree(repo, 'feat/keepbranch')).toBe(true);
      expect(existsSync(m.path)).toBe(false);
      expect(listSessionWorktrees(repo)).toEqual([]);
      // the branch ref must survive a worktree removal
      expect(() => git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/keepbranch'], repo)).not.toThrow();
      expect(removeSessionWorktree(repo, 'feat/keepbranch')).toBe(false); // already gone
    });

    it('prune respects dry-run, then removes aged worktrees', () => {
      const m = createSessionWorktree({ repoRoot: repo, branch: 'feat/old', link: false });
      // Backdate the manifest so age deterministically exceeds the threshold
      // (using a 0ms threshold against a just-created worktree is timing-racy).
      const manifestFile = `${m.path}.json`;
      const rec = JSON.parse(readFileSync(manifestFile, 'utf-8'));
      rec.createdAt = '2020-01-01T00:00:00.000Z';
      writeFileSync(manifestFile, JSON.stringify(rec));

      // dry-run reports without removing
      expect(pruneSessionWorktrees(repo, 1000, true)).toEqual(['feat/old']);
      expect(existsSync(m.path)).toBe(true);
      // real prune removes
      expect(pruneSessionWorktrees(repo, 1000, false)).toEqual(['feat/old']);
      expect(existsSync(m.path)).toBe(false);
      expect(listSessionWorktrees(repo)).toEqual([]);
    });
  });
});
