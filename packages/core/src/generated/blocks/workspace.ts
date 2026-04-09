// @kern-source: workspace:1
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';

// @kern-source: workspace:2
import { join, resolve, basename } from 'node:path';

// @kern-source: workspace:3
import { AGON_HOME, ensureAgonHome } from '../signals/config.js';

// @kern-source: workspace:4
import { isKernProject } from './context-scanner.js';

// @kern-source: workspace:5
import { headSha, currentBranch, isDirty } from './git.js';

// @kern-source: workspace:6
import type { WorkspaceSnapshot } from './plan.js';

// @kern-source: workspace:8
export interface Workspace {
  id: string;
  path: string;
  name: string;
  isKern: boolean;
  addedAt: number;
}

// @kern-source: workspace:15
export interface WorkspaceState {
  workspaces: Workspace[];
  active: string;
}

// @kern-source: workspace:19
function loadState(): WorkspaceState {
  const WORKSPACES_PATH = join(AGON_HOME, 'workspaces.json');
  ensureAgonHome();
  try { return JSON.parse(readFileSync(WORKSPACES_PATH, 'utf-8')) as WorkspaceState; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] workspace state corrupted, resetting to defaults: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { workspaces: [], active: '' };
  }
}

// @kern-source: workspace:32
function saveState(state: WorkspaceState): void {
  const WORKSPACES_PATH = join(AGON_HOME, 'workspaces.json');
  const tmpPath = WORKSPACES_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmpPath, WORKSPACES_PATH);
}

// @kern-source: workspace:40
export function addWorkspace(rawPath: string): Workspace {
  const path = resolve(rawPath);
  const state = loadState();
  const existing = state.workspaces.find((w) => w.path === path);
  if (existing) return existing;
  
  const id = basename(path).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const name = basename(path);
  const ws: Workspace = { id, path, name, isKern: isKernProject(path), addedAt: Date.now() };
  state.workspaces.push(ws);
  if (state.workspaces.length === 1) state.active = ws.id;
  saveState(state);
  return ws;
}

// @kern-source: workspace:56
export function removeWorkspace(idOrPath: string): boolean {
  const state = loadState();
  const idx = state.workspaces.findIndex(
    (w) => w.id === idOrPath || w.path === resolve(idOrPath),
  );
  if (idx === -1) return false;
  const removed = state.workspaces.splice(idx, 1)[0];
  if (state.active === removed.id) state.active = state.workspaces[0]?.id ?? '';
  saveState(state);
  return true;
}

// @kern-source: workspace:69
export function listWorkspaces(): Workspace[] {
  return loadState().workspaces;
}

// @kern-source: workspace:74
export function getActiveWorkspace(): Workspace|null {
  const state = loadState();
  return state.workspaces.find((w) => w.id === state.active) ?? null;
}

// @kern-source: workspace:80
export function switchWorkspace(idOrPath: string): Workspace|null {
  const state = loadState();
  const ws = state.workspaces.find(
    (w) => w.id === idOrPath || w.path === resolve(idOrPath) || w.name === idOrPath,
  );
  if (!ws) return null;
  state.active = ws.id;
  saveState(state);
  return ws;
}

// @kern-source: workspace:92
export function getWorkspace(idOrPath: string): Workspace|null {
  const state = loadState();
  return state.workspaces.find(
    (w) => w.id === idOrPath || w.path === resolve(idOrPath) || w.name === idOrPath,
  ) ?? null;
}

// @kern-source: workspace:100
export function snapshotWorkspace(ws: Workspace): WorkspaceSnapshot {
  let sha = 'unknown';
  try { sha = headSha(ws.path); } catch (err) {
    console.warn(`[agon] failed to get HEAD sha for ${ws.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let branch = 'unknown';
  try { branch = currentBranch(ws.path); } catch (err) {
    console.warn(`[agon] failed to get branch for ${ws.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let dirty = false;
  try { dirty = isDirty(ws.path); } catch (err) {
    console.warn(`[agon] failed to check dirty state for ${ws.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    id: ws.id, path: ws.path, headSha: sha,
    branch, dirty,
  };
}

// @kern-source: workspace:120
export function resolveWorkingDir(): string {
  const ws = getActiveWorkspace();
  return ws ? ws.path : process.cwd();
}

// @kern-source: workspace:127
export function ensureCurrentWorkspace(cwd: string): Workspace {
  const state = loadState();
  const path = resolve(cwd);
  const existing = state.workspaces.find((w) => w.path === path);
  if (existing) {
    if (state.active !== existing.id) {
      state.active = existing.id;
      saveState(state);
    }
    return existing;
  }
  return addWorkspace(cwd);
}

