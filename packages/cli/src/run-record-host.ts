import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep, join } from 'node:path';
import { createRunDir, writeRunStatus, writeRunOwner } from '@kernlang/agon-support-persistence';
import type { RunRecordHandle, RunRecordHostServices } from '@kernlang/agon-mod-api';

const pending = new Map<string, { handle: RunRecordHandle; label?: string }>();

function finalizeInterruptedRuns(): void {
  for (const { handle, label } of pending.values()) {
    // Do not replace an outcome already persisted by the workflow.
    if (existsSync(join(handle.path, 'status.json'))) continue;
    writeRunStatus(handle.path, {
      mode: handle.mode, ...(label ? { label } : {}), startedAt: handle.startedAt,
      endedAt: new Date().toISOString(), engines: [], ok: false,
      summary: 'Interrupted: host exited before finalization. Partial artifacts are retained; inspect them before retrying. This run was not automatically resumed.',
    });
  }
  pending.clear();
  process.removeListener('exit', finalizeInterruptedRuns);
}

/** CLI-owned compatibility host: only runs started here are finalized on exit.
 * No startup scan or inference about other processes' run directories.
 */
export const cliRunRecordHost = Object.freeze<RunRecordHostServices>({
  start(mode, label) {
    const startedAt = new Date().toISOString();
    const created = createRunDir({ mode, label, announce: false });
    writeRunOwner(created.path);
    const handle = Object.freeze({ id: created.id, path: created.path, mode, startedAt });
    if (pending.size === 0) process.on('exit', finalizeInterruptedRuns);
    pending.set(handle.path, { handle, label });
    return handle;
  },
  finish(handle, status) {
    writeRunStatus(handle.path, status as never);
    pending.delete(handle.path);
    if (pending.size === 0) process.removeListener('exit', finalizeInterruptedRuns);
  },
  writeArtifact(handle, relativePath, content) {
    const root = resolve(handle.path);
    const target = resolve(root, relativePath);
    if (target === root || !target.startsWith(root + sep)) throw new Error(`Run artifact escapes its run directory: ${relativePath}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  },
});
