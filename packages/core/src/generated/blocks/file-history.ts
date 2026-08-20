import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';

import { join, dirname, relative, resolve } from 'node:path';

import { randomUUID } from 'node:crypto';

import { homedir } from 'node:os';

import { ensureAgonHome } from '../signals/config.js';

function snapshotsDir(): string {
  const override = process.env.AGON_HOME?.trim();
  const home = override ? resolve(override) : join(homedir(), '.agon');
  return join(home, 'snapshots');
}

export const MAX_SNAPSHOTS: number = 50;

export interface FileSnapshot {
  path: string;
  content: string;
  timestamp: number;
  existed?: boolean;
}

export interface HistoryEntry {
  id: string;
  label: string;
  cwd: string;
  files: FileSnapshot[];
  createdAt: string;
  seq?: number;
}

const _snapshotSeq: { value: number, seeded: boolean } = ({ value: 0, seeded: false }) as { value: number, seeded: boolean };

function ensureSnapshotsDir(): void {
  ensureAgonHome();
  mkdirSync(snapshotsDir(), { recursive: true });
}

/**
 * Snapshot files before modification. Returns entry that can be used for undo.
 */
export function takeSnapshot(label: string, cwd: string, filePaths: string[]): HistoryEntry {
  ensureSnapshotsDir();

  const files: FileSnapshot[] = [];
  for (const fp of filePaths) {
    const fullPath = resolve(cwd, fp);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        files.push({ path: fp, content, timestamp: Date.now(), existed: true });
      } catch (err) {
        console.warn(`[agon] snapshot: could not read ${fp}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // File doesn't exist yet — record as empty (for undo = delete)
      files.push({ path: fp, content: '', timestamp: Date.now(), existed: false });
    }
  }

  // Seed the monotonic counter from disk on first use so a restart stays
  // strictly increasing and never collides with an existing snapshot's seq.
  if (!_snapshotSeq.seeded) {
    let maxSeq = 0;
    try {
      for (const f of readdirSync(snapshotsDir()).filter((n: string) => n.endsWith('.json'))) {
        try {
          const prior = JSON.parse(readFileSync(join(snapshotsDir(), f), 'utf-8')) as HistoryEntry;
          if (typeof prior.seq === 'number' && prior.seq > maxSeq) maxSeq = prior.seq;
        } catch { /* skip corrupt */ }
      }
    } catch { /* no dir yet */ }
    _snapshotSeq.value = maxSeq;
    _snapshotSeq.seeded = true;
  }
  _snapshotSeq.value += 1;

  const entry: HistoryEntry = {
    id: randomUUID().slice(0, 8),
    label,
    cwd,
    files,
    createdAt: new Date().toISOString(),
    seq: _snapshotSeq.value,
  };

  const entryPath = join(snapshotsDir(), `${entry.id}.json`);
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + '\n');

  // Prune old snapshots
  pruneSnapshots();

  return entry;
}

/**
 * Revert files to a snapshot state. Deletes files that didn't exist before.
 */
export function revertSnapshot(id: string): {ok:boolean, error?:string, filesReverted:number} {
  ensureSnapshotsDir();
  const entryPath = join(snapshotsDir(), `${id}.json`);
  if (!existsSync(entryPath)) {
    return { ok: false, error: `Snapshot ${id} not found`, filesReverted: 0 };
  }

  let entry: HistoryEntry;
  try {
    entry = JSON.parse(readFileSync(entryPath, 'utf-8')) as HistoryEntry;
  } catch (err) {
    return { ok: false, error: `Corrupt snapshot: ${err instanceof Error ? err.message : String(err)}`, filesReverted: 0 };
  }

  let reverted = 0;
  for (const snap of entry.files) {
    const fullPath = resolve(entry.cwd, snap.path);
    try {
      const existedBefore = typeof snap.existed === 'boolean' ? snap.existed : snap.content !== '';
      if (!existedBefore) {
        // File didn't exist — delete if it was created
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
          reverted++;
        }
      } else {
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, snap.content);
        reverted++;
      }
    } catch (err) {
      console.warn(`[agon] revert: failed on ${snap.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove the used snapshot
  try { unlinkSync(entryPath); } catch (e) { console.warn(`[agon] file-history: failed to remove snapshot ${entryPath}: ${e instanceof Error ? e.message : String(e)}`); }

  return { ok: true, filesReverted: reverted };
}

export function listSnapshots(): HistoryEntry[] {
  ensureSnapshotsDir();
  try {
    const files = readdirSync(snapshotsDir()).filter((f: string) => f.endsWith('.json'));
    const entries = files.map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(snapshotsDir(), f), 'utf-8')) as HistoryEntry;
      } catch {
        return null;
      }
    }).filter(Boolean) as HistoryEntry[];
    entries.sort((a, b) => {
      const aTime = Date.parse(a.createdAt ?? '') || 0;
      const bTime = Date.parse(b.createdAt ?? '') || 0;
      if (bTime !== aTime) return bTime - aTime;
      // Same-millisecond tie (multiple edits in one turn): newest seq first.
      return (b.seq ?? 0) - (a.seq ?? 0);
    });
    return entries.slice(0, 10);
  } catch {
    return [];
  }
}

function pruneSnapshots(): void {
  try {
    const files = readdirSync(snapshotsDir()).filter((f: string) => f.endsWith('.json'));
    if (files.length > MAX_SNAPSHOTS) {
      const byAge = files.map((f: string) => {
        try {
          const entry = JSON.parse(readFileSync(join(snapshotsDir(), f), 'utf-8')) as HistoryEntry;
          return { file: f, ts: Date.parse(entry.createdAt ?? '') || 0 };
        } catch {
          return { file: f, ts: 0 };
        }
      }).sort((a, b) => a.ts - b.ts);
      const toDelete = byAge.slice(0, files.length - MAX_SNAPSHOTS);
      for (const item of toDelete) {
        try { unlinkSync(join(snapshotsDir(), item.file)); } catch { /* snapshot already deleted or inaccessible */ }
      }
    }
  } catch (err) { console.warn('[file-history] failed to save snapshot:', (err as Error).message ?? err); }
}

export function getLatestSnapshotId(): string|null {
  ensureSnapshotsDir();
  try {
    const latest = listSnapshots()[0];
    return latest?.id ?? null;
  } catch (e) {
    return null;
  }
}
