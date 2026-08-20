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
// The seeding happens once per module instance, so the seeding test must be
// the FIRST takeSnapshot call in this file.

let home = '';
let workdir = '';

function writePriorSnapshot(id: string, seq: number): void {
  const dir = join(home, 'snapshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    id, label: 'prior run', cwd: workdir, files: [], createdAt: new Date().toISOString(), seq,
  }, null, 2));
}

beforeAll(() => {
  home = setupTestAgonHome('file-history');
  workdir = mkdtempSync(join(tmpdir(), 'agon-file-history-cwd-'));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
  cleanupTestAgonHome(home);
});

describe('takeSnapshot sequence seeding', () => {
  it('seeds the counter past the highest seq already on disk', () => {
    writePriorSnapshot('priorA', 4);
    writePriorSnapshot('priorB', 7);

    const entry = takeSnapshot('after restart', workdir, []);
    expect(entry.seq).toBe(8);
  });

  it('keeps incrementing from the seeded value', () => {
    expect(takeSnapshot('next', workdir, []).seq).toBe(9);
    expect(takeSnapshot('next again', workdir, []).seq).toBe(10);
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

  it('lists snapshots newest-first including the pre-existing ones', () => {
    const ids = listSnapshots().map((s) => s.id);
    expect(ids).toContain('priorA');
    expect(ids).toContain('priorB');
  });
});
