import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { prepareSandboxNodeModules, clearShadowingDist, workspacePackageDirs } from '@kernlang/agon-support-worktree';

export {
  SKIP_NODE_MODULES_ENTRIES, BUILD_OUTPUT_CANDIDATES, MAX_WORKSPACE_GLOB_DEPTH,
  isSafePackageName, pnpmWorkspaceGlobs, workspaceGlobToRegExp, expandWorkspaceGlob,
  workspacePackageDirs, isInside, repointWorkspaceLinks, prepareSandboxNodeModules,
  packageEntryDirs, gitIgnoredPaths, clearShadowingDist,
} from '@kernlang/agon-support-worktree';
export type { SandboxNodeModules, SandboxLinkRepair } from '@kernlang/agon-support-worktree';

export interface NodeSandboxPrep {
  node: boolean;
  clearedDist: string[];
  eventData: Record<string, unknown>;
}

/**
 * Point the sandbox's workspace packages at its own sources and clear prebuilt bundles that would shadow a mutated package — only when the sandbox root has a package.json; any other project gets no Node preparation and no Node event fields.
 */
export function prepareNodeSandbox(repoRoot: string, worktree: string, targetFiles: string[]): NodeSandboxPrep {
  if (!existsSync(join(worktree, 'package.json'))) return { node: false, clearedDist: [], eventData: {} };
  const workspaces = workspacePackageDirs(repoRoot);
  const nodeModules = prepareSandboxNodeModules(repoRoot, worktree, workspaces);
  const clearedDist = clearShadowingDist(repoRoot, worktree, targetFiles, workspaces);
  const failedNote = nodeModules.failed > 0 ? `, ${nodeModules.failed} failed` : '';
  return {
    node: true,
    clearedDist,
    eventData: {
      nodeModules: `${nodeModules.mode} (${nodeModules.links} links, ${nodeModules.workspaceLinks} workspace links${failedNote})`,
      nodeModulesFailed: nodeModules.failed,
      distCleared: clearedDist,
    },
  };
}
