import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';

import { basename, extname, join, relative } from 'node:path';

import { discoverGate, resolveWithinRoot } from '@kernlang/agon-core';

import { discoverLanguageGate, isBuildScript, isMutableSource, isMutationTestFile, mutationSkipDirs, parseChangedLines, profileFor } from '@kernlang/agon-support-worktree';

export const GENERIC_SOURCE_MAX_BYTES: number = 1048576;

const NON_SOURCE_EXTENSIONS: readonly string[] = ['.lock', '.md', '.markdown', '.rst', '.txt', '.log', '.sum', '.map'];

const LOCKFILE_NAMES: readonly string[] = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'go.sum', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock'];

export type MutateTargetKind = 'profiled' | 'generic' | 'none';

export interface ResolvedMutateTargets {
  targets: Record<string, number[]>;
  skippedGeneric: string[];
  error?: string;
}

export function isMutableFile(rel: string): boolean {
  return isMutableSource(rel);
}

function looksBinary(abs: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(8000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function inSkippedDir(rel: string, skipDirs: readonly string[]): boolean {
  const dirs = rel.split(/[\\/]/).slice(0, -1);
  return dirs.some((dir) => dir.startsWith('.') || skipDirs.includes(dir));
}

/**
 * 'generic' = a text file with no language profile that only the semantic panel can mutate: not a test, not a lockfile or prose, under GENERIC_SOURCE_MAX_BYTES, outside skipped directories and free of NUL bytes.
 */
export function classifyMutateTarget(repoRoot: string, rel: string, skipDirs: readonly string[] = mutationSkipDirs(repoRoot)): MutateTargetKind {
  if (isMutationTestFile(rel) || isBuildScript(rel)) return 'none';
  if (profileFor(rel)) return 'profiled';
  const name = basename(rel);
  if (!extname(name) || LOCKFILE_NAMES.includes(name) || NON_SOURCE_EXTENSIONS.includes(extname(name).toLowerCase())) return 'none';
  if (inSkippedDir(rel, skipDirs)) return 'none';
  const abs = join(repoRoot, rel);
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > GENERIC_SOURCE_MAX_BYTES) return 'none';
  } catch {
    return 'none';
  }
  return looksBinary(abs) ? 'none' : 'generic';
}

function collectCandidateFiles(repoRoot: string, absDir: string, skipDirs: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) walk(abs);
      } else if (entry.isFile()) {
        found.push(relative(repoRoot, abs));
      }
    }
  };
  walk(absDir);
  return found.sort();
}

/**
 * Changed-line targets from a unified diff: parseChangedLines minus test files and files without a language profile. Pure — containment against the repo root is the caller's job, because a hand-authored diff can carry any path.
 */
export function mutationTargetsFromDiff(diff: string): Record<string, number[]> {
  const targets: Record<string, number[]> = {};
  for (const [file, lines] of Object.entries(parseChangedLines(diff))) {
    if (!isMutableFile(file) || lines.length === 0) continue;
    targets[file] = lines;
  }
  return targets;
}

/**
 * Resolve a diff or positional paths into line targets. Profiled sources are always targets; generic files are targets only when `allowGeneric` (semantic panel with an explicit --build/--typecheck), otherwise they are listed in `skippedGeneric`. Every path is contained within repoRoot.
 */
export function resolveMutateTargets(opts: { repoRoot: string; diff?: string; files?: string[]; allowGeneric: boolean; wantGeneric: boolean }): ResolvedMutateTargets {
  const { repoRoot } = opts;
  const skipDirs = mutationSkipDirs(repoRoot);
  const targets: Record<string, number[]> = {};
  const skippedGeneric: string[] = [];
  const accept = (rel: string, lines: () => number[]): void => {
    if (!opts.wantGeneric && (isMutationTestFile(rel) || !profileFor(rel))) return;
    const kind = classifyMutateTarget(repoRoot, rel, skipDirs);
    if (kind === 'none') return;
    if (kind === 'generic') {
      if (!opts.wantGeneric) return;
      if (!opts.allowGeneric) { skippedGeneric.push(rel); return; }
    }
    const resolved = lines();
    if (resolved.length > 0) targets[rel] = resolved;
  };
  if (opts.diff && opts.diff.trim()) {
    for (const [file, lines] of Object.entries(parseChangedLines(opts.diff))) {
      try {
        resolveWithinRoot(repoRoot, file);
      } catch (err) {
        console.warn(`[agon] mutate: ignoring diff target ${file} — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      accept(file, () => lines);
    }
    return { targets, skippedGeneric };
  }
  if (!opts.files || opts.files.length === 0) return { targets, skippedGeneric, error: 'no target — pass a path or a diff' };
  for (const p of opts.files) {
    let abs = '';
    try {
      abs = resolveWithinRoot(repoRoot, p);
    } catch (err) {
      return { targets, skippedGeneric, error: `target ${p} is outside the repository root (${err instanceof Error ? err.message : String(err)})` };
    }
    let isDir = false;
    try { isDir = statSync(abs).isDirectory(); } catch { return { targets, skippedGeneric, error: `target not found: ${p}` }; }
    const rel0 = relative(repoRoot, abs);
    if (!isDir && isMutationTestFile(rel0)) {
      return { targets, skippedGeneric, error: `${rel0} is a test file — mutate measures the SOURCE your tests cover; point it at the implementation instead` };
    }
    const rels = isDir ? collectCandidateFiles(repoRoot, abs, skipDirs) : [rel0];
    for (const rel of rels) {
      accept(rel, () => {
        const count = readFileSync(join(repoRoot, rel), 'utf-8').split('\n').length;
        return Array.from({ length: count }, (_, i) => i + 1);
      });
    }
  }
  return { targets, skippedGeneric };
}

/**
 * The test command for a mutation run when the user gave none: a `fitness:` brief line or package.json script first, then the non-Node manifest defaults shared with the modular pipeline. '' when nothing is recognised.
 */
export function discoverMutateGate(cwd: string): string {
  let command = '';
  try { command = discoverGate(cwd).command.trim(); } catch { command = ''; }
  if (command) return command;
  try { return discoverLanguageGate(cwd); } catch { return ''; }
}

export const NO_GATE_DISCOVERED_MESSAGE: string = 'No test command discovered — pass `--test "<cmd>"`. Looked for a `fitness:` brief line, a package.json test script, pyproject.toml/pytest.ini/setup.cfg, go.mod, Cargo.toml, pom.xml and build.gradle. Mutation testing needs a real suite to run per mutant; agon never guesses one.';
