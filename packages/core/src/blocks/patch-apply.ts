/** A13-PATCH-BACKEND: compatibility exports only. The physical owner is
 * agon-support-worktree. Remove after legacy core callers have migrated. */
import { applyPatchWithUndo as applyWithUndo, undoPatch as undo } from '@kernlang/agon-support-worktree';
import { getUndoDir } from '../utils/paths.js';

export { readPatchFromManifest, readPatchFromPath, isTreeDirty, dryRunApply,
  preflightApply, applyPatchToTree } from '@kernlang/agon-support-worktree';
export type { PatchInfo, ApplyPreflight } from '@kernlang/agon-support-worktree';

/** Preserve the historical undo location while the backend owns the operation. */
export function applyPatchWithUndo(cwd: string, patchContent: string): { ok: boolean; error?: string; undoToken?: string } {
  return applyWithUndo(cwd, patchContent, getUndoDir());
}

export function undoPatch(cwd: string, undoToken: string): ReturnType<typeof undo> {
  return undo(cwd, undoToken, getUndoDir());
}
