import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, symlinkSync, rmSync, realpathSync, statSync } from 'node:fs';

import { join, relative, resolve, sep, isAbsolute, dirname } from 'node:path';

import { execFileSync } from 'node:child_process';

import { isInsideRealpath } from '@kernlang/agon-core';

/**
 * What prepareSandboxNodeModules did. `mode` is the one-word story for the mutate:sandbox event.
 */
export interface SandboxNodeModules {
  mode: 'skipped'|'mirrored'|'repaired'|'kept';
  links: number;
  workspaceLinks: number;
  failed: number;
  note?: string;
}

/**
 * Install bookkeeping that must NOT be mirrored: a stale .package-lock.json makes npm think the sandbox tree is already correct, and .vite/.cache are transform caches keyed to the repo's paths.
 */
export const SKIP_NODE_MODULES_ENTRIES: string[] = ['.package-lock.json', '.vite', '.cache', '.DS_Store'];

/**
 * First-segment directory names that a package entry point may live in. Only these are ever considered for clearing, and only when git ignores them.
 */
export const BUILD_OUTPUT_CANDIDATES: string[] = ['dist', 'build', 'lib', 'out', 'es', 'esm', 'cjs'];

/**
 * True for a package name that is safe to join into a node_modules path: at most one `/` (and only after an `@scope`), never a bare `@scope`, no empty/`.`/`..` segment, no backslash, no absolute form, nothing outside the npm character set. The gate between repo CONTENT and an rmSync. Pure.
 */
export function isSafePackageName(name: string): boolean {
  const value = String(name ?? '');
  if (!value || value.length > 214) return false;
  if (value.includes('\\') || isAbsolute(value)) return false;
  const parts = value.split('/');
  if (parts.length > 2) return false;
  if (parts.length === 2 && !parts[0].startsWith('@')) return false;
  // A bare `@scope` is not a package name — it can only ever produce a stray
  // link at the scope directory itself.
  if (parts.length === 1 && parts[0].startsWith('@')) return false;
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return false;
    if (!/^@?[A-Za-z0-9._~-]+$/.test(part)) return false;
  }
  return true;
}

/**
 * The `packages:` globs from pnpm-workspace.yaml, read with a deliberately tiny parser (a YAML dependency for one list would be absurd): the block-sequence form (`packages:` then `- 'a/*'` lines) and the inline-flow form (`packages: ['a/*']`). Returns [] when the file is absent or shaped differently. Never throws.
 */
export function pnpmWorkspaceGlobs(repoRoot: string): string[] {
  let text = '';
  try { text = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf-8'); } catch { return []; }
  const globs: string[] = [];
  const unquote = (raw: string): string => raw.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
  const lines = text.split('\n');
  let inList = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const head = line.match(/^packages\s*:\s*(.*)$/);
    if (head) {
      const inline = head[1].trim();
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[/, '').replace(/\].*$/, '').split(',')) {
          const value = unquote(item);
          if (value) globs.push(value);
        }
        inList = false;
      } else {
        inList = true;
      }
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s+-\s*(.+)$/);
    if (item) {
      const value = unquote(item[1].replace(/\s+#.*$/, ''));
      if (value) globs.push(value);
      continue;
    }
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    inList = false;
  }
  return globs;
}

/**
 * How many directory levels a trailing `**` glob descends. Unbounded recursion over a monorepo root would walk every node_modules and build output; four levels covers every real `packages/**` layout and keeps the scan bounded.
 */
export const MAX_WORKSPACE_GLOB_DEPTH: number = 4;

/**
 * Compile ONE workspace glob into an anchored matcher over a repo-relative directory path (forward slashes). `**` crosses separators, `*` and `?` do not, and every other character is literal. Used for the NEGATED (`!pattern`) globs, which exclude a directory a positive glob already found. Returns null for a glob that cannot be compiled. Pure.
 */
export function workspaceGlobToRegExp(glob: string): RegExp|null {
  const clean = String(glob ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean) return null;
  let out = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '*') {
      if (clean[i + 1] === '*') { out += '.*'; i += 2; if (clean[i] === '/') i += 1; continue; }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') { out += '[^/]'; i += 1; continue; }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  try { return new RegExp(`^${out}$`); } catch { return null; }
}

/**
 * Repo-relative directories a POSITIVE workspace glob matches. A literal path yields itself; `dir/*` yields its immediate child directories; `dir/**` descends up to MAX_WORKSPACE_GLOB_DEPTH levels and yields every directory beneath it — `**` used to be processed exactly like `*`, so a pnpm repo declaring `packages/**` silently missed every nested package and resolved it to the REPO copy instead of the sandbox. Dot-directories and node_modules are never descended. Never throws.
 */
export function expandWorkspaceGlob(repoRoot: string, glob: string): string[] {
  const clean = String(glob ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean || isAbsolute(clean) || clean.split('/').includes('..')) return [];
  const star = clean.indexOf('*');
  if (star < 0) return [clean];
  const parent = clean.slice(0, star).replace(/\/+$/, '');
  const tail = clean.slice(star);
  // Only the shapes npm itself supports: a single trailing `*` or `**`.
  if (tail.replace(/\*/g, '').replace(/\//g, '') !== '') return [];
  const deep = tail.startsWith('**');
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try { entries = readdirSync(join(repoRoot, rel), { withFileTypes: true }) as never; } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(child);
      if (deep && depth + 1 < MAX_WORKSPACE_GLOB_DEPTH) walk(child, depth + 1);
    }
  };
  walk(parent, 0);
  return out;
}

/**
 * Map every workspace package NAME to its repo-relative directory, from the root package.json `workspaces` field (array or {packages:[]}) AND pnpm-workspace.yaml — a pnpm repo declares them only in the latter, and missing it re-opens the very escape this module exists to close. Supports literal paths, a trailing `*` (immediate children) and a trailing `**` (bounded recursion), and APPLIES negated `!pattern` globs as exclusions instead of discarding them — an explicitly excluded package must never be treated as a workspace, or an installed dependency gets redirected to a non-workspace sandbox directory. Names that are not safe to join into a path are dropped. Returns {} for a non-workspace repo. Never throws.
 */
export function workspacePackageDirs(repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  let globs: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const ws = raw.workspaces;
    if (Array.isArray(ws)) globs = ws;
    else if (ws && Array.isArray(ws.packages)) globs = ws.packages;
  } catch { /* no root package.json — pnpm-workspace.yaml may still declare them */ }
  globs = [...globs, ...pnpmWorkspaceGlobs(repoRoot)];
  if (globs.length === 0) return out;

  // A `!pattern` EXCLUDES; it is not a package location.
  const excluders: RegExp[] = [];
  const dirs: string[] = [];
  for (const glob of globs) {
    const raw = String(glob ?? '').trim();
    if (raw.startsWith('!')) {
      const rx = workspaceGlobToRegExp(raw.slice(1));
      if (rx) excluders.push(rx);
      continue;
    }
    for (const dir of expandWorkspaceGlob(repoRoot, raw)) dirs.push(dir);
  }

  for (const dir of dirs) {
    if (excluders.some((rx) => rx.test(dir))) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf-8')) as { name?: string } | null;
      if (!pkg || typeof pkg !== 'object') continue;
      const name = typeof pkg.name === 'string' ? pkg.name.trim() : '';
      if (!name) continue;
      // A workspace NAME becomes a node_modules path that gets symlinked over
      // and rmSync'd. Repo content never gets to author that path shape.
      if (!isSafePackageName(name)) {
        console.warn(`[agon] mutate: ignoring workspace package name ${JSON.stringify(name)} in ${dir} — unsafe as a node_modules path`);
        continue;
      }
      if (!out[name]) out[name] = dir;
    } catch { /* not a package — npm skips it too */ }
  }
  return out;
}

/**
 * True when `candidate` is the same path as, or nested under, `parent`. Both are resolved first; symlink canonicalisation is the caller's job — use core's isInsideRealpath before any destructive operation, because a symlinked intermediate component passes this LEXICAL check while resolving somewhere else entirely. Comparison is case-SENSITIVE: on a case-insensitive filesystem a case-differing spelling of the same directory answers false (fail-closed, which is the safe direction here). Pure.
 */
export function isInside(parent: string, candidate: string): boolean {
  const base = resolve(parent);
  const abs = resolve(candidate);
  if (abs === base) return true;
  const rel = relative(base, abs);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Symlink one node_modules entry, choosing the right link type for the platform. No-op when the target already exists — including a DANGLING symlink, which existsSync reports as absent and symlinkSync then rejects with EEXIST.
 */
function linkSandboxEntry(sourcePath: string, targetPath: string): void {
  try { lstatSync(targetPath); return; } catch { /* nothing there — create it */ }
  let isDir = false;
  try { isDir = statSync(sourcePath).isDirectory(); } catch { isDir = false; }
  const kind = isDir ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file';
  symlinkSync(sourcePath, targetPath, kind);
}

/**
 * What repointWorkspaceLinks did. `failed` used to be invisible: every exception was swallowed and prepareSandboxNodeModules reported failed:0, so a locked or unreplaceable workspace link produced the same unexplained red baseline this module exists to diagnose.
 */
export interface SandboxLinkRepair {
  repaired: number;
  failed: number;
  notes: string[];
}

/**
 * A node_modules entry path that may be created, replaced or REMOVED. Lexical containment is checked first (cheap, and it rejects `../..` shapes outright), then CANONICAL containment of the entry's PARENT directory: if `node_modules/@scope` is itself a symlink into the repo, the lexical form still reads as contained while an rmSync/mkdirSync through it lands in the repo's own install. Pure-ish (stats the filesystem).
 */
function isSandboxLinkPathSafe(nodeModules: string, linkPath: string): boolean {
  if (!isInside(nodeModules, linkPath)) return false;
  const parent = dirname(linkPath);
  if (!isInside(nodeModules, parent)) return false;
  // The parent is what rmSync/mkdirSync/symlinkSync resolve THROUGH. If it
  // does not exist yet, canonicalPath (inside isInsideRealpath) resolves it
  // through its deepest existing ancestor, so the answer is still truthful.
  return isInsideRealpath(nodeModules, parent);
}

/**
 * Re-point every workspace package link in an EXISTING sandbox node_modules that is missing, dangling, or still resolves outside the sandbox. Returns how many were repaired AND how many could not be, with a note each. Best-effort: a failure on one entry never stops the rest, and no path outside <worktree>/node_modules is ever created or removed — containment is decided on CANONICAL paths, so a symlinked intermediate component (a hostile `node_modules/@scope`) cannot make the recursive delete land in the repo.
 */
export function repointWorkspaceLinks(worktree: string, workspaces: Record<string, string>): SandboxLinkRepair {
  let repaired = 0;
  let failed = 0;
  const notes: string[] = [];
  const nodeModules = join(worktree, 'node_modules');
  let realWorktree = resolve(worktree);
  try { realWorktree = realpathSync(worktree); } catch { /* keep the resolved form */ }
  for (const [name, dir] of Object.entries(workspaces)) {
    if (!isSafePackageName(name)) continue;
    const linkPath = join(nodeModules, name);
    const sandboxPkg = join(worktree, dir);
    // Belt and braces over the name gate: nothing outside the sandbox's own
    // node_modules is ever created or deleted here — checked canonically.
    if (!isSandboxLinkPathSafe(nodeModules, linkPath)) {
      failed += 1;
      notes.push(`${name}: the node_modules entry does not canonically live inside the sandbox`);
      continue;
    }
    if (!existsSync(sandboxPkg)) continue;
    try {
      let present = true;
      try { lstatSync(linkPath); } catch { present = false; }
      if (!present) {
        mkdirSync(dirname(linkPath), { recursive: true });
        linkSandboxEntry(sandboxPkg, linkPath);
        repaired += 1;
        continue;
      }
      // realpathSync throws on a DANGLING link — that is a repair case, not a
      // skip, or the broken link survives to redden the baseline.
      let realLink = '';
      try { realLink = realpathSync(linkPath); } catch { realLink = ''; }
      if (realLink && isInside(realWorktree, realLink)) continue;
      rmSync(linkPath, { recursive: true, force: true });
      linkSandboxEntry(sandboxPkg, linkPath);
      repaired += 1;
    } catch (err) {
      // COUNTED, never swallowed: a half-repaired overlay otherwise shows up
      // only as an unexplained red baseline.
      failed += 1;
      notes.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { repaired, failed, notes };
}

/**
 * Give the sandbox a node_modules where WORKSPACE packages resolve to the sandbox's own sources and everything else resolves to the repo's install. A pre-existing real overlay is kept and only repaired; a wholesale symlink is replaced, because its relative workspace links escape back into the repo. Per-entry failures are COUNTED and reported on BOTH paths — mirror and repair (a silently half-empty or half-repaired overlay reads as an unexplained red baseline). The `workspaces` map may come from a caller, so every name it carries is re-validated here and every link target is asserted to live canonically inside <worktree>/node_modules before it is written. Pass `workspaces` to reuse an already-computed map. Never throws.
 */
export function prepareSandboxNodeModules(repoRoot: string, worktree: string, workspaces?: Record<string, string>): SandboxNodeModules {
  const src = join(repoRoot, 'node_modules');
  const dst = join(worktree, 'node_modules');
  const map = workspaces ?? workspacePackageDirs(repoRoot);
  if (!existsSync(src)) return { mode: 'skipped', links: 0, workspaceLinks: 0, failed: 0, note: 'the repo has no node_modules' };

  if (existsSync(dst)) {
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch { isLink = false; }
    if (!isLink) {
      const repair = repointWorkspaceLinks(worktree, map);
      const repairNote = repair.failed > 0
        ? `${repair.failed} workspace link(s) could not be repaired (${repair.notes.join('; ')}) — an incomplete node_modules usually shows up as a red baseline`
        : undefined;
      if (repairNote) console.warn(`[agon] mutate: ${repairNote}`);
      return { mode: repair.repaired > 0 ? 'repaired' : 'kept', links: 0, workspaceLinks: repair.repaired, failed: repair.failed, note: repairNote };
    }
    // A single symlink to the repo's install: every workspace link inside it
    // is relative and lands in the REPO's packages. Replace it.
    try { rmSync(dst, { force: true }); } catch { /* fall through — the mirror below will no-op */ }
  }

  const byName = new Map<string, string>();
  // The map is caller-supplyable, so it is re-validated here exactly as
  // repointWorkspaceLinks validates it — the two halves of this module must
  // enforce the SAME invariant or the weaker one is the real one.
  for (const [name, dir] of Object.entries(map)) {
    if (isSafePackageName(name)) byName.set(name, dir);
  }

  let links = 0;
  let workspaceLinks = 0;
  let failed = 0;
  const notes: string[] = [];
  const linkOne = (sourceDir: string, targetDir: string, entryName: string, packageName: string): void => {
    const sourcePath = join(sourceDir, entryName);
    const targetPath = join(targetDir, entryName);
    // Nothing is ever linked at a path that is not canonically inside the
    // sandbox's own node_modules — not even from a caller-supplied map.
    if (!isSafePackageName(packageName) || !isSandboxLinkPathSafe(dst, targetPath)) {
      failed += 1;
      notes.push(`${packageName}: refused — the link target is not inside the sandbox node_modules`);
      return;
    }
    const workspaceDir = byName.get(packageName);
    if (workspaceDir) {
      const sandboxPkg = join(worktree, workspaceDir);
      if (existsSync(sandboxPkg)) {
        linkSandboxEntry(sandboxPkg, targetPath);
        workspaceLinks += 1;
        return;
      }
      // The repo's node_modules entry for a WORKSPACE package is npm's own
      // relative symlink, which resolves straight back into the repo's
      // packages/ — the exact escape this module exists to close. Skip it.
      failed += 1;
      notes.push(`${packageName}: the workspace package is missing from the sandbox — not linked to the repo copy`);
      return;
    }
    linkSandboxEntry(sourcePath, targetPath);
    links += 1;
  };

  try {
    mkdirSync(dst, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_NODE_MODULES_ENTRIES.includes(entry.name)) continue;
      try {
        if (entry.name.startsWith('@') && entry.isDirectory()) {
          const scopeSrc = join(src, entry.name);
          const scopeDst = join(dst, entry.name);
          if (!isSandboxLinkPathSafe(dst, scopeDst)) { failed += 1; continue; }
          mkdirSync(scopeDst, { recursive: true });
          for (const scoped of readdirSync(scopeSrc, { withFileTypes: true })) {
            if (SKIP_NODE_MODULES_ENTRIES.includes(scoped.name)) continue;
            try { linkOne(scopeSrc, scopeDst, scoped.name, `${entry.name}/${scoped.name}`); } catch { failed += 1; }
          }
          continue;
        }
        linkOne(src, dst, entry.name, entry.name);
      } catch { failed += 1; }
    }
  } catch (err) {
    return { mode: 'skipped', links, workspaceLinks, failed, note: err instanceof Error ? err.message : String(err) };
  }
  const note = failed > 0
    ? `${failed} entr${failed === 1 ? 'y' : 'ies'} could not be linked (no symlink privilege, a locked path, or a refused target)${notes.length > 0 ? `: ${notes.slice(0, 5).join('; ')}` : ''} — an incomplete node_modules usually shows up as a red baseline`
    : undefined;
  if (failed > 0) console.warn(`[agon] mutate: ${note}`);
  return { mode: 'mirrored', links, workspaceLinks, failed, note };
}

/**
 * The first-segment output directories a package publishes its entry points from (`main`, `module`, `types`, every string in `exports`), filtered to plausible BUILD output names. Pure-ish: reads one package.json, never throws.
 */
export function packageEntryDirs(packageJsonPath: string): string[] {
  let pkg: Record<string, unknown> | null = null;
  try { pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown> | null; } catch { return []; }
  // `JSON.parse('null')` succeeds and would make every pkg.<field> read throw.
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return [];
  const found = new Set<string>();
  const consider = (value: string): void => {
    const clean = value.trim().replace(/^\.\//, '');
    if (!clean || clean.startsWith('/') || clean.startsWith('..')) return;
    const first = clean.split('/')[0];
    if (BUILD_OUTPUT_CANDIDATES.includes(first)) found.add(first);
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || node === undefined) return;
    if (typeof node === 'string') { consider(node); return; }
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (typeof node === 'object') { for (const item of Object.values(node as Record<string, unknown>)) walk(item, depth + 1); }
  };
  walk(pkg.main, 0);
  walk(pkg.module, 0);
  walk(pkg.types, 0);
  walk(pkg.typings, 0);
  walk(pkg.bin, 0);
  walk(pkg.exports, 0);
  return [...found].sort();
}

/**
 * Which of the given repo-relative paths git ignores — ONE `git check-ignore -z --stdin` call instead of one blocking subprocess per candidate. NUL-delimited on both sides so git never quote-escapes a non-ASCII path out of recognition. Exit 1 means 'none of them', which execFileSync reports as a throw, so the ignored set is read off the error's stdout too. Returns [] when git is unavailable. Never throws.
 */
export function gitIgnoredPaths(repoRoot: string, candidates: string[]): string[] {
  if (candidates.length === 0) return [];
  // -z on BOTH sides. Without it git QUOTES and C-escapes any path with a
  // non-ASCII or control character (`packages/café/dist` comes back as
  // `"packages/caf\\303\\251/dist"`), which never equals the candidate — so
  // that package's ignored build output was silently left in place to shadow
  // the mutated source. NUL-delimited input and output are byte-exact.
  const input = `${candidates.join('\0')}\0`;
  let stdout = '';
  try {
    stdout = execFileSync('git', ['check-ignore', '-z', '--stdin'], { cwd: repoRoot, input, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (err) {
    // exit 1 = nothing matched (not an error); exit 128 = not a git repo.
    const status = (err as { status?: number }).status;
    if (status !== 1) return [];
    stdout = String((err as { stdout?: string }).stdout ?? '');
  }
  const ignored = new Set(stdout.split('\0').filter((l) => l.length > 0));
  return candidates.filter((c) => ignored.has(c));
}

/**
 * Delete the hydrated build output of every workspace package whose SOURCE is being mutated, so a test that imports the package by name cannot load a prebuilt bundle the mutation never reached. Only git-IGNORED output directories are touched (a committed dist belongs to HEAD), and never one that contains a target file. Pass `workspaces` to reuse an already-computed map. Returns the repo-relative directories cleared. Never throws.
 */
export function clearShadowingDist(repoRoot: string, worktree: string, targetFiles: string[], workspaces?: Record<string, string>): string[] {
  const map = workspaces ?? workspacePackageDirs(repoRoot);
  if (Object.keys(map).length === 0) return [];
  const normalized = targetFiles.map((f) => f.split(sep).join('/'));

  const owning = new Set<string>();
  for (const dir of Object.values(map)) {
    const prefix = `${dir}/`;
    if (normalized.some((f) => f.startsWith(prefix))) owning.add(dir);
  }

  const candidates: string[] = [];
  for (const dir of [...owning].sort()) {
    for (const outDir of packageEntryDirs(join(worktree, dir, 'package.json'))) {
      const rel = `${dir}/${outDir}`;
      if (!existsSync(join(worktree, dir, outDir))) continue;
      if (normalized.some((f) => f === rel || f.startsWith(`${rel}/`))) continue; // mutating the build output itself
      candidates.push(rel);
    }
  }

  const cleared: string[] = [];
  for (const rel of gitIgnoredPaths(repoRoot, candidates)) {
    const abs = join(worktree, rel);
    // Lexical first (cheap), then CANONICAL — a symlinked intermediate
    // component would otherwise let this recursive delete leave the sandbox.
    if (!isInside(worktree, abs) || !isInsideRealpath(worktree, abs)) continue;
    try { rmSync(abs, { recursive: true, force: true }); cleared.push(rel); } catch { /* best effort */ }
  }
  return cleared;
}
