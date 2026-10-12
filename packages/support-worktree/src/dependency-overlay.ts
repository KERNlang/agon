import { readdirSync, statSync, lstatSync, existsSync, symlinkSync, mkdirSync, cpSync, realpathSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';

function symlinkNodeModuleEntry(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) return;
  const sourceStat = statSync(sourcePath);
  const linkType = sourceStat.isDirectory()
    ? (process.platform === 'win32' ? 'junction' : 'dir')
    : 'file';
  symlinkSync(sourcePath, targetPath, linkType);
}

/**
 * External git worktrees live outside the repo, so Node cannot walk up to the root install. Create a shallow node_modules overlay: external deps link to the source install, while workspace packages (any scope) link back into the candidate worktree so runtime tests see candidate edits. Handles both npm-hoisted (root node_modules/@scope) and pnpm non-hoisted (per-package node_modules) layouts.
 */
export function linkWorktreeNodeModules(repoDir: string, worktreePath: string): void {
  const repoPackages = join(repoDir, 'packages');
  const worktreePackages = join(worktreePath, 'packages');
  // Workspace symlinks resolve through realpathSync, which canonicalizes the
  // path (e.g. macOS /var -> /private/var, or any symlinked repo/home/temp
  // component). Compare containment against the realpath'd base or the check
  // silently fails and the workspace re-point is skipped.
  const repoPackagesReal = existsSync(repoPackages) ? realpathSync(repoPackages) : repoPackages;

  const warn = (err: unknown) => {
    console.warn(`[agon] worktree node_modules link failed for ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
  };

  const isInsideRepoPackages = (candidatePath: string): boolean => {
    const rel = relative(repoPackagesReal, candidatePath);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };

  const workspacePackageNameFor = (resolvedPath: string): string | null => {
    if (!isInsideRepoPackages(resolvedPath)) return null;
    const rel = relative(repoPackagesReal, resolvedPath);
    const [packageName] = rel.split(sep);
    return packageName || null;
  };

  // A workspace symlink (resolving into repo/packages) is re-pointed at the
  // worktree's copy so the gate sees candidate edits; everything else keeps
  // pointing at the repo's resolved install (externals, .pnpm store, etc.).
  const sourceForNodeModuleEntry = (sourcePath: string): string => {
    const entryStat = lstatSync(sourcePath);
    if (!entryStat.isSymbolicLink()) return sourcePath;

    const resolvedPath = realpathSync(sourcePath);
    const workspacePackageName = workspacePackageNameFor(resolvedPath);
    if (!workspacePackageName) return resolvedPath;

    const worktreePackage = join(worktreePackages, workspacePackageName);
    return existsSync(worktreePackage) ? worktreePackage : resolvedPath;
  };

  const linkNodeModuleEntry = (
    sourceDir: string,
    targetDir: string,
    entryName: string,
    allowScopeRecursion: boolean,
  ): void => {
    const sourcePath = join(sourceDir, entryName);
    const targetPath = join(targetDir, entryName);
    const entryStat = lstatSync(sourcePath);

    // Scope dir (@scope/pkg): recurse exactly one level so each scoped
    // package is linked individually. allowScopeRecursion=false on the
    // inner call prevents walking arbitrary nested trees / recursion loops.
    if (allowScopeRecursion && entryName.startsWith('@') && entryStat.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      const scopedEntries = readdirSync(sourcePath, { withFileTypes: true });
      for (const scopedEntry of scopedEntries) {
        linkNodeModuleEntry(sourcePath, targetPath, scopedEntry.name, false);
      }
      return;
    }

    symlinkNodeModuleEntry(sourceForNodeModuleEntry(sourcePath), targetPath);
  };

  const linkEntries = (sourceDir: string, targetDir: string): void => {
    mkdirSync(targetDir, { recursive: true });
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      try {
        linkNodeModuleEntry(sourceDir, targetDir, entry.name, true);
      } catch (err) {
        warn(err);
      }
    }
  };

  try {
    // 1. Root node_modules overlay (npm-hoisted externals + @scope packages).
    const rootSource = join(repoDir, 'node_modules');
    const rootTarget = join(worktreePath, 'node_modules');

    if (existsSync(rootSource)) {
      // Recurse EVERY root entry through the generic linker. Scope dirs
      // (@scope) are walked one level so each scoped package is linked
      // individually; sourceForNodeModuleEntry re-points only the symlinks
      // that resolve into repo/packages (the workspace packages) at the
      // worktree copy, leaving real external deps pointing at the source
      // install. This replaces a former @agon-only fast path: the workspace
      // scope is now @kernlang, which is MIXED — it holds both workspace
      // packages (@kernlang/agon-*) and external compiler deps
      // (@kernlang/cli, @kernlang/core, ...), so a wholesale scope symlink
      // would wrongly resolve candidate packages back to the source repo.
      // The generic path also fixes the node_modules-name vs packages-dir
      // mismatch (node_modules/@kernlang/agon-core ↔ packages/core): it maps
      // via realpath, not by assuming the entry name equals the package dir.
      linkEntries(rootSource, rootTarget);
    }

    // 2. Per-package node_modules overlay (pnpm non-hoisted layout): each
    //    packages/<p>/node_modules is recreated in the worktree.
    if (existsSync(repoPackages)) {
      const packageEntries = readdirSync(repoPackages, { withFileTypes: true });
      for (const entry of packageEntries) {
        if (!entry.isDirectory()) continue;

        const packageNodeModules = join(repoPackages, entry.name, 'node_modules');
        if (!existsSync(packageNodeModules)) continue;

        linkEntries(
          packageNodeModules,
          join(worktreePackages, entry.name, 'node_modules'),
        );
      }
    }
  } catch (err) {
    warn(err);
  }
}

/**
 * Git worktrees omit ignored package dist artifacts, but workspace package exports point at dist. Copy existing root artifacts into the candidate worktree so fitness commands can resolve local workspace packages without forcing every forge candidate to rebuild first.
 */
export function hydrateWorktreeBuildArtifacts(repoDir: string, worktreePath: string): void {
  const sourcePackages = join(repoDir, 'packages');
  const targetPackages = join(worktreePath, 'packages');
  if (!existsSync(sourcePackages) || !existsSync(targetPackages)) return;
  try {
    const packageEntries = readdirSync(sourcePackages, { withFileTypes: true });
    for (const entry of packageEntries) {
      if (!entry.isDirectory()) continue;
      const sourceDist = join(sourcePackages, entry.name, 'dist');
      const targetDist = join(targetPackages, entry.name, 'dist');
      const targetPackage = join(targetPackages, entry.name);
      if (!existsSync(sourceDist) || !existsSync(targetPackage) || existsSync(targetDist)) continue;
      cpSync(sourceDist, targetDist, { recursive: true, dereference: true });
    }
  } catch (err) {
    console.warn(`[agon] worktree artifact hydration failed for ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
