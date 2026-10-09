import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

import { join } from 'node:path';

import { execFileSync, execSync } from 'node:child_process';

import { normalizePatchContent } from './patch-content.js';

import { invertPatch } from './patch-parser.js';

export interface PatchInfo {
  path: string;
  engineId: string;
  lineCount: number;
  content: string;
}

export interface ApplyPreflight {
  ok: boolean;
  error?: string;
  patch?: PatchInfo;
  dirtyTree: boolean;
  /** Git patches use repository-relative paths even when invoked below root. */
  workspace?: string;
}

export function readPatchFromManifest(manifestPath: string): PatchInfo|null {
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest: { winner: string | null; patches: Record<string, string> } = JSON.parse(raw);
    if (!manifest.winner) return null;
    const patchPath = manifest.patches[manifest.winner];
    if (!patchPath) return null;
    const content = normalizePatchContent(readFileSync(patchPath, 'utf-8'));
    if (!content.trim()) return null;
    const lineCount = content.split('\n').filter(
      (l: string) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    ).length;
    return { path: patchPath, engineId: manifest.winner, lineCount, content };
  } catch (err) {
    console.warn(`[agon] failed to read patch from manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function readPatchFromPath(patchPath: string): PatchInfo|null {
  try {
    const content = normalizePatchContent(readFileSync(patchPath, 'utf-8'));
    if (!content.trim()) return null;
    const lineCount = content.split('\n').filter(
      (l: string) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    ).length;
    return { path: patchPath, engineId: 'unknown', lineCount, content };
  } catch (err) {
    console.warn(`[agon] failed to read patch from ${patchPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** A failed probe is unknown, never permission to treat the tree as clean. */
export function inspectWorkingTree(cwd: string): { ok: true; dirtyTree: boolean } | { ok: false; error: string } {
  try {
    const result = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, dirtyTree: result.trim().length > 0 };
  } catch (err) {
    return { ok: false, error: `Cannot check working tree: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function isTreeDirty(cwd: string): boolean {
  const state = inspectWorkingTree(cwd);
  if (!state.ok) console.warn(`[agon] ${state.error}`);
  return state.ok ? state.dirtyTree : true;
}

export function dryRunApply(cwd: string, patchContent: string): { ok:boolean, error?:string } {
  try {
    execSync('git apply --check -', { cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function applyPatchToTree(cwd: string, patchContent: string): { ok:boolean, error?:string } {
  try {
    execSync('git apply --allow-empty -', { cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function preflightApply(cwd: string, patchPath: string|null, manifestPath: string|null,
  options: { allowDirty?: boolean } = {}): ApplyPreflight {
  const state = inspectWorkingTree(cwd);
  if (!state.ok) return { ok: false, error: state.error, dirtyTree: false };
  const dirtyTree = state.dirtyTree;
  let workspace: string;
  try {
    workspace = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).replace(/\r?\n$/, '');
  } catch (error) {
    return { ok: false, dirtyTree, error: `Cannot resolve patch target: ${error instanceof Error ? error.message : String(error)}` };
  }
  let patch: PatchInfo | null = null;
  if (patchPath) {
    patch = readPatchFromPath(patchPath);
  } else if (manifestPath) {
    patch = readPatchFromManifest(manifestPath);
  }
  if (!patch) {
    return { ok: false, error: 'No patch found. Run /forge first or provide a path.', dirtyTree: dirtyTree };
  }
  if (dirtyTree && options.allowDirty !== true) {
    return { ok: false, error: 'Working tree has uncommitted changes. Commit or stash first, or use /apply --force.', patch: patch, dirtyTree: dirtyTree };
  }
  const dryRun = dryRunApply(workspace, patch.content);
  if (!dryRun.ok) {
    return { ok: false, error: `Patch would not apply cleanly: ${dryRun.error}`, patch: patch, dirtyTree: dirtyTree };
  }
  return { ok: true, patch, dirtyTree, workspace };
}

/**
 * Apply patch and save an inverse for undo.
 */
export function applyPatchWithUndo(cwd: string, patchContent: string, undoDir: string): { ok:boolean, error?:string, undoToken?:string } {
  mkdirSync(undoDir, { recursive: true });

  // Compute inverse before applying
  const inverse = invertPatch(patchContent);
  const token = `undo-${Date.now()}`;

  // Apply the patch
  try {
    execSync('git apply --allow-empty -', { cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }

  // Save inverse patch atomically (temp + rename)
  const inversePath = join(undoDir, `${token}.patch`);
  const tmpPath = join(undoDir, `${token}.patch.tmp`);
  writeFileSync(tmpPath, inverse);
  renameSync(tmpPath, inversePath);

  return { ok: true, undoToken: token };
}

/**
 * Apply the saved inverse patch to undo a previous apply.
 */
export function undoPatch(cwd: string, undoToken: string, undoDir: string): { ok:boolean, error?:string } {
  const inversePath = join(undoDir, `${undoToken}.patch`);

  let inverse: string;
  try {
    inverse = readFileSync(inversePath, 'utf-8');
  } catch {
    return { ok: false, error: `Undo token not found: ${undoToken}` };
  }

  try {
    execSync('git apply --allow-empty -', { cwd, input: normalizePatchContent(inverse), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: `Undo failed: ${msg}` };
  }
}
