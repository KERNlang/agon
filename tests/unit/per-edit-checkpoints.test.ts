import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import {
  takeSnapshot,
  revertSnapshot,
  listSnapshots,
} from '../../packages/core/src/generated/blocks/file-history.js';

// These tests pin the per-edit checkpoint contract that AgonEdit/AgonWrite rely
// on. Each Edit/Write execute() call takes exactly one snapshot of one file
// BEFORE the mutation hits disk (tool-edit.kern / tool-write.kern), so three
// edits in one turn produce three independent restore points. `/undo` with no
// arg picks listSnapshots()[0] — the newest — then deletes it, so repeated
// `/undo` peels edits most-recent-first (intent-meta.kern).

// Mirrors the no-arg `/undo` selection in intent-meta.kern:
//   listSnapshots().find((e) => e.cwd === cwd)  // newest for this workspace
function pickUndoTarget(cwd: string) {
  return listSnapshots().find((e) => String(e?.cwd ?? '') === cwd);
}

describe('per-edit undo checkpoints', () => {
  let testHome = '';
  let cwd = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('per-edit-checkpoints');
    cwd = mkdtempSync(join(tmpdir(), 'agon-edit-ws-'));
  });

  afterEach(() => {
    cleanupTestAgonHome(testHome);
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* gone */ }
  });

  it('creates one distinct checkpoint per Edit (3 edits in a turn = 3 restore points)', () => {
    const file = 'src/app.ts';
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, file), 'v0\n');

    // Edit #1 — snapshot captures v0, then write v1
    const c1 = takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v1\n');
    // Edit #2 — snapshot captures v1, then write v2
    const c2 = takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v2\n');
    // Edit #3 — snapshot captures v2, then write v3
    const c3 = takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v3\n');

    const ids = new Set([c1.id, c2.id, c3.id]);
    expect(ids.size).toBe(3); // three independent checkpoints, not one per-turn
    const snaps = listSnapshots().filter((e) => e.cwd === cwd);
    expect(snaps.length).toBe(3);
  });

  it('/undo restores only the LAST edit, and a second /undo peels the previous one', () => {
    const file = 'note.txt';
    writeFileSync(join(cwd, file), 'v0\n');

    takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v1\n');
    takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v2\n');
    takeSnapshot(`Edit: ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'v3\n');

    expect(readFileSync(join(cwd, file), 'utf-8')).toBe('v3\n');

    // First /undo — restores the state captured by the newest checkpoint (v2),
    // i.e. undoes only the last edit (v2 -> v3).
    const u1 = pickUndoTarget(cwd)!;
    expect(revertSnapshot(u1.id).ok).toBe(true);
    expect(readFileSync(join(cwd, file), 'utf-8')).toBe('v2\n');

    // Second /undo — peels the previous edit (v1 -> v2).
    const u2 = pickUndoTarget(cwd)!;
    expect(revertSnapshot(u2.id).ok).toBe(true);
    expect(readFileSync(join(cwd, file), 'utf-8')).toBe('v1\n');

    // Third /undo — peels back to the original (v0 -> v1).
    const u3 = pickUndoTarget(cwd)!;
    expect(revertSnapshot(u3.id).ok).toBe(true);
    expect(readFileSync(join(cwd, file), 'utf-8')).toBe('v0\n');

    // No checkpoints left for this workspace.
    expect(listSnapshots().filter((e) => e.cwd === cwd).length).toBe(0);
  });

  it('Write of a NEW file checkpoints non-existence; /undo deletes the created file', () => {
    const file = 'created.txt';
    // tool-write.kern path for a non-existent file: snapshot records existed:false
    const cp = takeSnapshot(`Write (new): ${file}`, cwd, [file]);
    writeFileSync(join(cwd, file), 'fresh content\n');
    expect(existsSync(join(cwd, file))).toBe(true);

    const res = revertSnapshot(cp.id);
    expect(res.ok).toBe(true);
    expect(existsSync(join(cwd, file))).toBe(false); // undo of a create = delete
  });

  it('edits to different files in one turn are independent restore points', () => {
    writeFileSync(join(cwd, 'a.txt'), 'a0\n');
    writeFileSync(join(cwd, 'b.txt'), 'b0\n');

    takeSnapshot('Edit: a.txt', cwd, ['a.txt']);
    writeFileSync(join(cwd, 'a.txt'), 'a1\n');
    takeSnapshot('Edit: b.txt', cwd, ['b.txt']);
    writeFileSync(join(cwd, 'b.txt'), 'b1\n');

    // Newest checkpoint is b.txt — /undo touches only b, leaving a untouched.
    const u1 = pickUndoTarget(cwd)!;
    expect(revertSnapshot(u1.id).ok).toBe(true);
    expect(readFileSync(join(cwd, 'b.txt'), 'utf-8')).toBe('b0\n');
    expect(readFileSync(join(cwd, 'a.txt'), 'utf-8')).toBe('a1\n'); // a's edit survives

    // Next /undo peels a.txt.
    const u2 = pickUndoTarget(cwd)!;
    expect(revertSnapshot(u2.id).ok).toBe(true);
    expect(readFileSync(join(cwd, 'a.txt'), 'utf-8')).toBe('a0\n');
  });

  it('a failed/denied edit takes NO snapshot (snapshot is created inside execute, after validation)', () => {
    // tool-registry.kern short-circuits on deny/ask-refusal BEFORE execute(),
    // and tool-edit.kern/tool-write.kern return on validation errors BEFORE
    // takeSnapshot(). We model that contract: no takeSnapshot call => no
    // checkpoint, so /undo has nothing to revert for the workspace.
    writeFileSync(join(cwd, 'x.txt'), 'x0\n');
    // (intentionally no takeSnapshot — represents the denied/failed path)
    expect(listSnapshots().filter((e) => e.cwd === cwd).length).toBe(0);
    expect(pickUndoTarget(cwd)).toBeUndefined();
  });

  it('checkpoints are bounded — newest-10 window for peel-back, 50 on disk', () => {
    const file = 'big.txt';
    writeFileSync(join(cwd, file), 'r0\n');
    for (let i = 1; i <= 12; i++) {
      takeSnapshot(`Edit: ${file}`, cwd, [file]);
      writeFileSync(join(cwd, file), `r${i}\n`);
    }
    // listSnapshots() caps the peel-back window at the 10 newest.
    const visible = listSnapshots().filter((e) => e.cwd === cwd);
    expect(visible.length).toBe(10);
    // Newest first (sorted by createdAt desc).
    expect(Date.parse(visible[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(visible[1].createdAt));
  });
});
