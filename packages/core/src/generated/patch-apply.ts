import { readFileSync } from 'node:fs';

import { execSync } from 'node:child_process';

import type { ForgeManifest } from './types.js';

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
}

export function readPatchFromManifest(manifestPath: string): PatchInfo|null {
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest: ForgeManifest = JSON.parse(raw);
    if (!manifest.winner) return null;
    const patchPath = manifest.patches[manifest.winner];
    if (!patchPath) return null;
    const content = readFileSync(patchPath, 'utf-8');
    const lineCount = content.split('\n').filter(
      (l: string) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    ).length;
    return { path: patchPath, engineId: manifest.winner, lineCount, content };
  } catch {
    return null;
  }
  
}

export function readPatchFromPath(patchPath: string): PatchInfo|null {
  try {
    const content = readFileSync(patchPath, 'utf-8');
    if (!content.trim()) return null;
    const lineCount = content.split('\n').filter(
      (l: string) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    ).length;
    return { path: patchPath, engineId: 'unknown', lineCount, content };
  } catch {
    return null;
  }
  
}

export function isTreeDirty(cwd: string): boolean {
  try {
    const result = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
  
}

export function dryRunApply(cwd: string, patchContent: string): { ok:boolean, error?:string } {
  try {
    execSync('git apply --check -', { cwd, input: patchContent, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }
  
}

export function applyPatchToTree(cwd: string, patchContent: string): { ok:boolean, error?:string } {
  try {
    execSync('git apply --allow-empty -', { cwd, input: patchContent, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }
  
}

export function preflightApply(cwd: string, patchPath: string|null, manifestPath: string|null): ApplyPreflight {
  const dirtyTree = isTreeDirty(cwd);
  
  let patch: PatchInfo | null = null;
  if (patchPath) {
    patch = readPatchFromPath(patchPath);
  } else if (manifestPath) {
    patch = readPatchFromManifest(manifestPath);
  }
  
  if (!patch) {
    return { ok: false, error: 'No patch found. Run /forge first or provide a path.', dirtyTree };
  }
  
  if (dirtyTree) {
    return { ok: false, error: 'Working tree has uncommitted changes. Commit or stash first, or use /apply --force.', patch, dirtyTree };
  }
  
  const dryRun = dryRunApply(cwd, patch.content);
  if (!dryRun.ok) {
    return { ok: false, error: `Patch would not apply cleanly: ${dryRun.error}`, patch, dirtyTree };
  }
  
  return { ok: true, patch, dirtyTree };
  
}

