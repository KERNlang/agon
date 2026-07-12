import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, roomDir, appendEvent, eventsPath } from '../../packages/core/src/generated/rooms/store.js';
import { drainNdjson, drainRoom, readTailOffset, writeTailOffset, createRoomWaker } from '../../packages/core/src/generated/rooms/tail.js';
import type { RoomActor, TailCursor } from '../../packages/core/src/generated/rooms/types.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-tail-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

const actor = (callsign: string): RoomActor => ({ actorId: `cli:${callsign}`, callsign, kind: 'external-cli', cli: 'cli', humanOwner: 'x' });
const line = (seq: number, body: string) => JSON.stringify({ seq, id: `e${seq}`, roomId: 'r', kind: 'post', createdAt: new Date().toISOString(), actor: actor('a'), repoHint: 'x', body, mentions: [], replyTo: null }) + '\n';

describe('drainNdjson — incremental reader', () => {
  it('reads only the bytes appended since the offset', () => {
    const p = join(home, 'events.ndjson');
    writeFileSync(p, line(1, 'first'));
    const d1 = drainNdjson(p, { offset: 0, partial: '' });
    expect(d1.events.map((e) => e.seq)).toEqual([1]);
    expect(d1.cursor.offset).toBeGreaterThan(0);
    // no new bytes → noop, offset unchanged
    const d2 = drainNdjson(p, d1.cursor);
    expect(d2.events).toEqual([]);
    expect(d2.cursor.offset).toBe(d1.cursor.offset);
    // append two more → only those are returned
    appendFileSync(p, line(2, 'second') + line(3, 'third'));
    const d3 = drainNdjson(p, d2.cursor);
    expect(d3.events.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('advances the cursor by the bytes actually consumed, not blindly to the stat size', () => {
    // Regression pin for the short-read skip: the returned offset must be
    // provably initialOffset + bytesConsumed. On the normal (full-read) path
    // that equals the byte length of what was written — assert the exact math
    // so an `offset: size` regression fails immediately.
    const p = join(home, 'events.ndjson');
    const l1 = line(1, 'first');
    writeFileSync(p, l1);
    const d1 = drainNdjson(p, { offset: 0, partial: '' });
    expect(d1.cursor.offset).toBe(Buffer.byteLength(l1)); // 0 + consumed
    const l2 = line(2, 'second — with wide chars: äöü');
    appendFileSync(p, l2);
    const d2 = drainNdjson(p, d1.cursor);
    expect(d2.cursor.offset).toBe(Buffer.byteLength(l1) + Buffer.byteLength(l2)); // prior offset + consumed
  });

  it('buffers a torn final line, then completes it on the next drain', () => {
    const p = join(home, 'events.ndjson');
    const full = line(1, 'whole');
    const torn = JSON.stringify({ seq: 2, id: 'e2', roomId: 'r', kind: 'post', createdAt: new Date().toISOString(), actor: actor('a'), repoHint: 'x', body: 'partial', mentions: [], replyTo: null }) + '\n';
    const cut = full.length + Math.floor(torn.length / 2);
    const combined = full + torn;
    // write only the first `cut` bytes (a torn second line, no trailing newline)
    writeFileSync(p, combined.slice(0, cut));
    const d1 = drainNdjson(p, { offset: 0, partial: '' });
    expect(d1.events.map((e) => e.seq)).toEqual([1]); // torn line is NOT parsed
    expect(d1.cursor.partial.length).toBeGreaterThan(0);
    // append the rest → torn line completes and parses
    appendFileSync(p, combined.slice(cut));
    const d2 = drainNdjson(p, d1.cursor);
    expect(d2.events.map((e) => e.seq)).toEqual([2]);
    expect(d2.cursor.partial).toBe('');
  });

  it('resets on truncation (file smaller than offset)', () => {
    const p = join(home, 'events.ndjson');
    writeFileSync(p, line(1, 'a') + line(2, 'b'));
    const d1 = drainNdjson(p, { offset: 0, partial: '' });
    expect(d1.events).toHaveLength(2);
    expect(d1.reset).toBe(false);
    // rotate: replace with a smaller file
    writeFileSync(p, line(9, 'fresh'));
    const d2 = drainNdjson(p, d1.cursor);
    expect(d2.reset).toBe(true);
    expect(d2.events.map((e) => e.seq)).toEqual([9]);
  });

  it('returns empty for a missing file without throwing', () => {
    const d = drainNdjson(join(home, 'nope.ndjson'), { offset: 0, partial: '' });
    expect(d.events).toEqual([]);
    expect(d.cursor.offset).toBe(0);
  });
});

describe('tail offset persistence', () => {
  it('round-trips the byte offset per callsign', () => {
    createRoom('r');
    expect(readTailOffset('r', 'codex')).toEqual({ offset: 0, partial: '' });
    writeTailOffset('r', 'codex', 4096);
    expect(readTailOffset('r', 'codex')).toEqual({ offset: 4096, partial: '' });
    // separate consumers keep independent offsets
    writeTailOffset('r', 'claude', 12);
    expect(readTailOffset('r', 'codex').offset).toBe(4096);
    expect(readTailOffset('r', 'claude').offset).toBe(12);
  });
});

describe('drainRoom over a live room ledger', () => {
  it('picks up appended events from the persisted event path', () => {
    createRoom('r');
    appendEvent('r', { kind: 'post', actor: actor('a'), body: 'one', mentions: [], replyTo: null, repoHint: 'x' });
    let cursor: TailCursor = { offset: 0, partial: '' };
    const d1 = drainRoom('r', cursor); cursor = d1.cursor;
    expect(d1.events.map((e) => e.body)).toContain('one');
    appendEvent('r', { kind: 'post', actor: actor('a'), body: 'two', mentions: [], replyTo: null, repoHint: 'x' });
    const d2 = drainRoom('r', cursor);
    expect(d2.events.map((e) => e.body)).toEqual(['two']);
  });
});

describe('createRoomWaker — fs.watch push wakeups', () => {
  it('wakes on an append well under the watchdog interval', async () => {
    createRoom('r');
    // Watchdog deliberately long so a watchdog-driven wake would be obvious.
    const waker = createRoomWaker('r', 5000, () => {});
    try {
      const started = Date.now();
      const waitP = waker.wait();
      // append AFTER the wait has begun
      setTimeout(() => { appendEvent('r', { kind: 'post', actor: actor('a'), body: 'ping', mentions: [], replyTo: null, repoHint: 'x' }); }, 20);
      const reason = await waitP;
      const elapsed = Date.now() - started;
      expect(reason).toBe('event');
      expect(elapsed).toBeLessThan(2000); // fs.watch, not the 5s watchdog
    } finally {
      waker.close();
    }
  });

  it('coalesces a wake that arrives between waits (no missed change)', async () => {
    createRoom('r');
    const waker = createRoomWaker('r', 5000, () => {});
    try {
      // Prove the OS watcher is armed before testing the between-waits buffer.
      // On macOS an append issued immediately after fs.watch() returns can race
      // the native watcher startup and be lost before our callback exists.
      const primed = waker.wait();
      setTimeout(() => { appendEvent('r', { kind: 'post', actor: actor('a'), body: 'prime', mentions: [], replyTo: null, repoHint: 'x' }); }, 20);
      expect(await primed).toBe('event');

      // change happens while nobody is waiting → buffered as `signalled`
      appendEvent('r', { kind: 'post', actor: actor('a'), body: 'buffered', mentions: [], replyTo: null, repoHint: 'x' });
      await new Promise((r) => setTimeout(r, 50));
      const reason = await waker.wait(); // should return immediately with 'event'
      expect(reason).toBe('event');
    } finally {
      waker.close();
    }
  });

  it('resolves close() waiters with "close"', async () => {
    createRoom('r');
    const waker = createRoomWaker('r', 60000, () => {});
    const waitP = waker.wait();
    waker.close();
    expect(await waitP).toBe('close');
  });
});
