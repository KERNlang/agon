import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { agonPath, getProjectFileStateCache, loadConfig, resolveRulePath } from '@kernlang/agon-core';
import type { ToolContext, ToolHandler, ToolResult } from '@kernlang/agon-core';

import { bashMayMutate } from './bash-read-only.js';
import { isBashToolName, isWriteToolName } from './brain-helpers.js';
import { mutatedPathFromToolArgs } from './mutate-reflex.js';
import { assertStillValidated, restoreBytes } from './turn-undo-restore.js';
import type { Identity } from './turn-undo-restore.js';

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AGE_HOURS = 168;
const BINARY_SNIFF_BYTES = 8192;
const RETAINED_COMMAND_CHARS = 200;
const FILE_MUTATION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
const JOBS_THAT_DO_NOT_EDIT = new Set(['brainstorm', 'team-brainstorm', 'tribunal', 'team-tribunal', 'review', 'council', 'campfire', 'think', 'synthesis', 'speculate', 'research', 'nero', 'mutate', 'chrome']);

type PreState =
  | { kind: 'absent' }
  | { kind: 'file'; hash: string; mode: number; uid: number; gid: number }
  | { kind: 'unavailable'; reason: string; signature: string };

type DiskState = { kind: 'absent' } | { kind: 'file'; hash: string; size: number; mode: number; uid: number; gid: number } | { kind: 'other' };

interface TrackedFile {
  path: string;
  realPath: string;
  aliases: Set<string>;
  pre: PreState;
  post?: DiskState;
  inflight: number;
  failedButChanged: boolean;
}

interface ToolEventRecord { target: Set<string>; key: string }

interface UndoTurn {
  cwd: string;
  lastChangeAt: number;
  files: Map<string, TrackedFile>;
  bash: Set<string>;
  observedWrites: Set<string>;
  otherActivity: Set<string>;
  toolEvents: Map<string, ToolEventRecord>;
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
  failedButChanged: string[];
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
  const dir = ensureSessionDir(cwd);
  const temp = join(dir, `${hash}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temp, join(dir, hash));
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
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
  const turn: UndoTurn = { cwd: resolve(cwd), lastChangeAt: Date.now(), files: new Map(), bash: new Set(), observedWrites: new Set(), otherActivity: new Set(), toolEvents: new Map() };
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
    return { kind: 'file', hash, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
  } catch (error) {
    return unavailable(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readDiskState(realPath: string, expectedSize?: number): DiskState {
  try {
    const stat = lstatSync(realPath);
    if (!stat.isFile()) return { kind: 'other' };
    const hash = expectedSize !== undefined && expectedSize !== stat.size ? '' : sha256(readFileSync(realPath));
    return { kind: 'file', hash, size: stat.size, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
  } catch (error: any) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? { kind: 'absent' } : { kind: 'other' };
  }
}

function matchesPre(pre: PreState, state: DiskState): boolean {
  if (pre.kind === 'absent') return state.kind === 'absent';
  return pre.kind === 'file' && state.kind === 'file' && state.hash === pre.hash && state.mode === pre.mode && state.uid === pre.uid && state.gid === pre.gid;
}

function driftSince(post: DiskState, current: DiskState): string | null {
  if (current.kind === 'absent') return post.kind === 'absent' ? null : 'deleted since the turn';
  if (post.kind !== 'file' || current.kind !== 'file' || post.size !== current.size || post.hash !== current.hash) return 'changed since the turn';
  return post.mode === current.mode && post.uid === current.uid && post.gid === current.gid ? null : 'permissions or owner changed since the turn';
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
    existing.inflight += 1;
    return { turn, file: existing, first: false };
  }
  const file: TrackedFile = { path, realPath, aliases: new Set([path]), pre: capturePreState(path, realPath, turn), inflight: 1, failedButChanged: false };
  turn.files.set(realPath, file);
  return { turn, file, first: true };
}

function forgetFile(turn: UndoTurn, file: TrackedFile): void {
  turn.files.delete(file.realPath);
  turn.observedWrites.delete(file.realPath);
  for (const alias of file.aliases) turn.observedWrites.delete(alias);
  releaseUnreferencedBlobs();
}

function finishFileMutation({ turn, file, first }: PendingMutation, ok: boolean): void {
  file.inflight -= 1;
  if (file.pre.kind === 'unavailable') {
    const unchanged = statSignature(file.realPath) === file.pre.signature;
    if (!ok && !unchanged) file.failedButChanged = true;
    if (first && !ok && unchanged && file.inflight === 0) forgetFile(turn, file);
    return;
  }
  const state = readDiskState(file.realPath);
  if (!ok && (file.post ? driftSince(file.post, state) !== null : !matchesPre(file.pre, state))) file.failedButChanged = true;
  file.post = state;
  if (file.inflight === 0 && matchesPre(file.pre, state)) {
    forgetFile(turn, file);
    return;
  }
  turn.lastChangeAt = Date.now();
}

export function markUserTurnBoundary(): void {
  session.tracking = true;
  session.boundaryPending = true;
}

function recordToolEvent(turn: UndoTurn, id: string | undefined, target: Set<string>, key: string): void {
  target.add(key);
  turn.toolEvents.set(id ?? randomUUID(), { target, key });
  turn.lastChangeAt = Date.now();
}

function retractToolEvent(turn: UndoTurn, id: string): void {
  const event = turn.toolEvents.get(id);
  if (!event) return;
  turn.toolEvents.delete(id);
  const stillClaimed = [...turn.toolEvents.values()].some((other) => other.target === event.target && other.key === event.key);
  if (!stillClaimed) event.target.delete(event.key);
}

function noteBash(command: string, cwd: string, id?: string): void {
  if (!bashMayMutate(command)) return;
  const turn = currentTurn(cwd);
  if (turn) recordToolEvent(turn, id, turn.bash, command.trim().slice(0, RETAINED_COMMAND_CHARS));
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

export function noteTurnToolEvent(tool: string, status: string | undefined, input: string | undefined, args: Record<string, unknown> | undefined, cwd: string, toolCallId?: string): void {
  if (!session.tracking) return;
  const isBash = isBashToolName(tool);
  if (!isBash && !isWriteToolName(tool)) return;
  const turn = currentTurn(cwd);
  if (!turn) return;
  if (status === 'rejected' || (!isBash && (status === 'error' || status === 'failed'))) {
    if (toolCallId) retractToolEvent(turn, toolCallId);
    return;
  }
  if (status === 'error' || status === 'failed' || (toolCallId && turn.toolEvents.has(toolCallId))) return;
  if (isBash) {
    noteBash(typeof args?.command === 'string' ? args.command : input ?? '', cwd, toolCallId);
    return;
  }
  const path = mutatedPathFromToolArgs(tool, args);
  recordToolEvent(turn, toolCallId, turn.observedWrites, path ? resolve(cwd, path) : `(${tool})`);
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

function restoreFile(file: TrackedFile, cwd: string): { outcome: 'restored' | 'removed' | 'unchanged' } | { refused: string } {
  const pre = file.pre;
  if (pre.kind === 'unavailable') return { refused: pre.reason };
  if (resolveRulePath(file.path, cwd) !== file.realPath) return { refused: 'path now resolves somewhere else (symlink changed)' };
  if (!file.post) return { refused: 'no verified state was recorded after the edit' };
  let validated: Identity | null = null;
  try { validated = lstatSync(file.realPath); } catch { /* absent: readDiskState reports it */ }
  const current = readDiskState(file.realPath, file.post.kind === 'file' ? file.post.size : undefined);
  if (current.kind === 'other') return { refused: 'no longer a regular file' };
  const drift = driftSince(file.post, current);
  if (drift) return { refused: drift };
  if (matchesPre(pre, current)) return { outcome: 'unchanged' };
  if (!validated) return { refused: 'changed since the turn' };
  try {
    assertStillValidated(file.realPath, validated);
    if (pre.kind === 'absent') {
      unlinkSync(file.realPath);
      return { outcome: 'removed' };
    }
    const bytes = session.dir ? readFileSync(join(session.dir, pre.hash)) : null;
    if (!bytes || sha256(bytes) !== pre.hash) return { refused: 'snapshot failed verification' };
    restoreBytes(file.realPath, bytes, pre, validated);
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
  const report: TurnUndoReport = { status: 'empty', cwd, restored: [], removed: [], refused: [], notUndoable: [], bashCommands: [], untrackedWrites: [], otherActivity: [], failedButChanged: [], remainingTurns: 0, droppedTurns: session.droppedTurns };
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
    if (file.failedButChanged) report.failedButChanged.push(shown);
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
