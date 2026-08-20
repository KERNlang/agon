import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { takeSnapshot, revertSnapshot, listSnapshots } from '../../packages/core/src/blocks/file-history.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

// The monotonic snapshot counter must be SEEDED from disk on first use.
// Shipping it pre-seeded restarts the sequence at 1 every process, so a new
// snapshot collides with an existing one's seq and `agon undo` reverts the
// wrong entry.
//
// Every assertion below is expressed RELATIVE to what is already on disk, so
// no test depends on how many snapshots an earlier test took.

let home = '';
let workdir = '';

function writePriorSnapshot(id: string, seq: number, createdAt: string): void {
  const dir = join(home, 'snapshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    id, label: 'prior run', cwd: workdir, files: [], createdAt, seq,
  }, null, 2));
}

/** Highest seq currently persisted in the snapshot store. */
function maxSeqOnDisk(): number {
  return listSnapshots().reduce((max, entry) => Math.max(max, entry.seq ?? 0), 0);
}

beforeAll(() => {
  home = setupTestAgonHome('file-history');
  workdir = mkdtempSync(join(tmpdir(), 'agon-file-history-cwd-'));
  writePriorSnapshot('priorA', 4, '2026-01-01T00:00:00.000Z');
  writePriorSnapshot('priorB', 7, '2026-01-02T00:00:00.000Z');
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
  cleanupTestAgonHome(home);
});

describe('takeSnapshot sequence seeding', () => {
  it('continues the sequence past the highest seq already on disk', () => {
    const before = maxSeqOnDisk();
    expect(before).toBeGreaterThanOrEqual(7); // priorB, or a later snapshot
    const entry = takeSnapshot('after restart', workdir, []);
    expect(entry.seq).toBe(before + 1);
  });

  it('keeps incrementing by exactly one per snapshot', () => {
    const first = takeSnapshot('next', workdir, []).seq!;
    const second = takeSnapshot('next again', workdir, []).seq!;
    expect(second).toBe(first + 1);
  });

  it('never re-uses a seq already present on disk', () => {
    const seen = new Set(listSnapshots().map((s) => s.seq));
    const entry = takeSnapshot('unique', workdir, []);
    expect(seen.has(entry.seq)).toBe(false);
  });

  it('records existing and not-yet-existing files distinctly', () => {
    const present = join(workdir, 'present.txt');
    writeFileSync(present, 'original');
    const entry = takeSnapshot('edit', workdir, ['present.txt', 'absent.txt']);
    expect(entry.files.find((f) => f.path === 'present.txt')).toMatchObject({ content: 'original', existed: true });
    expect(entry.files.find((f) => f.path === 'absent.txt')).toMatchObject({ content: '', existed: false });

    writeFileSync(present, 'modified');
    writeFileSync(join(workdir, 'absent.txt'), 'created after snapshot');
    const result = revertSnapshot(entry.id);
    expect(result.ok).toBe(true);
    expect(readFileSync(present, 'utf-8')).toBe('original');
    expect(existsSync(join(workdir, 'absent.txt'))).toBe(false);
  });

  it('lists snapshots newest-createdAt-first', () => {
    const fresh = takeSnapshot('freshest', workdir, []);
    const entries = listSnapshots();
    expect(entries[0].id).toBe(fresh.id);
    // The two hand-written priors are the oldest entries, in their own order.
    const ids = entries.map((e) => e.id);
    expect(ids.indexOf('priorB')).toBeLessThan(ids.indexOf('priorA'));
    expect(ids.indexOf('priorB')).toBeGreaterThan(ids.indexOf(fresh.id));
    const times = entries.map((e) => Date.parse(e.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
