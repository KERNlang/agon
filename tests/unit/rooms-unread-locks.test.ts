import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, appendEvent, readEvents, parseMentions } from '../../packages/core/src/generated/rooms/store.js';
import { recordPresence, advanceReadCursor, getReadCursor } from '../../packages/core/src/generated/rooms/presence.js';
import { getUnreadState, listUnreadStates, isUnreadKind } from '../../packages/core/src/generated/rooms/unread.js';
import { foldLocks, listRoomLocks, claimRoomLock, releaseRoomLock, expiredLocksHeldBy } from '../../packages/core/src/generated/rooms/locks.js';
import type { RoomActor } from '../../packages/core/src/generated/rooms/types.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-unread-locks-'));
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

describe('read cursor', () => {
  it('defaults to 0 for an unknown member (everything unread)', () => {
    const { roomId } = createRoom('cur');
    expect(getReadCursor(roomId, 'ghost')).toBe(0);
  });

  it('advanceReadCursor is clamp-max — never rewinds', () => {
    const { roomId } = createRoom('cur');
    advanceReadCursor(roomId, actor('a'), 5);
    advanceReadCursor(roomId, actor('a'), 3);
    expect(getReadCursor(roomId, 'a')).toBe(5);
    advanceReadCursor(roomId, actor('a'), 9);
    expect(getReadCursor(roomId, 'a')).toBe(9);
  });

  it('a re-join (recordPresence with 0) does not rewind the cursor', () => {
    const { roomId } = createRoom('cur');
    advanceReadCursor(roomId, actor('a'), 7);
    recordPresence(roomId, actor('a'), 0, false);
    expect(getReadCursor(roomId, 'a')).toBe(7);
  });

  it('advanceReadCursor preserves an auto agent\'s auto flag', () => {
    const { roomId } = createRoom('cur');
    recordPresence(roomId, actor('bot'), 0, true);
    advanceReadCursor(roomId, actor('bot'), 4);
    const states = listUnreadStates(roomId);
    expect(states.find((s) => s.callsign === 'bot')?.lastReadSeq).toBe(4);
  });
});

describe('unread derivation', () => {
  it('counts posts past the cursor, not joins/leaves', () => {
    const { roomId } = createRoom('u');
    appendEvent(roomId, { kind: 'join', actor: actor('a'), body: '', mentions: [], replyTo: null, repoHint: 'x' });
    post(roomId, 'a', 'one');
    post(roomId, 'a', 'two @b');
    const u = getUnreadState(roomId, 'b');
    expect(u.lastReadSeq).toBe(0);
    expect(u.unreadCount).toBe(2);          // join excluded
    expect(u.mentionCount).toBe(1);
    expect(u.headSeq).toBe(3);
  });

  it('goes to zero after the cursor advances to head', () => {
    const { roomId } = createRoom('u');
    post(roomId, 'a', 'one');
    const last = post(roomId, 'a', 'two');
    advanceReadCursor(roomId, actor('b'), last.seq);
    const u = getUnreadState(roomId, 'b');
    expect(u.unreadCount).toBe(0);
    expect(u.mentionCount).toBe(0);
  });

  it('lock events count as unread coordination signals', () => {
    const { roomId } = createRoom('u');
    claimRoomLock(roomId, actor('a'), 'res', 60_000, 'x', false);
    expect(getUnreadState(roomId, 'b').unreadCount).toBe(1);
    expect(isUnreadKind('lock')).toBe(true);
    expect(isUnreadKind('join')).toBe(false);
  });
});

describe('room locks', () => {
  it('claim, contention, and release', () => {
    const { roomId } = createRoom('l');
    const r1 = claimRoomLock(roomId, actor('a'), 'File.ts', 60_000, 'x', false);
    expect(r1.ok).toBe(true);
    expect(r1.event?.lock?.resource).toBe('file.ts');   // normalized lowercase

    const r2 = claimRoomLock(roomId, actor('b'), 'file.ts', 60_000, 'x', false);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain('held by a');

    const rel = releaseRoomLock(roomId, actor('a'), 'file.ts', 'x');
    expect(rel.ok).toBe(true);
    expect(listRoomLocks(roomId)).toHaveLength(0);

    const r3 = claimRoomLock(roomId, actor('b'), 'file.ts', 60_000, 'x', false);
    expect(r3.ok).toBe(true);
  });

  it('re-claim by the holder extends the lease', () => {
    const { roomId } = createRoom('l');
    claimRoomLock(roomId, actor('a'), 'res', 60_000, 'x', false);
    const again = claimRoomLock(roomId, actor('a'), 'res', 120_000, 'x', false);
    expect(again.ok).toBe(true);
    expect(listRoomLocks(roomId)).toHaveLength(1);
  });

  it('sanitizes a NaN/huge TTL instead of throwing a RangeError', () => {
    const { roomId } = createRoom('l');
    const nan = claimRoomLock(roomId, actor('a'), 'res-nan', Number.NaN, 'x', false);
    expect(nan.ok).toBe(true);   // floored to the 1-minute minimum
    const huge = claimRoomLock(roomId, actor('a'), 'res-huge', Number.MAX_SAFE_INTEGER, 'x', false);
    expect(huge.ok).toBe(true);  // capped at 1 year — Date stays representable
    expect(new Date(huge.event!.lock!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('steal is refused while the lock is active', () => {
    const { roomId } = createRoom('l');
    claimRoomLock(roomId, actor('a'), 'res', 60_000, 'x', false);
    const steal = claimRoomLock(roomId, actor('b'), 'res', 60_000, 'x', true);
    expect(steal.ok).toBe(false);
    expect(steal.reason).toContain('ACTIVE');
  });

  it('steal succeeds after expiry, references the stale seq, and mentions the holder', () => {
    const { roomId } = createRoom('l');
    // Write an already-expired lock directly (claimRoomLock floors TTL at 1m).
    const stale = appendEvent(roomId, {
      kind: 'lock', actor: actor('a'), body: 'LOCK "res"', mentions: [], replyTo: null, repoHint: 'x',
      lock: { resource: 'res', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    expect(listRoomLocks(roomId)[0]?.status).toBe('expired');

    const plain = claimRoomLock(roomId, actor('b'), 'res', 60_000, 'x', false);
    expect(plain.ok).toBe(false);
    expect(plain.reason).toContain('--steal');

    const steal = claimRoomLock(roomId, actor('b'), 'res', 60_000, 'x', true);
    expect(steal.ok).toBe(true);
    expect(steal.event?.kind).toBe('lock-steal');
    expect(steal.event?.lock?.stolenFromSeq).toBe(stale.seq);
    expect(steal.event?.mentions).toContain('a');
    expect(listRoomLocks(roomId)[0]?.holder).toBe('b');
  });

  it('only the holder may release; expired locks surface via expiredLocksHeldBy', () => {
    const { roomId } = createRoom('l');
    appendEvent(roomId, {
      kind: 'lock', actor: actor('a'), body: 'LOCK "res"', mentions: [], replyTo: null, repoHint: 'x',
      lock: { resource: 'res', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const relByOther = releaseRoomLock(roomId, actor('b'), 'res', 'x');
    expect(relByOther.ok).toBe(false);

    expect(expiredLocksHeldBy(roomId, 'a').map((l) => l.resource)).toEqual(['res']);

    const relByHolder = releaseRoomLock(roomId, actor('a'), 'res', 'x');
    expect(relByHolder.ok).toBe(true);
    expect(expiredLocksHeldBy(roomId, 'a')).toHaveLength(0);
  });

  it('foldLocks is a pure fold: latest event per resource wins, release clears', () => {
    const now = Date.now();
    const mk = (seq: number, kind: string, resource: string, who: string, expiresAt: string, stolenFromSeq?: number) => ({
      seq, id: `e${seq}`, roomId: 'r', kind, createdAt: new Date(now).toISOString(),
      actor: actor(who), repoHint: 'x', body: '', mentions: [], replyTo: null,
      lock: { resource, expiresAt, ...(stolenFromSeq != null ? { stolenFromSeq } : {}) },
    });
    const future = new Date(now + 60_000).toISOString();
    const past = new Date(now - 60_000).toISOString();
    const folded = foldLocks([
      mk(1, 'lock', 'a', 'x', past),
      mk(2, 'lock', 'b', 'y', future),
      mk(3, 'lock-steal', 'a', 'z', future, 1),
      mk(4, 'lock', 'c', 'x', future),
      mk(5, 'release', 'c', 'x', new Date(now).toISOString()),
    ] as any, now);
    expect(folded).toHaveLength(2);
    expect(folded.find((l) => l.resource === 'a')).toMatchObject({ holder: 'z', status: 'active', stolenFromSeq: 1 });
    expect(folded.find((l) => l.resource === 'b')).toMatchObject({ holder: 'y', status: 'active' });
  });
});
