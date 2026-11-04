import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export interface WorkspaceBookmark {
  id: string;
  path: string;
  name: string;
  isKern: boolean;
  addedAt: number;
}

export interface WorkspaceBookmarkRuntime {
  getAgonHome(): string;
  ensureAgonHome(): void;
  now(): number;
}

export interface WorkspaceState { workspaces: WorkspaceBookmark[]; active: string }

function statePath(runtime: WorkspaceBookmarkRuntime): string { return join(runtime.getAgonHome(), 'workspaces.json'); }

function isKernProject(path: string): boolean {
  if (existsSync(join(path, 'kern.config.ts'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    if ('kern-lang' in { ...pkg.dependencies, ...pkg.devDependencies }) return true;
  } catch { /* non-Node workspace */ }
  for (const directory of [path, join(path, 'src')]) {
    try { if (readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith('.kern'))) return true; }
    catch { /* absent/unreadable directory */ }
  }
  return false;
}

function load(runtime: WorkspaceBookmarkRuntime): WorkspaceState {
  runtime.ensureAgonHome();
  try {
    const parsed = JSON.parse(readFileSync(statePath(runtime), 'utf8')) as WorkspaceState;
    return Array.isArray(parsed.workspaces) && typeof parsed.active === 'string' ? parsed : { workspaces: [], active: '' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] workspace state corrupted, resetting to defaults: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { workspaces: [], active: '' };
  }
}

function save(value: WorkspaceState, runtime: WorkspaceBookmarkRuntime): void {
  runtime.ensureAgonHome();
  const target = statePath(runtime);
  const temporary = `${target}.tmp.${process.pid}.${runtime.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
}

export function listWorkspaceBookmarks(runtime: WorkspaceBookmarkRuntime): WorkspaceBookmark[] { return load(runtime).workspaces; }

export function getActiveWorkspaceBookmark(runtime: WorkspaceBookmarkRuntime): WorkspaceBookmark | null {
  const state = load(runtime);
  return state.workspaces.find((workspace) => workspace.id === state.active) ?? null;
}

export function addWorkspaceBookmark(rawPath: string, runtime: WorkspaceBookmarkRuntime): WorkspaceBookmark {
  const path = resolve(rawPath);
  const state = load(runtime);
  const existing = state.workspaces.find((workspace) => workspace.path === path);
  if (existing) return existing;
  const name = basename(path);
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const workspace = { id, path, name, isKern: isKernProject(path), addedAt: runtime.now() };
  state.workspaces.push(workspace);
  if (state.workspaces.length === 1) state.active = workspace.id;
  save(state, runtime);
  return workspace;
}

export function removeWorkspaceBookmark(idOrPath: string, runtime: WorkspaceBookmarkRuntime): boolean {
  const state = load(runtime);
  const resolved = resolve(idOrPath);
  const index = state.workspaces.findIndex((workspace) => workspace.id === idOrPath || workspace.path === resolved);
  if (index < 0) return false;
  const [removed] = state.workspaces.splice(index, 1);
  if (state.active === removed.id) state.active = state.workspaces[0]?.id ?? '';
  save(state, runtime);
  return true;
}

export function switchWorkspaceBookmark(idOrPath: string, runtime: WorkspaceBookmarkRuntime): WorkspaceBookmark | null {
  const state = load(runtime);
  const resolved = resolve(idOrPath);
  const workspace = state.workspaces.find((candidate) => candidate.id === idOrPath || candidate.path === resolved || candidate.name === idOrPath);
  if (!workspace) return null;
  state.active = workspace.id;
  save(state, runtime);
  return workspace;
}
