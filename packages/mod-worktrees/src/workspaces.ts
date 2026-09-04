import {
  addWorkspaceBookmark,
  getActiveWorkspaceBookmark,
  listWorkspaceBookmarks,
  removeWorkspaceBookmark,
  switchWorkspaceBookmark,
  type WorkspaceBookmark,
  type WorkspaceBookmarkRuntime,
} from '@kernlang/agon-support-worktree';

import { agonHome, sessionRuntime } from './runtime.js';

const runtime: WorkspaceBookmarkRuntime = Object.freeze({
  getAgonHome: agonHome,
  ensureAgonHome: sessionRuntime.ensureAgonHome,
  now: Date.now,
});

export type { WorkspaceBookmark };
export const listWorkspaces = (): WorkspaceBookmark[] => listWorkspaceBookmarks(runtime);
export const getActiveWorkspace = (): WorkspaceBookmark | null => getActiveWorkspaceBookmark(runtime);
export const addWorkspace = (path: string): WorkspaceBookmark => addWorkspaceBookmark(path, runtime);
export const removeWorkspace = (idOrPath: string): boolean => removeWorkspaceBookmark(idOrPath, runtime);
export const switchWorkspace = (idOrPath: string): WorkspaceBookmark | null => switchWorkspaceBookmark(idOrPath, runtime);
