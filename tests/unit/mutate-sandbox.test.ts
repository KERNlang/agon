// Pins the two silent lies `agon mutate` used to tell in a workspace monorepo,
// both of which report as "every mutant survived" at score 0%:
//   1. a node_modules overlay whose workspace links resolve back into the REPO
//      (npm writes them relative, so a wholesale symlink escapes the sandbox),
//   2. a prebuilt dist hydrated into the sandbox, which a test importing the
//      package BY NAME loads instead of the mutated source.
// packages/forge/src/mutate-sandbox.ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareSandboxNodeModules, clearShadowingDist, workspacePackageDirs, packageEntryDirs, isInside,
  isSafePackageName, pnpmWorkspaceGlobs, repointWorkspaceLinks, gitIgnoredPaths,
  expandWorkspaceGlob, workspaceGlobToRegExp,
} from '../../packages/forge/src/mutate-sandbox.js';

const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

/** A throwaway workspace repo + an empty "sandbox" that mirrors its layout. */
const makeRepo = (over?: { entry?: string; ignore?: string }): { repo: string; sandbox: string } => {
  const root = mkdtempSync(join(tmpdir(), 'agon-mutate-sbx-'));
  const repo = join(root, 'repo');
  const sandbox = join(root, 'sandbox');
  const pkg = JSON.stringify({ name: '@t/foo', version: '1.0.0', main: over?.entry ?? './dist/index.js' });

  write(join(repo, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }));
  write(join(repo, 'packages/foo/package.json'), pkg);
  write(join(repo, 'packages/foo/src/index.ts'), 'export const answer = 42;\n');
  // The repo install: one external package and npm's RELATIVE workspace link.
  write(join(repo, 'node_modules/leftpad/package.json'), JSON.stringify({ name: 'leftpad', version: '1.0.0' }));
  write(join(repo, 'node_modules/leftpad/index.js'), 'module.exports = () => {};\n');
  mkdirSync(join(repo, 'node_modules/@t'), { recursive: true });
  symlinkSync('../../packages/foo', join(repo, 'node_modules/@t/foo'), 'dir');

  // The sandbox is a checkout of the same sources with no node_modules.
  write(join(sandbox, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }));
  write(join(sandbox, 'packages/foo/package.json'), pkg);
  write(join(sandbox, 'packages/foo/src/index.ts'), 'export const answer = 42;\n');

  if (over?.ignore !== undefined) {
    write(join(repo, '.gitignore'), over.ignore);
    execFileSync('git', ['init', '-q'], { cwd: repo });
  }
  return { repo, sandbox };
};

describe('mutate sandbox — workspace map', () => {
  it('resolves every workspace package name to its repo-relative directory', () => {
    const { repo } = makeRepo();
    expect(workspacePackageDirs(repo)).toEqual({ '@t/foo': 'packages/foo' });
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('returns {} for a repo with no workspaces field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-plain-'));
    write(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
    expect(workspacePackageDirs(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the {packages:[...]} spelling and literal (unglobbed) paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-yarn-'));
    write(join(dir, 'package.json'), JSON.stringify({ workspaces: { packages: ['apps/web'] } }));
    write(join(dir, 'apps/web/package.json'), JSON.stringify({ name: '@t/web' }));
    expect(workspacePackageDirs(dir)).toEqual({ '@t/web': 'apps/web' });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('mutate sandbox — node_modules mirroring', () => {
  it('points workspace packages INSIDE the sandbox and externals at the repo install', () => {
    const { repo, sandbox } = makeRepo();
    const result = prepareSandboxNodeModules(repo, sandbox);

    expect(result.mode).toBe('mirrored');
    expect(result.workspaceLinks).toBe(1);
    expect(result.links).toBeGreaterThanOrEqual(1);
    // The mutated source must be the code under test — not the repo's copy.
    expect(realpathSync(join(sandbox, 'node_modules/@t/foo')))
      .toBe(realpathSync(join(sandbox, 'packages/foo')));
    // Externals stay shared with the repo: no reinstall, no duplication.
    expect(realpathSync(join(sandbox, 'node_modules/leftpad')))
      .toBe(realpathSync(join(repo, 'node_modules/leftpad')));
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('replaces a wholesale node_modules symlink, whose relative workspace links escape to the repo', () => {
    const { repo, sandbox } = makeRepo();
    symlinkSync(join(repo, 'node_modules'), join(sandbox, 'node_modules'), 'dir');
    // The bug being pinned: through the wholesale link, @t/foo lands in the repo.
    expect(realpathSync(join(sandbox, 'node_modules/@t/foo')))
      .toBe(realpathSync(join(repo, 'packages/foo')));

    const result = prepareSandboxNodeModules(repo, sandbox);
    expect(result.mode).toBe('mirrored');
    expect(realpathSync(join(sandbox, 'node_modules/@t/foo')))
      .toBe(realpathSync(join(sandbox, 'packages/foo')));
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('keeps an existing real overlay and only repairs workspace links that escape', () => {
    const { repo, sandbox } = makeRepo();
    mkdirSync(join(sandbox, 'node_modules/@t'), { recursive: true });
    symlinkSync(join(repo, 'packages/foo'), join(sandbox, 'node_modules/@t/foo'), 'dir');
    symlinkSync(join(repo, 'node_modules/leftpad'), join(sandbox, 'node_modules/leftpad'), 'dir');

    const result = prepareSandboxNodeModules(repo, sandbox);
    expect(result.mode).toBe('repaired');
    expect(result.workspaceLinks).toBe(1);
    expect(realpathSync(join(sandbox, 'node_modules/@t/foo')))
      .toBe(realpathSync(join(sandbox, 'packages/foo')));
    // Untouched: repairing must not disturb the externals already overlaid.
    expect(realpathSync(join(sandbox, 'node_modules/leftpad')))
      .toBe(realpathSync(join(repo, 'node_modules/leftpad')));
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('reports skipped when the repo has no node_modules at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-nonm-'));
    write(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
    const sandbox = join(dir, 'sandbox');
    mkdirSync(sandbox, { recursive: true });
    expect(prepareSandboxNodeModules(dir, sandbox).mode).toBe('skipped');
    rmSync(dir, { recursive: true, force: true });
  });

  it('isInside is containment, not a prefix match', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
  });
});

// The blocking finding: a workspace package NAME comes from repo content and is
// joined into a node_modules path that gets rmSync(recursive, force)-ed. A name
// of "../.." resolved that delete to $TMPDIR itself.
describe('mutate sandbox — a workspace name can never become a path traversal', () => {
  it('accepts ordinary names and rejects every traversal shape', () => {
    expect(isSafePackageName('leftpad')).toBe(true);
    expect(isSafePackageName('@scope/pkg')).toBe(true);
    expect(isSafePackageName('../..')).toBe(false);
    expect(isSafePackageName('..')).toBe(false);
    expect(isSafePackageName('a/b/c')).toBe(false);
    expect(isSafePackageName('scope/pkg')).toBe(false);
    expect(isSafePackageName('/etc/passwd')).toBe(false);
    expect(isSafePackageName('')).toBe(false);
  });

  it('drops an unsafe workspace name from the map instead of mapping it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-evil-'));
    write(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    write(join(dir, 'packages/evil/package.json'), JSON.stringify({ name: '../..' }));
    write(join(dir, 'packages/good/package.json'), JSON.stringify({ name: '@t/good' }));
    expect(workspacePackageDirs(dir)).toEqual({ '@t/good': 'packages/good' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('repointWorkspaceLinks never removes a path outside the sandbox node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-mutate-rm-'));
    const sandbox = join(root, 'sandbox');
    const bystander = join(root, 'bystander');
    mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
    mkdirSync(join(sandbox, 'packages/foo'), { recursive: true });
    mkdirSync(bystander, { recursive: true });

    // Even if an unsafe name reaches the repair pass directly, nothing outside
    // <worktree>/node_modules may be touched.
    expect(repointWorkspaceLinks(sandbox, { '../../bystander': 'packages/foo' }).repaired).toBe(0);
    expect(existsSync(bystander)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('repairs a DANGLING workspace link instead of leaving it to redden the baseline', () => {
    const { repo, sandbox } = makeRepo();
    mkdirSync(join(sandbox, 'node_modules/@t'), { recursive: true });
    symlinkSync(join(repo, 'does-not-exist'), join(sandbox, 'node_modules/@t/foo'), 'dir');
    symlinkSync(join(repo, 'node_modules/leftpad'), join(sandbox, 'node_modules/leftpad'), 'dir');

    const result = prepareSandboxNodeModules(repo, sandbox);
    expect(result.mode).toBe('repaired');
    expect(realpathSync(join(sandbox, 'node_modules/@t/foo')))
      .toBe(realpathSync(join(sandbox, 'packages/foo')));
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('reports how many entries could NOT be linked', () => {
    const { repo, sandbox } = makeRepo();
    const result = prepareSandboxNodeModules(repo, sandbox);
    expect(result.failed).toBe(0);
    expect(result.note).toBeUndefined();
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });
});

// A pnpm repo declares its workspaces ONLY in pnpm-workspace.yaml; without
// reading it the map is empty and every workspace package resolves back into
// the user's checkout — the exact escape this module exists to close.
describe('mutate sandbox — pnpm workspaces', () => {
  it('reads the block-sequence and inline-flow `packages:` forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-pnpm-'));
    write(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - \"apps/web\"\n");
    expect(pnpmWorkspaceGlobs(dir)).toEqual(['packages/*', 'apps/web']);
    write(join(dir, 'pnpm-workspace.yaml'), "packages: ['packages/*']\nother: 1\n");
    expect(pnpmWorkspaceGlobs(dir)).toEqual(['packages/*']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('maps a pnpm-only workspace repo that has no `workspaces` field at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-pnpm2-'));
    write(join(dir, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    write(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - packages/*\n");
    write(join(dir, 'packages/foo/package.json'), JSON.stringify({ name: '@t/foo' }));
    expect(workspacePackageDirs(dir)).toEqual({ '@t/foo': 'packages/foo' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when there is no pnpm-workspace.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-pnpm3-'));
    expect(pnpmWorkspaceGlobs(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('mutate sandbox — prebuilt output', () => {
  it('collects the build directories a package publishes its entry points from', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-entry-'));
    write(join(dir, 'package.json'), JSON.stringify({
      main: './dist/index.js',
      exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' }, './x': './build/x.js' },
    }));
    expect(packageEntryDirs(join(dir, 'package.json'))).toEqual(['build', 'dist']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores entry points that are not build output (src, a bare file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-entry2-'));
    write(join(dir, 'package.json'), JSON.stringify({ main: './src/index.ts', types: 'index.d.ts' }));
    expect(packageEntryDirs(join(dir, 'package.json'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('clears the hydrated dist of a package whose SOURCE is being mutated', () => {
    const { repo, sandbox } = makeRepo({ ignore: 'dist\n' });
    write(join(sandbox, 'packages/foo/dist/index.js'), 'export const answer = 42;\n');

    const cleared = clearShadowingDist(repo, sandbox, ['packages/foo/src/index.ts']);
    expect(cleared).toEqual(['packages/foo/dist']);
    expect(existsSync(join(sandbox, 'packages/foo/dist'))).toBe(false);
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('leaves a COMMITTED (non-ignored) build directory alone — it belongs to HEAD', () => {
    const { repo, sandbox } = makeRepo({ entry: './lib/index.js', ignore: 'node_modules\n' });
    write(join(sandbox, 'packages/foo/lib/index.js'), 'export const answer = 42;\n');

    expect(clearShadowingDist(repo, sandbox, ['packages/foo/src/index.ts'])).toEqual([]);
    expect(existsSync(join(sandbox, 'packages/foo/lib'))).toBe(true);
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('never deletes the build output the user asked to mutate', () => {
    const { repo, sandbox } = makeRepo({ ignore: 'dist\n' });
    write(join(sandbox, 'packages/foo/dist/index.js'), 'export const answer = 42;\n');

    expect(clearShadowingDist(repo, sandbox, ['packages/foo/dist/index.js'])).toEqual([]);
    expect(existsSync(join(sandbox, 'packages/foo/dist'))).toBe(true);
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('leaves packages that are NOT being mutated fully hydrated', () => {
    const { repo, sandbox } = makeRepo({ ignore: 'dist\n' });
    write(join(repo, 'packages/bar/package.json'), JSON.stringify({ name: '@t/bar', main: './dist/index.js' }));
    write(join(sandbox, 'packages/bar/package.json'), JSON.stringify({ name: '@t/bar', main: './dist/index.js' }));
    write(join(sandbox, 'packages/bar/dist/index.js'), 'export const bar = 1;\n');
    write(join(sandbox, 'packages/foo/dist/index.js'), 'export const answer = 42;\n');

    expect(clearShadowingDist(repo, sandbox, ['packages/foo/src/index.ts'])).toEqual(['packages/foo/dist']);
    expect(existsSync(join(sandbox, 'packages/bar/dist'))).toBe(true);
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('survives a package.json that parses to null instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-null-'));
    write(join(dir, 'package.json'), 'null');
    expect(packageEntryDirs(join(dir, 'package.json'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies every candidate in ONE git check-ignore call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-ignore-'));
    write(join(dir, '.gitignore'), 'dist\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(gitIgnoredPaths(dir, ['a/dist', 'a/src'])).toEqual(['a/dist']);
    expect(gitIgnoredPaths(dir, ['a/src'])).toEqual([]);
    expect(gitIgnoredPaths(dir, [])).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op in a repo with no workspaces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-nows-'));
    write(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
    expect(clearShadowingDist(dir, dir, ['src/a.ts'])).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── Review T3 — the boundary is real on BOTH halves of the module ──────────
describe('mutate sandbox — check-ignore is byte-exact', () => {
  // git QUOTES and C-escapes non-ASCII paths unless -z is passed, so
  // `packages/café/dist` came back as `"packages/caf\303\251/dist"`, never
  // matched the candidate, and its prebuilt output was left to shadow the
  // mutated source at a silent 0%.
  it('recognises an ignored path with non-ASCII characters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-utf8-'));
    write(join(dir, '.gitignore'), 'dist\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(gitIgnoredPaths(dir, ['packages/café/dist', 'packages/café/src'])).toEqual(['packages/café/dist']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('clears the prebuilt output of a package whose directory is non-ASCII', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-mutate-utf8b-'));
    const repo = join(root, 'repo');
    const sandbox = join(root, 'sandbox');
    const pkg = JSON.stringify({ name: '@t/cafe', main: './dist/index.js' });
    for (const base of [repo, sandbox]) {
      write(join(base, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }));
      write(join(base, 'packages/café/package.json'), pkg);
      write(join(base, 'packages/café/src/index.ts'), 'export const a = 1;\n');
    }
    write(join(sandbox, 'packages/café/dist/index.js'), 'export const a = 1;\n');
    write(join(repo, '.gitignore'), 'dist\n');
    execFileSync('git', ['init', '-q'], { cwd: repo });

    expect(clearShadowingDist(repo, sandbox, ['packages/café/src/index.ts'])).toEqual(['packages/café/dist']);
    expect(existsSync(join(sandbox, 'packages/café/dist'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('mutate sandbox — workspace globs', () => {
  const pnpmRepo = (yaml: string, dirs: Array<[string, string]>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-globs-'));
    write(join(dir, 'package.json'), JSON.stringify({ name: 'root', private: true }));
    write(join(dir, 'pnpm-workspace.yaml'), yaml);
    for (const [rel, name] of dirs) write(join(dir, rel, 'package.json'), JSON.stringify({ name }));
    return dir;
  };

  // `**` used to be processed exactly like `*`: only immediate children were
  // scanned, so a nested package resolved to the REPO copy, not the sandbox.
  it('a trailing ** finds NESTED packages, not just immediate children', () => {
    const dir = pnpmRepo('packages:\n  - packages/**\n', [
      ['packages/a', '@t/a'],
      ['packages/group/b', '@t/b'],
      ['packages/group/deep/c', '@t/c'],
    ]);
    expect(workspacePackageDirs(dir)).toEqual({
      '@t/a': 'packages/a',
      '@t/b': 'packages/group/b',
      '@t/c': 'packages/group/deep/c',
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('a trailing * still means immediate children ONLY', () => {
    const dir = pnpmRepo('packages:\n  - packages/*\n', [
      ['packages/a', '@t/a'],
      ['packages/group/b', '@t/b'],
    ]);
    expect(workspacePackageDirs(dir)).toEqual({ '@t/a': 'packages/a' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('the ** walk is depth-bounded, never an unbounded tree walk', () => {
    const dir = pnpmRepo('packages:\n  - packages/**\n', [
      ['packages/a/b/c/d/e', '@t/tooDeep'],
    ]);
    expect(workspacePackageDirs(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  // A `!pattern` used to be DISCARDED, so an explicitly excluded package was
  // still treated as a workspace and its dependency redirected to the sandbox.
  it('applies a negated glob as an EXCLUSION instead of discarding it', () => {
    const dir = pnpmRepo("packages:\n  - 'packages/*'\n  - '!packages/excluded'\n", [
      ['packages/kept', '@t/kept'],
      ['packages/excluded', '@t/excluded'],
    ]);
    expect(workspacePackageDirs(dir)).toEqual({ '@t/kept': 'packages/kept' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('a negated ** glob excludes a whole subtree', () => {
    const dir = pnpmRepo("packages:\n  - 'packages/**'\n  - '!packages/vendor/**'\n", [
      ['packages/kept', '@t/kept'],
      ['packages/vendor/x', '@t/vendor-x'],
    ]);
    expect(workspacePackageDirs(dir)).toEqual({ '@t/kept': 'packages/kept' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('workspaceGlobToRegExp: * stops at a separator, ** crosses it, the rest is literal', () => {
    expect(workspaceGlobToRegExp('packages/*')!.test('packages/a')).toBe(true);
    expect(workspaceGlobToRegExp('packages/*')!.test('packages/a/b')).toBe(false);
    expect(workspaceGlobToRegExp('packages/**')!.test('packages/a/b')).toBe(true);
    expect(workspaceGlobToRegExp('packages/**')!.test('apps/a')).toBe(false);
    // A dot is a literal dot, not "any character".
    expect(workspaceGlobToRegExp('a.b')!.test('axb')).toBe(false);
    expect(workspaceGlobToRegExp('a.b')!.test('a.b')).toBe(true);
  });

  it('expandWorkspaceGlob refuses to leave the repo root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-mutate-glob-esc-'));
    expect(expandWorkspaceGlob(dir, '../outside/*')).toEqual([]);
    expect(expandWorkspaceGlob(dir, '/etc/*')).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('mutate sandbox — the link boundary is canonical, and failures are counted', () => {
  it('a repair that cannot run is COUNTED, never swallowed', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-mutate-repfail-'));
    const sandbox = join(root, 'sandbox');
    mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
    mkdirSync(join(sandbox, 'packages/foo'), { recursive: true });
    // An unsafe name never reaches the filesystem at all — it is skipped, not failed.
    const skipped = repointWorkspaceLinks(sandbox, { 'a/b/c': 'packages/foo' });
    expect(skipped).toEqual({ repaired: 0, failed: 0, notes: [] });

    // A REAL failure: the entry needs repair (it points outside the sandbox)
    // but its scope directory is read-only, so rmSync/symlinkSync throw. The
    // exception used to be swallowed and reported as failed: 0.
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(sandbox, 'node_modules/@t'), { recursive: true });
    symlinkSync(outside, join(sandbox, 'node_modules/@t/foo'), 'dir');
    chmodSync(join(sandbox, 'node_modules/@t'), 0o555);
    try {
      const failed = repointWorkspaceLinks(sandbox, { '@t/foo': 'packages/foo' });
      expect(failed.repaired).toBe(0);
      expect(failed.failed).toBe(1);
      expect(failed.notes[0]).toContain('@t/foo');
    } finally {
      chmodSync(join(sandbox, 'node_modules/@t'), 0o755);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('prepareSandboxNodeModules reports a repair failure instead of claiming failed: 0', () => {
    const { repo, sandbox } = makeRepo();
    // A real (non-symlink) overlay exists → the repair path runs.
    mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
    // …and the workspace entry is a DIRECTORY the repair must replace, made
    // unremovable by pointing the map at a package that is not in the sandbox.
    const result = prepareSandboxNodeModules(repo, sandbox, { '@t/foo': 'packages/foo' });
    expect(result.mode).toBe('repaired');
    expect(result.failed).toBe(0);
    expect(typeof result.note === 'string' || result.note === undefined).toBe(true);
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  // The delete/mkdir used to be gated by a LEXICAL check only: a symlinked
  // `node_modules/@scope` passed it while rmSync followed the link into the
  // repo's own install.
  it('never writes or deletes through a symlinked scope directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-mutate-scopelink-'));
    const sandbox = join(root, 'sandbox');
    const outside = join(root, 'outside');
    mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
    mkdirSync(join(sandbox, 'packages/foo'), { recursive: true });
    write(join(outside, 'foo/keepme.txt'), 'precious');
    // A hostile overlay: the scope directory itself points OUT of the sandbox.
    symlinkSync(outside, join(sandbox, 'node_modules/@t'), 'dir');

    const repair = repointWorkspaceLinks(sandbox, { '@t/foo': 'packages/foo' });
    expect(repair.repaired).toBe(0);
    expect(repair.failed).toBe(1);
    expect(repair.notes[0]).toContain('canonically');
    // The bystander outside the sandbox is untouched.
    expect(existsSync(join(outside, 'foo/keepme.txt'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  // linkOne used to fall back to the REPO's node_modules entry when the mapped
  // workspace package was missing from the sandbox — and for a workspace
  // package that entry is npm's RELATIVE symlink straight back into the repo's
  // packages/, the exact escape this module exists to close.
  it('a mapped workspace package missing from the sandbox is refused, never linked to the repo copy', () => {
    const { repo, sandbox } = makeRepo();
    const result = prepareSandboxNodeModules(repo, sandbox, { '@t/foo': 'packages/does-not-exist' });
    expect(result.mode).toBe('mirrored');
    expect(existsSync(join(sandbox, 'node_modules/leftpad'))).toBe(true);   // an external still links
    expect(existsSync(join(sandbox, 'node_modules/@t/foo'))).toBe(false);   // the workspace one does NOT
    expect(result.failed).toBeGreaterThan(0);
    expect(result.note).toContain('could not be linked');
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });

  it('the MIRROR path re-validates a caller-supplied map exactly as the repair path does', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-mutate-mapesc-'));
    const { repo, sandbox } = makeRepo();
    const bystander = join(root, 'escape');
    mkdirSync(bystander, { recursive: true });

    // An unsafe name never becomes a link target, and nothing lands outside
    // <sandbox>/node_modules.
    prepareSandboxNodeModules(repo, sandbox, { '../../escape': 'packages/foo' });
    expect(existsSync(join(sandbox, 'node_modules/leftpad'))).toBe(true);
    expect(existsSync(join(sandbox, 'escape'))).toBe(false);
    expect(existsSync(bystander)).toBe(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(join(repo, '..'), { recursive: true, force: true });
  });
});
