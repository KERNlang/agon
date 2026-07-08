import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, roomDir, appendEvent, readEvents, withRoomLock } from '../../packages/core/src/generated/rooms/store.js';
import type { RoomActor } from '../../packages/core/src/generated/rooms/types.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-lock-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

const actor = (callsign: string): RoomActor => ({ actorId: `cli:${callsign}`, callsign, kind: 'external-cli', cli: 'cli', humanOwner: 'x' });

describe('withRoomLock — concurrent seq allocation', () => {
  it('keeps seq strictly monotonic with no duplicates under 20 parallel appends', async () => {
    createRoom('r');
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() => appendEvent('r', { kind: 'post', actor: actor(`w${i}`), body: `msg-${i}`, mentions: [], replyTo: null, repoHint: 'x' })),
      ),
    );
    const seqs = readEvents('r', 0, 0).map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toHaveLength(N);
    expect(new Set(seqs).size).toBe(N); // no duplicates
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1)); // dense 1..N
  });

  it('releases the lock file after the critical section', () => {
    createRoom('r');
    appendEvent('r', { kind: 'post', actor: actor('a'), body: 'x', mentions: [], replyTo: null, repoHint: 'x' });
    expect(existsSync(join(roomDir('r'), '.lock'))).toBe(false);
  });
});

describe('withRoomLock — stale lock reclaim', () => {
  it('steals a lock owned by a dead pid (immediate, no timeout wait)', () => {
    createRoom('r');
    const lockPath = join(roomDir('r'), '.lock');
    // A pid that cannot be alive; fresh mtime so ONLY the dead-pid path can reclaim.
    writeFileSync(lockPath, `2147483647\n${Date.now()}\n`);
    const started = Date.now();
    let ran = false;
    withRoomLock('r', () => { ran = true; });
    const elapsed = Date.now() - started;
    expect(ran).toBe(true);
    expect(elapsed).toBeLessThan(1500); // reclaimed via dead-pid, not the 2s timeout
    expect(existsSync(lockPath)).toBe(false); // released in finally
  });

  it('reclaims a lock whose mtime is older than the stale window (live pid, mtime backstop)', () => {
    createRoom('r');
    const lockPath = join(roomDir('r'), '.lock');
    // Our OWN (live) pid so the dead-pid path CANNOT reclaim; force reclaim via
    // the mtime backstop by ageing the file past LOCK_STALE_MS (5s).
    writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`);
    const old = (Date.now() - 30_000) / 1000;
    utimesSync(lockPath, old, old);
    let ran = false;
    withRoomLock('r', () => { ran = true; });
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });
});
