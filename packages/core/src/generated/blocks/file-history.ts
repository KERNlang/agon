// @kern-source: file-history:1
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';

// @kern-source: file-history:2
import { join, dirname, relative, resolve } from 'node:path';

// @kern-source: file-history:3
import { randomUUID } from 'node:crypto';

// @kern-source: file-history:4
import { AGON_HOME, ensureAgonHome } from '../signals/config.js';

// @kern-source: file-history:6
export const SNAPSHOTS_DIR: string = join(AGON_HOME, 'snapshots');

// @kern-source: file-history:11
export const MAX_SNAPSHOTS: number = 50;

// @kern-source: file-history:14
export interface FileSnapshot {
  path: string;
  content: string;
  timestamp: number;
}

// @kern-source: file-history:19
export interface HistoryEntry {
  id: string;
  label: string;
  cwd: string;
  files: FileSnapshot[];
  createdAt: string;
}

// @kern-source: file-history:26
function ensureSnapshotsDir(): void {
  ensureAgonHome();
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

// @kern-source: file-history:32
export function takeSnapshot(label: string, cwd: string, filePaths: string[]): HistoryEntry {
  ensureSnapshotsDir();
  
  const files: FileSnapshot[] = [];
  for (const fp of filePaths) {
    const fullPath = resolve(cwd, fp);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        files.push({ path: fp, content, timestamp: Date.now() });
      } catch (err) {
        console.warn(`[agon] snapshot: could not read ${fp}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // File doesn't exist yet — record as empty (for undo = delete)
      files.push({ path: fp, content: '', timestamp: Date.now() });
    }
  }
  
  const entry: HistoryEntry = {
    id: randomUUID().slice(0, 8),
    label,
    cwd,
    files,
    createdAt: new Date().toISOString(),
  };
  
  const entryPath = join(SNAPSHOTS_DIR, `${entry.id}.json`);
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + '\n');
  
  // Prune old snapshots
  pruneSnapshots();
  
  return entry;
}

// @kern-source: file-history:70
export function revertSnapshot(id: string): {ok:boolean, error?:string, filesReverted:number} {
  ensureSnapshotsDir();
  const entryPath = join(SNAPSHOTS_DIR, `${id}.json`);
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
      if (snap.content === '') {
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

// @kern-source: file-history:112
export function listSnapshots(): HistoryEntry[] {
  ensureSnapshotsDir();
  try {
    const files = readdirSync(SNAPSHOTS_DIR).filter((f: string) => f.endsWith('.json')).sort().reverse();
    return files.slice(0, 10).map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(SNAPSHOTS_DIR, f), 'utf-8')) as HistoryEntry;
      } catch {
        return null;
      }
    }).filter(Boolean) as HistoryEntry[];
  } catch {
    return [];
  }
}

// @kern-source: file-history:129
function pruneSnapshots(): void {
  try {
    const files = readdirSync(SNAPSHOTS_DIR).filter((f: string) => f.endsWith('.json')).sort();
    if (files.length > MAX_SNAPSHOTS) {
      const toDelete = files.slice(0, files.length - MAX_SNAPSHOTS);
      for (const f of toDelete) {
        try { unlinkSync(join(SNAPSHOTS_DIR, f)); } catch {}
      }
    }
  } catch {}
}

// @kern-source: file-history:142
export function getLatestSnapshotId(): string|null {
  ensureSnapshotsDir();
  try {
    const files = readdirSync(SNAPSHOTS_DIR).filter((f: string) => f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    return files[0].replace('.json', '');
  } catch {
    return null;
  }
}

