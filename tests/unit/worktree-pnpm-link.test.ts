import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync,
  existsSync, realpathSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkWorktreeNodeModules } from '../../packages/core/src/generated/blocks/git.js';

// ── pnpm-workspace worktree node_modules linking ─────────────────────────
// Regression contract: worktreeCreate -> linkWorktreeNodeModules must make a
// freshly-checked-out worktree resolvable on a pnpm (non-hoisted) monorepo,
// where workspace deps live in PER-PACKAGE node_modules (packages/<p>/node_modules/
// @scope/<dep> -> ../../../<dep>) rather than hoisted into root node_modules/@scope.
//
// Two invariants the linker must satisfy for ANY workspace scope (not just @agon):
//   1. External deps in a per-package node_modules resolve in the worktree.
//   2. Workspace deps re-point at the WORKTREE's packages/<dep> (so the gate
//      sees candidate edits), NOT the source repo's copy.
//
// Before the fix, linkWorktreeNodeModules only recreated ROOT node_modules and
// only special-cased the @agon scope, so packages/<p>/node_modules was never
// created in the worktree -> @scope/<dep> unresolvable -> tsc/build exits non-zero
// at base -> the goal pre-flight false-reds and the whole queue false-parks.

describe('linkWorktreeNodeModules — pnpm per-package layout', () => {
  let repo: string;
  let wt: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'agon-pnpm-link-'));
    repo = join(base, 'repo');
    wt = join(base, 'wt');

    // ── source repo: a pnpm-style monorepo with @scope/core consumed by @scope/cli ──
    // External dep, hoisted into root node_modules (pnpm hoists externals to root).
    mkdirSync(join(repo, 'node_modules', 'typescript'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'typescript', 'index.js'), 'module.exports = {};');

    // Workspace packages.
    mkdirSync(join(repo, 'packages', 'core'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@scope/core' }));
    writeFileSync(join(repo, 'packages', 'core', 'MARKER'), 'REPO_CORE');
    mkdirSync(join(repo, 'packages', 'cli'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'cli', 'package.json'), JSON.stringify({ name: '@scope/cli' }));

    // cli's per-package node_modules: workspace dep (symlink up to sibling package)
    // + external dep (symlink up to root node_modules) — the pnpm shape.
    mkdirSync(join(repo, 'packages', 'cli', 'node_modules', '@scope'), { recursive: true });
    symlinkSync('../../../core', join(repo, 'packages', 'cli', 'node_modules', '@scope', 'core'), 'dir');
    symlinkSync('../../../../node_modules/typescript', join(repo, 'packages', 'cli', 'node_modules', 'typescript'), 'dir');

    // ── worktree: tracked files only (git worktree never copies gitignored node_modules) ──
    // The worktree's core carries the CANDIDATE edit, distinguished by its MARKER.
    mkdirSync(join(wt, 'packages', 'core'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'core', 'MARKER'), 'WORKTREE_CORE');
    mkdirSync(join(wt, 'packages', 'cli'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(join(repo, '..'), { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('links root external deps into the worktree (no regression)', () => {
    linkWorktreeNodeModules(repo, wt);
    expect(existsSync(join(wt, 'node_modules', 'typescript', 'index.js'))).toBe(true);
  });

  it('recreates per-package node_modules so a workspace dep resolves in the worktree', () => {
    linkWorktreeNodeModules(repo, wt);
    const dep = join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core');
    expect(existsSync(dep)).toBe(true);
  });

  it('re-points a workspace dep at the WORKTREE package, not the source repo (candidate edits visible)', () => {
    linkWorktreeNodeModules(repo, wt);
    const marker = join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core', 'MARKER');
    expect(existsSync(marker)).toBe(true);
    // Must resolve to the worktree's core (candidate), not the source repo's core.
    expect(readFileSync(marker, 'utf8')).toBe('WORKTREE_CORE');
    expect(realpathSync(join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core')))
      .toBe(realpathSync(join(wt, 'packages', 'core')));
  });

  it('resolves an external dep referenced from a per-package node_modules', () => {
    linkWorktreeNodeModules(repo, wt);
    expect(existsSync(join(wt, 'packages', 'cli', 'node_modules', 'typescript', 'index.js'))).toBe(true);
  });
});
