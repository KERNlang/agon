import { closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { dirname, join, parse, resolve, sep } from 'node:path';

import { execFileSync, execSync } from 'node:child_process';

import { normalizePatchContent } from './patch-content.js';

import { invertPatch } from './patch-parser.js';
import { preparePatchForUndo } from './patch-materialization.js';

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

/** Never repair invalid bytes: replacement characters can change patch effects. */
function readUtf8Artifact(path: string | number): string {
  const bytes = readFileSync(path);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    throw new Error('Artifact is not valid UTF-8.', { cause });
  }
}

/** Read exact patch text, including empty files. Throws on I/O or invalid UTF-8. */
export function readPatchContent(path: string): string {
  return readUtf8Artifact(path);
}

export function readPatchFromManifest(manifestPath: string): PatchInfo|null {
  try {
    const raw = readUtf8Artifact(manifestPath);
    const manifest: { winner: string | null; patches: Record<string, string> } = JSON.parse(raw);
    if (!manifest.winner) return null;
    const patchPath = manifest.patches[manifest.winner];
    if (!patchPath) return null;
    const content = normalizePatchContent(readPatchContent(patchPath));
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
    const content = normalizePatchContent(readPatchContent(patchPath));
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

/** Git patch paths are relative to the repository root, not the active folder. */
function patchWorkspace(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).replace(/\r?\n$/, '');
}

export function dryRunApply(cwd: string, patchContent: string): { ok:boolean, error?:string } {
  try {
    cwd = patchWorkspace(cwd);
    execSync('git apply --check -', { cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function applyPatchToTree(cwd: string, patchContent: string, options: { reverse?: boolean } = {}): { ok:boolean, error?:string } {
  try {
    cwd = patchWorkspace(cwd);
    execFileSync('git', ['apply', '--allow-empty', ...(options.reverse ? ['--reverse'] : []), '-'], {
      cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
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
    workspace = patchWorkspace(cwd);
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

/** Recognize only the fixed macOS directory aliases. */
function systemUndoAlias(directory: string): string | undefined {
  if (process.platform !== 'darwin' || (directory !== '/tmp' && directory !== '/var')) return;
  const target = `/private${directory}`;
  if (lstatSync(directory).isSymbolicLink()
    && resolve(dirname(directory), readlinkSync(directory)) === target
    && lstatSync(target).isDirectory()) return target;
}

/** Reject pre-existing directory redirection, not a hostile same-user race sandbox. */
function checkUndoDirectory(undoDir: string, allowMissing: boolean): void {
  const absolute = resolve(undoDir);
  let directory = parse(absolute).root;
  for (const component of absolute.slice(directory.length).split(sep).filter(Boolean)) {
    directory = join(directory, component);
    let stat;
    try { stat = lstatSync(directory); }
    catch (error) {
      // The existing ancestry was checked before any directory creation.
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      // Preserve macOS's fixed OS aliases, not arbitrary user-controlled links.
      if (systemUndoAlias(directory)) continue;
      throw new Error(`Undo directory contains a symbolic link: ${directory}`);
    }
    if (!stat.isDirectory()) throw new Error(`Undo parent is not a directory: ${directory}`);
  }
}

/** Persist directory-entry changes without following a substituted final link. */
function syncUndoDirectory(directory: string): void {
  const descriptor = openSync(systemUndoAlias(directory) ?? directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** Retire the record and persist its absence. */
function removeUndoRecord(path: string): void {
  try { unlinkSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  syncUndoDirectory(dirname(path));
}

/** Apply patch and save an inverse for undo. */
export function applyPatchWithUndo(cwd: string, patchContent: string, undoDir: string): { ok:boolean, error?:string, undoToken?:string } {
  undoDir = resolve(undoDir);
  let inverse: string;
  let prepared: ReturnType<typeof preparePatchForUndo>;
  try {
    checkUndoDirectory(undoDir, true);
    cwd = patchWorkspace(cwd);
    prepared = preparePatchForUndo(cwd, normalizePatchContent(patchContent));
    patchContent = prepared.content;
    inverse = invertPatch(patchContent);
  } catch (error) {
    return { ok: false, error: `Cannot prepare undo record; no patch applied: ${error instanceof Error ? error.message : String(error)}` };
  }
  const token = `undo-${randomUUID()}`;
  const inversePath = join(undoDir, `${token}.patch`);
  let ownsRecord = false;

  // The token is published only after apply succeeds. Refuse mutation unless
  // its complete undo record has been written first. Exclusive creation must
  // never overwrite an earlier operation, even on an identifier collision.
  try {
    checkUndoDirectory(undoDir, true);
    const firstCreated = mkdirSync(undoDir, { recursive: true });
    checkUndoDirectory(undoDir, false);
    const descriptor = openSync(inversePath, 'wx', 0o600);
    ownsRecord = true;
    try {
      writeFileSync(descriptor, inverse, 'utf8');
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    // Persist the record's directory entry, then each newly created directory
    // entry up to its existing parent. File fsync alone cannot persist names.
    const lastDirectory = firstCreated ? dirname(resolve(firstCreated)) : resolve(undoDir);
    let directory = resolve(undoDir);
    for (;;) {
      syncUndoDirectory(directory);
      if (directory === lastDirectory) break;
      directory = dirname(directory);
    }
  } catch (error) {
    if (ownsRecord) {
      try { removeUndoRecord(inversePath); } catch { /* Preserve the storage failure. */ }
    }
    return { ok: false, error: `Cannot save undo record; no patch applied: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    prepared.verifySources();
    execSync('git apply --allow-empty -', { cwd, input: normalizePatchContent(patchContent), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    try { removeUndoRecord(inversePath); } catch { /* An unused record must not mask the apply error. */ }
    return { ok: false, error: msg };
  }

  return { ok: true, undoToken: token };
}

/**
 * Apply the saved inverse patch to undo a previous apply.
 */
export function undoPatch(cwd: string, undoToken: string, undoDir: string): { ok:boolean, error?:string, warning?:string } {
  if (typeof undoToken !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(undoToken)) {
    return { ok: false, error: 'Invalid undo token.' };
  }
  undoDir = resolve(undoDir);
  const inversePath = join(undoDir, `${undoToken}.patch`);

  let inverse: string;
  try {
    checkUndoDirectory(undoDir, false);
    // Open without following links, then inspect/read that same descriptor.
    // Nonblocking open also prevents a substituted FIFO from hanging the host.
    const descriptor = openSync(inversePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(descriptor).isFile()) throw new Error('Undo artifact is not a regular file');
      inverse = readUtf8Artifact(descriptor);
    } finally { closeSync(descriptor); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, error: `Undo token not found: ${undoToken}` };
    if (code === 'ELOOP') return { ok: false, error: `Undo record is a symbolic link; refusing token: ${undoToken}` };
    return { ok: false, error: `Cannot read undo record '${undoToken}': ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    cwd = patchWorkspace(cwd);
    execSync('git apply --allow-empty -', { cwd, input: normalizePatchContent(inverse), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return { ok: false, error: `Undo failed: ${msg}` };
  }
  // Reversal is already complete. A cleanup failure must not invite a retry.
  try {
    removeUndoRecord(inversePath);
  } catch (error) {
    return { ok: true, warning: `Patch reverted, but undo record '${undoToken}' could not be durably retired: ${error instanceof Error ? error.message : String(error)}. Do not reuse this token.` };
  }
  return { ok: true };
}
