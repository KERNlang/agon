import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  createSessionWorktree, listSessionWorktrees, findSessionWorktree,
  removeSessionWorktree, pruneSessionWorktrees, rehydrateSessionWorktree,
  detectPackageManager, sessionWorktreesDir, worktreePathFor,
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
      // gitDir must be the worktree's OWN per-checkout dir (.git/worktrees/<name>),
      // not the main checkout's .git — this is what a per-checkout lock keys on.
      expect(m.gitDir.includes('worktrees')).toBe(true);

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
      // prune ages by last activity (dir mtime); backdate it deterministically
      // (a 0ms threshold against a just-created worktree would be timing-racy).
      const old = new Date('2020-01-01T00:00:00.000Z');
      utimesSync(m.path, old, old);

      // dry-run reports without removing
      expect(pruneSessionWorktrees(repo, 1000, true)).toEqual(['feat/old']);
      expect(existsSync(m.path)).toBe(true);
      // real prune removes
      expect(pruneSessionWorktrees(repo, 1000, false)).toEqual(['feat/old']);
      expect(existsSync(m.path)).toBe(false);
      expect(listSessionWorktrees(repo)).toEqual([]);
    });

    it('rehydrate returns true for an existing worktree, false otherwise', () => {
      createSessionWorktree({ repoRoot: repo, branch: 'feat/rehy', link: false });
      expect(rehydrateSessionWorktree(repo, 'feat/rehy')).toBe(true);
      expect(rehydrateSessionWorktree(repo, 'no-such')).toBe(false);
    });

    it('rm refuses to discard uncommitted changes unless --force', () => {
      const m = createSessionWorktree({ repoRoot: repo, branch: 'feat/dirty', link: false });
      writeFileSync(join(m.path, 'uncommitted.txt'), 'work in progress');
      // a dirty worktree must NOT be silently destroyed
      expect(() => removeSessionWorktree(repo, 'feat/dirty')).toThrow(/uncommitted/);
      expect(existsSync(m.path)).toBe(true);
      // prune skips it too (no force)
      const old = new Date('2020-01-01T00:00:00.000Z');
      utimesSync(m.path, old, old);
      expect(pruneSessionWorktrees(repo, 1000, false)).toEqual([]);
      expect(existsSync(m.path)).toBe(true);
      // explicit force discards
      expect(removeSessionWorktree(repo, 'feat/dirty', true)).toBe(true);
      expect(existsSync(m.path)).toBe(false);
    });

    it('worktreePruneOrphaned removes worktrees registered in git pointing to runs or agent-worktrees', async () => {
      const { worktreePruneOrphaned } = await import('../../packages/core/src/generated/blocks/git.js');

      const fakeAgentWtDir = join(repo, '.agon', 'agent-worktrees', 'run-xyz', 'scout');
      mkdirSync(fakeAgentWtDir, { recursive: true });

      git(['worktree', 'add', '--detach', fakeAgentWtDir, 'HEAD'], repo);

      const wtListBefore = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListBefore.includes('.agon/agent-worktrees')).toBe(true);

      worktreePruneOrphaned(repo);

      const wtListAfter = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListAfter.includes('.agon/agent-worktrees')).toBe(false);
      expect(existsSync(fakeAgentWtDir)).toBe(false);
    });

    it('worktreePruneOrphaned does NOT remove persistent session worktrees under ~/.agon/worktrees', async () => {
      const { worktreePruneOrphaned } = await import('../../packages/core/src/generated/blocks/git.js');

      const sessionWtDir = join(home, 'worktrees', 'abc123', 'feat-session');
      mkdirSync(sessionWtDir, { recursive: true });
      git(['worktree', 'add', '--detach', sessionWtDir, 'HEAD'], repo);

      const wtListBefore = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListBefore.includes('worktrees/abc123/feat-session')).toBe(true);

      worktreePruneOrphaned(repo);

      const wtListAfter = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListAfter.includes('worktrees/abc123/feat-session')).toBe(true);
      expect(existsSync(sessionWtDir)).toBe(true);

      // Clean up so the temp repo can be torn down cleanly
      git(['worktree', 'remove', '--force', sessionWtDir], repo);
    });

    it('worktreePruneAll removes aged engine worktrees under .agon/agent-worktrees', async () => {
      const { worktreePruneAll } = await import('../../packages/core/src/generated/blocks/git.js');

      const runDir = join(repo, '.agon', 'agent-worktrees', 'run-old');
      const engineWtDir = join(runDir, 'codex');
      mkdirSync(engineWtDir, { recursive: true });
      git(['worktree', 'add', '--detach', engineWtDir, 'HEAD'], repo);

      const recentDir = join(repo, '.agon', 'agent-worktrees', 'run-recent');
      const recentEngineWtDir = join(recentDir, 'claude');
      mkdirSync(recentEngineWtDir, { recursive: true });
      git(['worktree', 'add', '--detach', recentEngineWtDir, 'HEAD'], repo);

      // Backdate only the old run directory
      const old = new Date('2020-01-01T00:00:00.000Z');
      utimesSync(runDir, old, old);

      const wtListBefore = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListBefore.includes('agent-worktrees/run-old/codex')).toBe(true);
      expect(wtListBefore.includes('agent-worktrees/run-recent/claude')).toBe(true);

      worktreePruneAll(repo, 1000);

      const wtListAfter = git(['worktree', 'list', '--porcelain'], repo);
      expect(wtListAfter.includes('agent-worktrees/run-old/codex')).toBe(false);
      expect(wtListAfter.includes('agent-worktrees/run-recent/claude')).toBe(true);
      expect(existsSync(engineWtDir)).toBe(false);
      expect(existsSync(recentEngineWtDir)).toBe(true);
    });
  });
});
