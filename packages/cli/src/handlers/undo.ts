import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { appendMessage, listSnapshots, resolveWorkingDir, revertSnapshot } from '@kernlang/agon-core';
import { persistencePath } from '@kernlang/agon-support-persistence';
import { undoPatch } from '@kernlang/agon-support-worktree';

import { displayPath, forgetRevertedFiles, latestUndoTurnChangeAt, undoLastTurn } from '../cesar/turn-undo.js';
import type { TurnUndoReport } from '../cesar/turn-undo.js';
import { isExplicitApproval } from '../lib/explicit-approval.js';
import type { DispatchCallbacks } from '../signals/dispatch.js';

const COMMAND_PREVIEW_CHARS = 60;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

function commandPreview(command: string): string {
  const flat = command.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '?');
  return flat.length > COMMAND_PREVIEW_CHARS ? `${flat.slice(0, COMMAND_PREVIEW_CHARS)}…` : flat;
}

export function formatTurnUndoReport(report: TurnUndoReport): { type: 'success' | 'warning' | 'info'; message: string }[] {
  const lines: { type: 'success' | 'warning' | 'info'; message: string }[] = [];
  const reverted = report.restored.length + report.removed.length;
  const skipped = report.refused.length + report.notUndoable.length;
  const gaps = report.bashCommands.length + report.untrackedWrites.length + report.otherActivity.length;
  const headline = `Undo of last turn: restored ${plural(report.restored.length, 'file')}, removed ${report.removed.length} created, ${skipped} left as is.`;
  lines.push({ type: reverted > 0 && skipped === 0 && gaps === 0 ? 'success' : 'warning', message: headline });
  for (const path of report.restored) lines.push({ type: 'info', message: `  restored ${path}` });
  for (const path of report.removed) lines.push({ type: 'info', message: `  removed ${path} (the turn created it)` });
  for (const { path, reason } of report.refused) lines.push({ type: 'warning', message: `  refused ${path}: ${reason}. Left untouched.` });
  for (const { path, reason } of report.notUndoable) lines.push({ type: 'warning', message: `  cannot undo ${path}: ${reason}.` });
  if (report.bashCommands.length > 0) {
    lines.push({ type: 'warning', message: `  NOT reverted: ${plural(report.bashCommands.length, 'shell command')} that may have changed files. Check them yourself: ${report.bashCommands.slice(0, 3).map(commandPreview).join(' | ')}${report.bashCommands.length > 3 ? ' | …' : ''}` });
  }
  if (report.untrackedWrites.length > 0) lines.push({ type: 'warning', message: `  NOT reverted: edits the engine ran with its own tools: ${report.untrackedWrites.join(', ')}` });
  if (report.otherActivity.length > 0) lines.push({ type: 'warning', message: `  NOT reverted: ${report.otherActivity.join(', ')} may have changed files.` });
  if (report.failedButChanged.length > 0) lines.push({ type: 'warning', message: `  An edit reported failure but still changed: ${report.failedButChanged.join(', ')}` });
  if (report.remainingTurns > 0) lines.push({ type: 'info', message: `  ${plural(report.remainingTurns, 'earlier turn')} can still be undone.` });
  return lines;
}

function recordInChat(cb: DispatchCallbacks, report: TurnUndoReport): void {
  if (!cb.ctx.chatSession) return;
  const timestamp = new Date().toISOString();
  const reverted = [...report.restored, ...report.removed].join(', ') || 'no files';
  const left = [...report.refused, ...report.notUndoable].map(({ path }) => path).join(', ');
  appendMessage(cb.ctx.chatSession, { role: 'user', content: '/undo', timestamp });
  appendMessage(cb.ctx.chatSession, { role: 'engine', engineId: 'undo', content: `Reverted ${reverted}.${left ? ` Left as is: ${left}.` : ''}`, timestamp });
}

function undoTurnOrReportEmpty(cwd: string, cb: DispatchCallbacks): void {
  const report = undoLastTurn(cwd);
  if (report.status === 'other-workspace') {
    cb.dispatch({ type: 'warning', message: `The last undoable turn belongs to ${report.cwd}. Switch back to that workspace to undo it.` });
    return;
  }
  if (report.status === 'empty') {
    const dropped = report.droppedTurns > 0 ? ` ${plural(report.droppedTurns, 'older turn')} fell out of the undoMaxTurns or undoMaxTotalBytes limits.` : '';
    cb.dispatch({ type: 'warning', message: `Nothing to undo: the undo stack is empty for this session. The stack does not survive a restart.${dropped}` });
    return;
  }
  for (const line of formatTurnUndoReport(report)) cb.dispatch(line);
  recordInChat(cb, report);
}

async function undoNamedCheckpoint(snapshotId: string, cwd: string, cb: DispatchCallbacks): Promise<void> {
  const snapshot = listSnapshots().find((entry: any) => String(entry?.id ?? '') === snapshotId);
  if (!snapshot) {
    cb.dispatch({ type: 'warning', message: `Checkpoint ${snapshotId} not found.` });
    return;
  }
  if (String(snapshot.cwd ?? '') !== cwd) {
    cb.dispatch({ type: 'warning', message: `Checkpoint ${snapshotId} belongs to a different workspace.` });
    return;
  }
  const paths = snapshot.files.map((file) => resolve(snapshot.cwd, file.path));
  const answer = await cb.askQuestion(`Checkpoint ${snapshot.id} overwrites ${paths.map((path) => displayPath(path, cwd)).join(', ')} without checking for later edits. Proceed? (y/n)`);
  if (!isExplicitApproval(answer)) {
    cb.dispatch({ type: 'info', message: `Checkpoint ${snapshot.id} not reverted.` });
    return;
  }
  const result = revertSnapshot(snapshot.id);
  if (!result.ok) {
    cb.dispatch({ type: 'error', message: result.error ?? 'Checkpoint undo failed' });
    return;
  }
  forgetRevertedFiles(cwd, paths);
  cb.dispatch({ type: 'success', message: `Checkpoint ${snapshot.id} reverted (${plural(result.filesReverted, 'file')}).` });
}

function patchModifiedAt(token: string): number | null {
  try {
    return statSync(persistencePath('undo', `${token}.patch`)).mtimeMs;
  } catch {
    return null;
  }
}

function undoPatchToken(token: string, cwd: string, cb: DispatchCallbacks): void {
  const undone = undoPatch(cwd, token, persistencePath('undo'));
  if (!undone.ok) {
    cb.dispatch({ type: 'error', message: undone.error ?? 'Undo failed' });
    return;
  }
  cb.setLastUndoToken(null);
  cb.dispatch({ type: 'success', message: 'Patch reverted successfully.' });
  if (undone.warning) cb.dispatch({ type: 'warning', message: undone.warning });
}

export async function handleUndo(snapshotId: string, cb: DispatchCallbacks): Promise<void> {
  const cwd = resolveWorkingDir();
  if (cb.jobManager?.running?.().length > 0) {
    cb.dispatch({ type: 'warning', message: 'A job is still running and may be writing files. Wait for it to finish, then /undo.' });
    return;
  }
  if (snapshotId) {
    await undoNamedCheckpoint(snapshotId, cwd, cb);
    return;
  }
  const token = cb.lastUndoToken;
  if (token) {
    const patchAt = patchModifiedAt(token);
    if (patchAt === null) {
      cb.setLastUndoToken(null);
    } else {
      const turnAt = latestUndoTurnChangeAt();
      if (turnAt === null || patchAt >= turnAt) {
        undoPatchToken(token, cwd, cb);
        return;
      }
    }
  }
  undoTurnOrReportEmpty(cwd, cb);
}
