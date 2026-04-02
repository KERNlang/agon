import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { join, resolve, basename } from 'node:path';

import { AGON_HOME, ensureAgonHome } from '../config.js';

import { isKernProject } from '../context-scanner.js';

import { headSha, currentBranch, isDirty } from './git.js';

import type { WorkspaceSnapshot } from './plan.js';

export interface Workspace {
  id: string;
  path: string;
  name: string;
  isKern: boolean;
  addedAt: number;
}

export interface WorkspaceState {
  workspaces: Workspace[];
  active: string;
}

function loadState(): WorkspaceState {
  const WORKSPACES_PATH = join(AGON_HOME, 'workspaces.json');
  ensureAgonHome();
  try { return JSON.parse(readFileSync(WORKSPACES_PATH, 'utf-8')) as WorkspaceState; }
  catch { return { workspaces: [], active: '' }; }
}

function saveState(state: WorkspaceState): void {
  const WORKSPACES_PATH = join(AGON_HOME, 'workspaces.json');
  writeFileSync(WORKSPACES_PATH, JSON.stringify(state, null, 2) + '\n');
}

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

export function listWorkspaces(): Workspace[] {
  return loadState().workspaces;
}

export function getActiveWorkspace(): Workspace|null {
  const state = loadState();
  return state.workspaces.find((w) => w.id === state.active) ?? null;
}

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

export function getWorkspace(idOrPath: string): Workspace|null {
  const state = loadState();
  return state.workspaces.find(
    (w) => w.id === idOrPath || w.path === resolve(idOrPath) || w.name === idOrPath,
  ) ?? null;
}

export function snapshotWorkspace(ws: Workspace): WorkspaceSnapshot {
  let sha = 'unknown';
  try { sha = headSha(ws.path); } catch {}
  return {
    id: ws.id, path: ws.path, headSha: sha,
    branch: currentBranch(ws.path), dirty: isDirty(ws.path),
  };
}

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

