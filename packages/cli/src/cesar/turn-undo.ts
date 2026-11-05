import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { agonPath, getProjectFileStateCache, hasRedirection, hasSubstitution, isReadOnlyCommand, loadConfig, resolveRulePath } from '@kernlang/agon-core';
import type { ToolContext, ToolHandler, ToolResult } from '@kernlang/agon-core';

import { isBashToolName, isWriteToolName } from './brain-helpers.js';
import { mutatedPathFromToolArgs } from './mutate-reflex.js';

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AGE_HOURS = 168;
const BINARY_SNIFF_BYTES = 8192;
const FILE_MUTATION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
const JOBS_THAT_DO_NOT_EDIT = new Set(['brainstorm', 'team-brainstorm', 'tribunal', 'team-tribunal', 'review', 'council', 'campfire', 'think', 'synthesis', 'speculate', 'research', 'nero', 'mutate', 'chrome']);

type PreState =
  | { kind: 'absent' }
  | { kind: 'file'; hash: string; mode: number }
  | { kind: 'unavailable'; reason: string; signature: string };

type DiskState = { kind: 'absent' } | { kind: 'file'; hash: string } | { kind: 'other' };

interface TrackedFile {
  path: string;
  realPath: string;
  aliases: Set<string>;
  pre: PreState;
  post?: DiskState;
}

interface UndoTurn {
  cwd: string;
  lastChangeAt: number;
  files: Map<string, TrackedFile>;
  bash: Set<string>;
  observedWrites: Set<string>;
  otherActivity: Set<string>;
}

interface UndoSession {
  dir: string | null;
  tracking: boolean;
  boundaryPending: boolean;
  turns: UndoTurn[];
  blobs: Map<string, number>;
  droppedTurns: number;
  notice: string[];
  generation: number;
}

export interface TurnUndoReport {
  status: 'empty' | 'other-workspace' | 'undone';
  cwd: string;
  restored: string[];
  removed: string[];
  refused: { path: string; reason: string }[];
  notUndoable: { path: string; reason: string }[];
  bashCommands: string[];
  untrackedWrites: string[];
  otherActivity: string[];
  remainingTurns: number;
  droppedTurns: number;
}

const newSession = (): UndoSession => ({ dir: null, tracking: false, boundaryPending: false, turns: [], blobs: new Map(), droppedTurns: 0, notice: [], generation: 0 });
let session = newSession();
let exitHookInstalled = false;

function positiveLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function undoLimits(cwd: string) {
  const config = loadConfig(cwd) as unknown as Record<string, unknown>;
  const rawTurns = config.undoMaxTurns;
  return {
    maxTurns: rawTurns === 0 ? 0 : positiveLimit(rawTurns, DEFAULT_MAX_TURNS),
    maxFileBytes: positiveLimit(config.undoMaxFileBytes, DEFAULT_MAX_FILE_BYTES),
    maxTotalBytes: positiveLimit(config.undoMaxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
    maxAgeHours: positiveLimit(config.undoMaxAgeHours, DEFAULT_MAX_AGE_HOURS),
  };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export function closeUndoSession(): void {
  const dir = session.dir;
  session = newSession();
  if (dir) rmSync(dir, { recursive: true, force: true });
}

function pruneStaleSessions(root: string, maxAgeHours: number, keep: string): void {
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (dir === keep) continue;
    try {
      const stat = lstatSync(dir);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
    } catch { /* another session may be removing its own directory */ }
  }
}

function ensureSessionDir(cwd: string): string {
  if (session.dir) return session.dir;
  const root = agonPath('cesar-undo');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('undo state directory is not a private directory');
  chmodSync(root, 0o700);
  const dir = join(root, randomUUID());
  mkdirSync(dir, { mode: 0o700 });
  session.dir = dir;
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => { try { closeUndoSession(); } catch { /* exiting */ } });
  }
  pruneStaleSessions(root, undoLimits(cwd).maxAgeHours, dir);
  return dir;
}

function releaseUnreferencedBlobs(): void {
  const referenced = new Set<string>();
  for (const turn of session.turns) {
    for (const file of turn.files.values()) if (file.pre.kind === 'file') referenced.add(file.pre.hash);
  }
  for (const hash of [...session.blobs.keys()]) {
    if (referenced.has(hash)) continue;
    session.blobs.delete(hash);
    if (session.dir) rmSync(join(session.dir, hash), { force: true });
  }
}

function dropOldestTurn(): void {
  session.turns.shift();
  session.droppedTurns += 1;
  releaseUnreferencedBlobs();
}

const totalBlobBytes = (): number => [...session.blobs.values()].reduce((sum, size) => sum + size, 0);

function storeBlob(hash: string, bytes: Buffer, cwd: string, current: UndoTurn): boolean {
  if (session.blobs.has(hash)) return true;
  const { maxTotalBytes } = undoLimits(cwd);
  while (totalBlobBytes() + bytes.length > maxTotalBytes && session.turns[0] && session.turns[0] !== current) dropOldestTurn();
  if (totalBlobBytes() + bytes.length > maxTotalBytes) return false;
  writeFileSync(join(ensureSessionDir(cwd), hash), bytes, { mode: 0o600, flag: 'wx' });
  session.blobs.set(hash, bytes.length);
  return true;
}

function isEmptyTurn(turn: UndoTurn): boolean {
  return turn.files.size === 0 && turn.bash.size === 0 && turn.observedWrites.size === 0 && turn.otherActivity.size === 0;
}

function currentTurn(cwd: string): UndoTurn | null {
  if (!session.tracking) return null;
  const { maxTurns } = undoLimits(cwd);
  if (maxTurns === 0) return null;
  const top = session.turns[session.turns.length - 1];
  if (top && !session.boundaryPending) return top;
  if (top && isEmptyTurn(top)) session.turns.pop();
  session.boundaryPending = false;
  const turn: UndoTurn = { cwd: resolve(cwd), lastChangeAt: Date.now(), files: new Map(), bash: new Set(), observedWrites: new Set(), otherActivity: new Set() };
  session.turns.push(turn);
  while (session.turns.length > maxTurns) dropOldestTurn();
  return turn;
}

function statSignature(path: string): string {
  try { const stat = statSync(path); return `${stat.size}:${stat.mtimeMs}`; } catch { return 'absent'; }
}

function capturePreState(path: string, realPath: string, turn: UndoTurn): PreState {
  const unavailable = (reason: string): PreState => ({ kind: 'unavailable', reason, signature: statSignature(realPath) });
  try {
    let link;
    try { link = lstatSync(path); } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { kind: 'absent' };
      throw error;
    }
    if (link.isSymbolicLink() && statSignature(path) === 'absent') return unavailable('dangling symlink');
    const stat = statSync(realPath);
    if (!stat.isFile()) return unavailable('not a regular file');
    const { maxFileBytes } = undoLimits(turn.cwd);
    if (stat.size > maxFileBytes) return unavailable(`${stat.size} bytes is over undoMaxFileBytes (${maxFileBytes})`);
    const bytes = readFileSync(realPath);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return unavailable('binary file');
    const hash = sha256(bytes);
    if (!storeBlob(hash, bytes, turn.cwd, turn)) return unavailable('undoMaxTotalBytes storage limit reached');
    return { kind: 'file', hash, mode: stat.mode & 0o7777 };
  } catch (error) {
    return unavailable(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readDiskState(realPath: string): DiskState {
  try {
    const stat = lstatSync(realPath);
    if (!stat.isFile()) return { kind: 'other' };
    return { kind: 'file', hash: sha256(readFileSync(realPath)) };
  } catch (error: any) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? { kind: 'absent' } : { kind: 'other' };
  }
}

function matchesPre(pre: PreState, state: DiskState): boolean {
  if (pre.kind === 'absent') return state.kind === 'absent';
  return pre.kind === 'file' && state.kind === 'file' && state.hash === pre.hash;
}

function sameDiskState(a: DiskState | undefined, b: DiskState): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind !== 'file' || a.hash === (b as { hash: string }).hash;
}

interface PendingMutation { turn: UndoTurn; file: TrackedFile; first: boolean }

function beginFileMutation(rawPath: string, cwd: string): PendingMutation | null {
  const turn = currentTurn(cwd);
  if (!turn) return null;
  const path = resolve(cwd, rawPath);
  const realPath = resolveRulePath(path, cwd);
  const existing = turn.files.get(realPath);
  if (existing) {
    existing.aliases.add(path);
    return { turn, file: existing, first: false };
  }
  const file: TrackedFile = { path, realPath, aliases: new Set([path]), pre: capturePreState(path, realPath, turn) };
  turn.files.set(realPath, file);
  return { turn, file, first: true };
}

function finishFileMutation({ turn, file, first }: PendingMutation, ok: boolean): void {
  if (file.pre.kind === 'unavailable') {
    if (first && !ok && statSignature(file.realPath) === file.pre.signature) turn.files.delete(file.realPath);
    return;
  }
  const state = readDiskState(file.realPath);
  file.post = state;
  if (first && matchesPre(file.pre, state)) {
    turn.files.delete(file.realPath);
    return;
  }
  turn.lastChangeAt = Date.now();
}

export function markUserTurnBoundary(): void {
  session.tracking = true;
  session.boundaryPending = true;
}

export function bashMayMutate(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return !isReadOnlyCommand(trimmed)
    || hasRedirection(trimmed.replace(/\d*>>?\s*(?:\/dev\/null\b|&\d)/g, ''))
    || hasSubstitution(trimmed)
    || /\bfind\b[^|;&]*\s-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/.test(trimmed);
}

function noteBash(command: string, cwd: string): void {
  if (!bashMayMutate(command)) return;
  const turn = currentTurn(cwd);
  if (!turn) return;
  turn.bash.add(command.trim());
  turn.lastChangeAt = Date.now();
}

export function noteUntrackedActivity(label: string, cwd: string): void {
  const turn = currentTurn(cwd);
  if (!turn) return;
  turn.otherActivity.add(label);
  turn.lastChangeAt = Date.now();
}

export function noteDelegatedJob(type: string, cwd: string): void {
  if (!JOBS_THAT_DO_NOT_EDIT.has(type)) noteUntrackedActivity(`${type} job`, cwd);
}

export function noteTurnToolEvent(tool: string, status: string | undefined, input: string | undefined, args: Record<string, unknown> | undefined, cwd: string): void {
  if (!session.tracking || status === 'error' || status === 'failed' || status === 'rejected') return;
  if (isBashToolName(tool)) {
    const command = typeof args?.command === 'string' ? args.command : input ?? '';
    noteBash(command, cwd);
    return;
  }
  if (!isWriteToolName(tool)) return;
  const turn = currentTurn(cwd);
  if (!turn) return;
  const path = mutatedPathFromToolArgs(tool, args);
  turn.observedWrites.add(path ? resolve(cwd, path) : `(${tool})`);
  turn.lastChangeAt = Date.now();
}

export function withTurnUndo(handler: ToolHandler): ToolHandler {
  const name = handler.definition.name;
  if (name === 'Bash') {
    return {
      ...handler,
      execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        noteBash(String(input.command ?? ''), ctx.cwd);
        return handler.execute(input, ctx);
      },
    };
  }
  if (!FILE_MUTATION_TOOLS.has(name)) return handler;
  return {
    ...handler,
    execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const pending = !(ctx as { virtualFs?: unknown }).virtualFs && typeof input.file_path === 'string'
        ? beginFileMutation(input.file_path, ctx.cwd)
        : null;
      if (!pending) return handler.execute(input, ctx);
      let result: ToolResult | undefined;
      try {
        result = await handler.execute(input, ctx);
        return result.ok && pending.file.pre.kind === 'unavailable'
          ? { ...result, content: `${result.content}\n[/undo cannot revert this file: ${pending.file.pre.reason}]` }
          : result;
      } finally {
        finishFileMutation(pending, result?.ok === true);
      }
    },
  };
}

function restoreBytes(realPath: string, bytes: Buffer, mode: number): void {
  const parent = dirname(realPath);
  const temp = join(parent, `.${basename(realPath)}.agon-undo-${randomUUID().slice(0, 8)}`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeSync(fd, bytes);
      fchmodSync(fd, mode);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (realpathSync(parent) !== parent) throw new Error('parent directory changed during undo');
    renameSync(temp, realPath);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function restoreFile(file: TrackedFile, cwd: string): { outcome: 'restored' | 'removed' | 'unchanged' } | { refused: string } {
  const pre = file.pre;
  if (pre.kind === 'unavailable') return { refused: pre.reason };
  if (resolveRulePath(file.path, cwd) !== file.realPath) return { refused: 'path now resolves somewhere else (symlink changed)' };
  if (!file.post) return { refused: 'no verified state was recorded after the edit' };
  const current = readDiskState(file.realPath);
  if (current.kind === 'other') return { refused: 'no longer a regular file' };
  if (!sameDiskState(file.post, current)) return { refused: current.kind === 'absent' ? 'deleted since the turn' : 'changed since the turn' };
  if (matchesPre(pre, current)) return { outcome: 'unchanged' };
  try {
    if (pre.kind === 'absent') {
      unlinkSync(file.realPath);
      return { outcome: 'removed' };
    }
    const bytes = session.dir ? readFileSync(join(session.dir, pre.hash)) : null;
    if (!bytes || sha256(bytes) !== pre.hash) return { refused: 'snapshot failed verification' };
    restoreBytes(file.realPath, bytes, pre.mode);
    return { outcome: 'restored' };
  } catch (error) {
    return { refused: `restore failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  const shown = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
  return shown.replace(/\p{Cc}/gu, '?');
}

function queueNotice(cwd: string, reverted: string[], refused: string[], untracked: boolean): void {
  if (reverted.length === 0 && refused.length === 0 && !untracked) return;
  const parts = ['[UNDO NOTICE] The user ran /undo.'];
  if (reverted.length > 0) parts.push(`These files were reverted to their state before the undone turn, so your memory of their contents is stale: ${reverted.map((path) => JSON.stringify(displayPath(path, cwd))).join(', ')}. Do not reapply those changes unless the user asks again; re-read a file before editing it.`);
  if (refused.length > 0) parts.push(`These files were left as they are, not reverted: ${refused.map((path) => JSON.stringify(displayPath(path, cwd))).join(', ')}.`);
  if (untracked) parts.push('Shell commands, engine-run tools or delegated jobs from that turn were not reverted.');
  session.notice.push(parts.join(' '));
}

export function consumeUndoNotice(prompt: string): string {
  if (session.notice.length === 0) return prompt;
  const notice = session.notice.join('\n');
  session.notice = [];
  return `${notice}\n\n${prompt}`;
}

export function forgetRevertedFiles(cwd: string, paths: readonly string[]): void {
  const cache = getProjectFileStateCache(cwd);
  for (const path of paths) cache.remove(path);
  session.generation += 1;
  queueNotice(cwd, [...paths], [], false);
}

export const undoGeneration = (): number => session.generation;

function dropEmptyTopTurns(): void {
  while (session.turns.length > 0 && isEmptyTurn(session.turns[session.turns.length - 1])) session.turns.pop();
}

export function latestUndoTurnChangeAt(): number | null {
  dropEmptyTopTurns();
  return session.turns[session.turns.length - 1]?.lastChangeAt ?? null;
}

export function undoLastTurn(cwd: string): TurnUndoReport {
  dropEmptyTopTurns();
  const report: TurnUndoReport = { status: 'empty', cwd, restored: [], removed: [], refused: [], notUndoable: [], bashCommands: [], untrackedWrites: [], otherActivity: [], remainingTurns: 0, droppedTurns: session.droppedTurns };
  const turn = session.turns[session.turns.length - 1];
  if (!turn) return report;
  if (turn.cwd !== resolve(cwd)) return { ...report, status: 'other-workspace', cwd: turn.cwd };
  report.status = 'undone';
  const cache = getProjectFileStateCache(turn.cwd);
  const reverted: string[] = [];
  const leftAsIs: string[] = [];
  const knownPaths = new Set<string>();
  for (const file of turn.files.values()) {
    knownPaths.add(file.realPath);
    for (const alias of file.aliases) knownPaths.add(alias);
    const shown = displayPath(file.path, turn.cwd);
    const result = restoreFile(file, turn.cwd);
    if ('refused' in result) {
      (file.pre.kind === 'unavailable' ? report.notUndoable : report.refused).push({ path: shown, reason: result.refused });
      leftAsIs.push(file.path);
      continue;
    }
    if (result.outcome === 'unchanged') continue;
    (result.outcome === 'removed' ? report.removed : report.restored).push(shown);
    reverted.push(file.path);
    for (const alias of file.aliases) cache.remove(alias);
  }
  report.bashCommands = [...turn.bash];
  report.otherActivity = [...turn.otherActivity];
  report.untrackedWrites = [...turn.observedWrites]
    .filter((path) => !knownPaths.has(path) && !knownPaths.has(resolveRulePath(path, turn.cwd)))
    .map((path) => displayPath(path, turn.cwd));
  session.turns.pop();
  session.boundaryPending = true;
  if (reverted.length > 0) session.generation += 1;
  releaseUnreferencedBlobs();
  dropEmptyTopTurns();
  report.remainingTurns = session.turns.length;
  queueNotice(turn.cwd, reverted, leftAsIs, report.bashCommands.length > 0 || report.untrackedWrites.length > 0 || report.otherActivity.length > 0);
  return report;
}
