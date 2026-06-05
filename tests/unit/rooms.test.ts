import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  createRoom,
  appendEvent,
  readEvents,
  parseMentions,
  slugifyRoomId,
  roomExists,
  eventsPath,
  closeRoom,
  isRoomClosed,
} from '../../packages/core/src/generated/rooms/store.js';
import { recordPresence, removePresence, listPresence } from '../../packages/core/src/generated/rooms/presence.js';
import type { RoomActor } from '../../packages/core/src/generated/rooms/types.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-rooms-'));
  process.env.AGON_HOME = home;
});

afterEach(() => {
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

const actor = (callsign: string): RoomActor => ({
  actorId: `cli:${callsign}`,
  callsign,
  kind: 'external-cli',
  cli: 'cli',
  humanOwner: 'test',
});

const post = (roomId: string, who: string, body: string) =>
  appendEvent(roomId, { kind: 'post', actor: actor(who), body, mentions: parseMentions(body), replyTo: null, repoHint: 'x' });

describe('rooms store', () => {
  it('createRoom slugifies the name and is idempotent', () => {
    const a = createRoom('Design Room');
    expect(a.roomId).toBe('design-room');
    expect(roomExists('design-room')).toBe(true);
    const b = createRoom('Design Room');
    expect(b.createdAt).toBe(a.createdAt); // same room reused, not recreated
  });

  it('appendEvent allocates a monotonic seq and preserves order', () => {
    createRoom('r');
    const e1 = post('r', 'alice', 'one');
    const e2 = post('r', 'bob', 'two');
    const e3 = post('r', 'alice', 'three');
    expect([e1.seq, e2.seq, e3.seq]).toEqual([1, 2, 3]);
    expect(readEvents('r', 0, 0).map((e) => e.body)).toEqual(['one', 'two', 'three']);
  });

  it('readEvents filters by sinceSeq and applies a tail limit', () => {
    createRoom('r');
    for (let i = 1; i <= 5; i++) post('r', 'a', `m${i}`);
    expect(readEvents('r', 3, 0).map((e) => e.body)).toEqual(['m4', 'm5']);
    expect(readEvents('r', 0, 2).map((e) => e.body)).toEqual(['m4', 'm5']); // last 2
  });

  it('readEvents tolerates a partially-written final line', () => {
    createRoom('r');
    post('r', 'a', 'ok');
    appendFileSync(eventsPath('r'), '{"seq":2,"body":"truncated'); // crash mid-write
    const events = readEvents('r', 0, 0);
    expect(events).toHaveLength(1);
    expect(events[0].body).toBe('ok');
  });

  it('parseMentions extracts deduped lowercase @callsigns, ignoring emails', () => {
    expect(parseMentions('hey @Codex and @claude, also @codex again')).toEqual(['codex', 'claude']);
    expect(parseMentions('nothing to see')).toEqual([]);
    expect(parseMentions('mail me at a@b.com please')).toEqual([]);
  });

  it('slugifyRoomId is filesystem-safe', () => {
    expect(slugifyRoomId('  My Cool Room!! ')).toBe('my-cool-room');
    expect(slugifyRoomId('')).toBe('room');
  });

  it('isRoomClosed reflects closeRoom so close can be enforced', () => {
    createRoom('r');
    expect(isRoomClosed('r')).toBe(false);
    closeRoom('r');
    expect(isRoomClosed('r')).toBe(true);
    expect(isRoomClosed('nonexistent')).toBe(false);
  });
});

describe('rooms presence', () => {
  it('recordPresence + listPresence reports a fresh actor as here', () => {
    createRoom('r');
    recordPresence('r', actor('claude'), 0, false);
    recordPresence('r', actor('codex'), 0, false);
    const who = listPresence('r');
    expect(who.map((p) => p.callsign)).toEqual(['claude', 'codex']); // sorted
    expect(who.every((p) => p.status === 'here')).toBe(true);
  });

  it('removePresence clears an actor immediately (explicit leave)', () => {
    createRoom('r');
    recordPresence('r', actor('claude'), 0, false);
    recordPresence('r', actor('codex'), 0, false);
    removePresence('r', 'claude');
    expect(listPresence('r').map((p) => p.callsign)).toEqual(['codex']);
    removePresence('r', 'ghost'); // no-op, must not throw
    expect(listPresence('r')).toHaveLength(1);
  });
});
