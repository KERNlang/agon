import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync,
  existsSync, realpathSync, readFileSync, readdirSync, lstatSync, unlinkSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { linkWorktreeNodeModules } from '../../packages/core/src/blocks/git.js';
import { createForgeArena } from '../../packages/support-worktree/src/forge-arena.js';
import { linkDependencies, hydrateArtifacts, sessionRuntime } from '../../packages/mod-worktrees/src/runtime.js';
import { hydrateWorktreeBuildArtifacts } from '../../packages/support-worktree/src/dependency-overlay.js';

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

describe.each([
  { name: 'legacy/shared', link: linkWorktreeNodeModules, hydrate: hydrateWorktreeBuildArtifacts, strict: false },
  { name: 'physical mod', link: linkDependencies, hydrate: hydrateArtifacts, strict: true },
])('$name worktree dependency overlay', ({ link, hydrate, strict }) => {
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
    symlinkSync('../../../node_modules/typescript', join(repo, 'packages', 'cli', 'node_modules', 'typescript'), 'dir');

    // ── worktree: tracked files only (git worktree never copies gitignored node_modules) ──
    // The worktree's core carries the CANDIDATE edit, distinguished by its MARKER.
    mkdirSync(join(wt, 'packages', 'core'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'core', 'MARKER'), 'WORKTREE_CORE');
    mkdirSync(join(wt, 'packages', 'cli'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { rmSync(join(repo, '..'), { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('links root external deps into the worktree (no regression)', () => {
    link(repo, wt);
    expect(existsSync(join(wt, 'node_modules', 'typescript', 'index.js'))).toBe(true);
  });

  it('recreates per-package node_modules so a workspace dep resolves in the worktree', () => {
    link(repo, wt);
    const dep = join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core');
    expect(existsSync(dep)).toBe(true);
  });

  it('re-points a workspace dep at the WORKTREE package, not the source repo (candidate edits visible)', () => {
    link(repo, wt);
    const marker = join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core', 'MARKER');
    expect(existsSync(marker)).toBe(true);
    // Must resolve to the worktree's core (candidate), not the source repo's core.
    expect(readFileSync(marker, 'utf8')).toBe('WORKTREE_CORE');
    expect(realpathSync(join(wt, 'packages', 'cli', 'node_modules', '@scope', 'core')))
      .toBe(realpathSync(join(wt, 'packages', 'core')));
  });

  it('resolves an external dep referenced from a per-package node_modules', () => {
    link(repo, wt);
    expect(existsSync(join(wt, 'packages', 'cli', 'node_modules', 'typescript', 'index.js'))).toBe(true);
  });

  it('links healthy scoped siblings after a broken optional dependency', () => {
    const scope = join(repo, 'node_modules', '@mixed');
    mkdirSync(scope);
    symlinkSync(join(repo, 'missing'), join(scope, 'a-broken'));
    mkdirSync(join(scope, 'b-healthy'));
    writeFileSync(join(scope, 'b-healthy', 'index.js'), 'healthy');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    link(repo, wt);
    expect(readFileSync(join(wt, 'node_modules', '@mixed', 'b-healthy', 'index.js'), 'utf8')).toBe('healthy');
  });

  it('preserves caller policy when the target dependency root is a file', () => {
    writeFileSync(join(wt, 'node_modules'), 'do not replace');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (strict) expect(() => link(repo, wt)).toThrow();
    else {
      expect(() => link(repo, wt)).not.toThrow();
      expect(warning).toHaveBeenCalled();
    }
    expect(readFileSync(join(wt, 'node_modules'), 'utf8')).toBe('do not replace');
  });

  it('preserves caller policy when artifact hydration cannot create its target', () => {
    mkdirSync(join(repo, 'packages', 'cli', 'dist'));
    writeFileSync(join(repo, 'packages', 'cli', 'dist', 'index.js'), 'source');
    rmSync(join(wt, 'packages', 'cli'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'cli'), 'do not replace');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (strict) expect(() => hydrate(repo, wt)).toThrow();
    else {
      expect(() => hydrate(repo, wt)).not.toThrow();
      expect(warning).toHaveBeenCalled();
    }
    expect(readFileSync(join(wt, 'packages', 'cli'), 'utf8')).toBe('do not replace');
  });

  it('preserves caller policy when a scope directory cannot be created', () => {
    mkdirSync(join(repo, 'node_modules', '@scope'));
    mkdirSync(join(wt, 'node_modules'));
    writeFileSync(join(wt, 'node_modules', '@scope'), 'do not replace');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (strict) expect(() => link(repo, wt)).toThrow();
    else expect(() => link(repo, wt)).not.toThrow();
    expect(readFileSync(join(wt, 'node_modules', '@scope'), 'utf8')).toBe('do not replace');
  });

  it('does not publish partial artifacts and permits retry after a copy failure', () => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'a.js'), 'source a');
    writeFileSync(join(source, 'b.js'), 'source b');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { join } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      fs.cpSync = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(join(from, 'a.js'), join(to, 'a.js'));
        throw new Error('INJECTED_COPY_FAILURE');
      };
      syncBuiltinESMExports();
      const { hydrateWorktreeBuildArtifacts } = await import(${JSON.stringify(new URL('../../packages/support-worktree/dist/index.js', import.meta.url).href)});
      let outcome;
      console.warn = message => { outcome = { kind: 'warning', message }; };
      try { hydrateWorktreeBuildArtifacts(${JSON.stringify(repo)}, ${JSON.stringify(wt)}, { throwOnSetupError: ${strict} }); }
      catch (error) { outcome = { kind: 'throw', message: error.message }; }
      console.log(JSON.stringify(outcome));
    `], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ kind: strict ? 'throw' : 'warning', message: expect.stringContaining('INJECTED_COPY_FAILURE') });
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(join(wt, 'packages', 'core'))).toEqual(['MARKER']);
    hydrate(repo, wt);
    expect(readFileSync(join(target, 'a.js'), 'utf8')).toBe('source a');
    expect(readFileSync(join(target, 'b.js'), 'utf8')).toBe('source b');
    expect(readFileSync(join(source, 'a.js'), 'utf8')).toBe('source a');
    expect(readFileSync(join(source, 'b.js'), 'utf8')).toBe('source b');
  });

  it('dereferences valid artifact links and preserves an existing candidate dist', () => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'index.js'), 'source');
    symlinkSync('index.js', join(source, 'alias.js'));
    mkdirSync(join(source, 'nested'));
    writeFileSync(join(source, 'nested', 'child.js'), 'child');
    symlinkSync('nested', join(source, 'alias-one'));
    symlinkSync('nested', join(source, 'alias-two'));
    hydrate(repo, wt);
    expect(lstatSync(join(target, 'alias.js')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(target, 'alias.js'), 'utf8')).toBe('source');
    for (const name of ['nested', 'alias-one', 'alias-two']) {
      expect(lstatSync(join(target, name)).isDirectory()).toBe(true);
      expect(readFileSync(join(target, name, 'child.js'), 'utf8')).toBe('child');
    }
    writeFileSync(join(target, 'index.js'), 'candidate');
    hydrate(repo, wt);
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('candidate');
    expect(readFileSync(join(source, 'index.js'), 'utf8')).toBe('source');
  });

  it.each([false, true])('cleans read-only artifact copies (copy failure=%s)', (failCopy) => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(join(source, 'nested'), { recursive: true });
    writeFileSync(join(source, 'nested', 'index.js'), 'source');
    chmodSync(join(source, 'nested'), 0o555);
    chmodSync(source, 0o555);
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        const copy = fs.cpSync;
        if (${failCopy}) fs.cpSync = (...args) => { copy(...args); throw new Error('COPY_AFTER_READONLY'); };
        syncBuiltinESMExports();
        const { hydrateWorktreeBuildArtifacts } = await import(${JSON.stringify(new URL('../../packages/support-worktree/dist/index.js', import.meta.url).href)});
        let outcome = { kind: 'success' };
        console.warn = message => { outcome = { kind: 'warning', message }; };
        try { hydrateWorktreeBuildArtifacts(${JSON.stringify(repo)}, ${JSON.stringify(wt)}, { throwOnSetupError: ${strict} }); }
        catch (error) { outcome = { kind: 'throw', message: error.message }; }
        console.log(JSON.stringify(outcome));
      `], { encoding: 'utf8', timeout: 5000 });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(failCopy
        ? { kind: strict ? 'throw' : 'warning', message: strict ? 'COPY_AFTER_READONLY' : `[agon] worktree artifact hydration failed for ${wt}: COPY_AFTER_READONLY` }
        : { kind: 'success' });
      expect(readdirSync(join(wt, 'packages', 'core')).filter(name => name.startsWith('.agon-hydrate-'))).toEqual([]);
      expect(lstatSync(source).mode & 0o777).toBe(0o555);
      expect(lstatSync(join(source, 'nested')).mode & 0o777).toBe(0o555);
      expect(readFileSync(join(source, 'nested', 'index.js'), 'utf8')).toBe('source');
      if (failCopy) expect(existsSync(target)).toBe(false);
      else {
        expect(lstatSync(target).mode & 0o700).toBe(0o700);
        expect(lstatSync(join(target, 'nested')).mode & 0o700).toBe(0o700);
        expect(readFileSync(join(target, 'nested', 'index.js'), 'utf8')).toBe('source');
        rmSync(target, { recursive: true });
      }
    } finally {
      // Restore permissions only in this fixture; never follow dependency links.
      const unlock = (path: string): void => {
        const info = lstatSync(path);
        if (!info.isDirectory() || info.isSymbolicLink()) return;
        chmodSync(path, info.mode | 0o700);
        for (const entry of readdirSync(path)) unlock(join(path, entry));
      };
      unlock(join(repo, '..'));
    }
  });

  it('preserves a dangling candidate dist link', () => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'index.js'), 'source');
    symlinkSync('candidate-not-built', target);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => hydrate(repo, wt)).not.toThrow();
    expect(warning).not.toHaveBeenCalled();
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(existsSync(join(wt, 'packages', 'core', 'candidate-not-built'))).toBe(false);
    unlinkSync(target);
  });

  it.each(['self', 'ancestor'])('rejects %s artifact cycles without terminating the host and permits retry', (kind) => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'index.js'), 'source');
    symlinkSync(kind === 'self' ? 'cycle' : '.', join(source, 'cycle'));
    // Keep native copy failures inside a disposable child process.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { hydrateWorktreeBuildArtifacts } from ${JSON.stringify(new URL('../../packages/support-worktree/dist/index.js', import.meta.url).href)};
      let error, kind;
      console.warn = (message) => { error = message; kind = 'warning'; };
      try { hydrateWorktreeBuildArtifacts(${JSON.stringify(repo)}, ${JSON.stringify(wt)}, { throwOnSetupError: ${strict} }); }
      catch (caught) { error = caught.message; kind = 'throw'; }
      console.log(JSON.stringify({ error, kind }));
    `], { encoding: 'utf8', timeout: 5000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).error).toMatch(kind === 'self' ? /ELOOP/ : /Artifact directory cycle/);
    expect(JSON.parse(result.stdout).kind).toBe(strict ? 'throw' : 'warning');
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(join(wt, 'packages', 'core'))).toEqual(['MARKER']);
    unlinkSync(join(source, 'cycle'));
    hydrate(repo, wt);
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('source');
  });

  it('reports copy and cleanup failures without losing either cause', () => {
    const source = join(repo, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'index.js'), 'source');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      fs.cpSync = () => { throw new Error('COPY_FAILED'); };
      fs.rmSync = () => { throw new Error('CLEANUP_FAILED'); };
      syncBuiltinESMExports();
      const { hydrateWorktreeBuildArtifacts } = await import(${JSON.stringify(new URL('../../packages/support-worktree/dist/index.js', import.meta.url).href)});
      console.warn = message => console.log(JSON.stringify({ warning: message }));
      try {
        hydrateWorktreeBuildArtifacts(${JSON.stringify(repo)}, ${JSON.stringify(wt)}, { throwOnSetupError: ${strict} });
        if (${strict}) process.exitCode = 1;
      } catch (error) {
        console.log(JSON.stringify({ aggregate: error instanceof AggregateError, errors: error.errors?.map(e => e.message), cause: error.cause?.message }));
      }
    `], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    if (strict) expect(JSON.parse(result.stdout)).toEqual({ aggregate: true, errors: ['COPY_FAILED', 'CLEANUP_FAILED'], cause: 'COPY_FAILED' });
    else {
      expect(JSON.parse(result.stdout).warning).toContain('COPY_FAILED');
      expect(JSON.parse(result.stdout).warning).toContain('CLEANUP_FAILED');
    }
    expect(existsSync(join(wt, 'packages', 'core', 'dist'))).toBe(false);
    expect(readFileSync(join(source, 'index.js'), 'utf8')).toBe('source');
  });

  it.each(['rename', 'cleanup'])('preserves artifact state when %s fails', (phase) => {
    const source = join(repo, 'packages', 'core', 'dist');
    const target = join(wt, 'packages', 'core', 'dist');
    mkdirSync(source);
    writeFileSync(join(source, 'index.js'), 'source');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      fs[${JSON.stringify(phase === 'rename' ? 'renameSync' : 'rmSync')}] = () => { throw new Error('INJECTED_${phase.toUpperCase()}'); };
      syncBuiltinESMExports();
      const { hydrateWorktreeBuildArtifacts } = await import(${JSON.stringify(new URL('../../packages/support-worktree/dist/index.js', import.meta.url).href)});
      let outcome;
      console.warn = message => { outcome = { kind: 'warning', message }; };
      try { hydrateWorktreeBuildArtifacts(${JSON.stringify(repo)}, ${JSON.stringify(wt)}, { throwOnSetupError: ${strict} }); }
      catch (error) { outcome = { kind: 'throw', message: error.message }; }
      console.log(JSON.stringify(outcome));
    `], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ kind: strict ? 'throw' : 'warning', message: expect.stringContaining(`INJECTED_${phase.toUpperCase()}`) });
    if (phase === 'rename') {
      expect(existsSync(target)).toBe(false);
      expect(readdirSync(join(wt, 'packages', 'core'))).toEqual(['MARKER']);
      hydrate(repo, wt);
    }
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('source');
    expect(readFileSync(join(source, 'index.js'), 'utf8')).toBe('source');
  });

  it('skips missing source artifacts and missing candidate packages', () => {
    mkdirSync(join(repo, 'packages', 'missing-candidate', 'dist'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'missing-candidate', 'dist', 'index.js'), 'source');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    hydrate(repo, wt);
    expect(warning).not.toHaveBeenCalled();
    expect(existsSync(join(wt, 'packages', 'core', 'dist'))).toBe(false);
    expect(existsSync(join(wt, 'packages', 'missing-candidate'))).toBe(false);
  });

  it.each([
    ['npm-hoisted', 'index.js'], ['pnpm', 'index.js'],
    ['npm-hoisted', 'dist/index.js'], ['pnpm', 'dist/index.js'],
  ])('fitness imports candidate workspace edits with %s dependencies and %s exports', (layout, entrypoint) => {
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\ndist/\n');
    writeFileSync(join(repo, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@scope/core', type: 'module', exports: `./${entrypoint}` }));
    mkdirSync(join(repo, 'packages', 'core', 'dist'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'core', entrypoint), 'export const marker = "SOURCE";\n');
    writeFileSync(join(repo, 'packages', 'cli', 'check.mjs'), 'import { marker } from "@scope/core"; console.log(marker);\n');
    if (layout === 'npm-hoisted') {
      rmSync(join(repo, 'packages', 'cli', 'node_modules'), { recursive: true });
      mkdirSync(join(repo, 'node_modules', '@scope'), { recursive: true });
      symlinkSync('../../packages/core', join(repo, 'node_modules', '@scope', 'core'), 'dir');
    }
    for (const args of [
      ['init', '--quiet'], ['add', '.gitignore', 'packages/core', 'packages/cli'],
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture'],
    ]) {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    const arena = createForgeArena(repo);
    const modCandidate = join(wt, 'candidate');
    try {
      const candidate = strict
        ? { path: sessionRuntime.worktreeAddOnBranch(repo, modCandidate, 'fixture-branch') }
        : arena.create('fixture');
      const candidateExport = join(candidate.path, 'packages', 'core', entrypoint);
      expect(readFileSync(candidateExport, 'utf8')).toContain('SOURCE');
      writeFileSync(candidateExport, 'export const marker = "CANDIDATE";\n');
      const result = spawnSync(process.execPath, ['packages/cli/check.mjs'], { cwd: candidate.path, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('CANDIDATE');
      expect(readFileSync(join(repo, 'packages', 'core', entrypoint), 'utf8')).toContain('SOURCE');
    } finally {
      if (strict) sessionRuntime.worktreeRemoveBestEffort(repo, modCandidate);
      arena.cleanup();
    }
    expect(existsSync(modCandidate)).toBe(false);
    expect(existsSync(arena.rootPath)).toBe(false);
  });
});
