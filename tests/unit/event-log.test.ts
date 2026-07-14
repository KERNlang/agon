import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  append,
  appendDurable,
  flush,
  replay,
  latestSeq,
  listSessions,
  readMeta,
  resetEventLogState,
  sessionDir,
  eventsPath,
  metaPath,
  sanitizeSessionId,
  type LoggedEvent,
} from '../../packages/core/src/generated/sessions/event-log.js';
import {
  teeOutputEvent,
  flushEventLogTee,
  resetEventLogTee,
} from '../../packages/cli/src/generated/signals/event-log-tee.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-event-log-'));
  process.env.AGON_HOME = home;
  resetEventLogState();
});

afterEach(() => {
  resetEventLogState();
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

// A realistic mixed OutputEvent-ish sequence: a turn with a user message,
// streaming, a tool call, an engine block, and a clear.
const REALISTIC_TURN = [
  { type: 'user-message', text: 'refactor the auth middleware' },
  { type: 'spinner-start', message: 'thinking', engineId: 'claude' },
  { type: 'streaming-start', engineId: 'claude' },
  { type: 'streaming-chunk', engineId: 'claude', chunk: "I'll start by " },
  { type: 'streaming-chunk', engineId: 'claude', chunk: 'reading the file.' },
  { type: 'tool-call', engineId: 'claude', tool: 'Read', input: 'auth.ts', status: 'done' },
  { type: 'streaming-end', engineId: 'claude' },
  { type: 'engine-block', engineId: 'claude', content: 'Done — extracted validateToken().' },
  { type: 'clear' },
];

describe('event-log — replay proof', () => {
  it('rebuilds the exact appended sequence in order with monotonic seqs (replay from 0)', () => {
    const sid = 'chat-1001';
    const assigned: number[] = [];
    for (const ev of REALISTIC_TURN) assigned.push(append(sid, ev));
    flush(sid);

    // seqs assigned at append time are 1..N monotonic
    expect(assigned).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const got = replay(sid, 0);
    expect(got).toHaveLength(REALISTIC_TURN.length);
    // exact payloads in order
    expect(got.map((e) => e.event)).toEqual(REALISTIC_TURN);
    // monotonic strictly-increasing seqs, each stamped with a ts
    for (let i = 0; i < got.length; i++) {
      expect(got[i].seq).toBe(i + 1);
      expect(typeof got[i].ts).toBe('number');
      if (i > 0) expect(got[i].seq).toBeGreaterThan(got[i - 1].seq);
    }
  });

  it('replay(fromSeq) returns only events strictly after the cursor', () => {
    const sid = 'chat-1002';
    for (const ev of REALISTIC_TURN) append(sid, ev);
    flush(sid);

    const mid = replay(sid, 5);
    expect(mid.map((e) => e.seq)).toEqual([6, 7, 8, 9]);
    expect(mid.map((e) => (e.event as any).type)).toEqual([
      'tool-call',
      'streaming-end',
      'engine-block',
      'clear',
    ]);

    // fromSeq at the tail returns nothing; fromSeq past the end is empty too.
    expect(replay(sid, 9)).toEqual([]);
    expect(replay(sid, 100)).toEqual([]);
  });

  it('replay reflects still-buffered (not-yet-flushed) events during a live session', () => {
    const sid = 'chat-1003';
    // Use a long flush window so nothing has hit disk yet.
    append(sid, { type: 'a' }, { flushMs: 10_000 });
    append(sid, { type: 'b' }, { flushMs: 10_000 });
    // Disk file should be empty/absent, but replay must still see the buffer.
    const got = replay(sid, 0);
    expect(got.map((e) => (e.event as any).type)).toEqual(['a', 'b']);
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('event-log — durability & seq recovery', () => {
  it('appendDurable persists before returning and preserves monotonic ordering', () => {
    const sid = 'chat-durable-1';
    append(sid, { type: 'buffered' }, { flushMs: 10_000 });
    const result = appendDurable(sid, { kind: 'control-plane', schemaVersion: 1, type: 'tool_claimed' });

    expect(result).toEqual({ ok: true, seq: 2 });
    resetEventLogState();
    expect(replay(sid, 0).map((entry) => entry.event)).toEqual([
      { type: 'buffered' },
      { kind: 'control-plane', schemaVersion: 1, type: 'tool_claimed' },
    ]);
  });

  it('flush writes one NDJSON line per event', () => {
    const sid = 'chat-2001';
    append(sid, { type: 'x', n: 1 });
    append(sid, { type: 'y', n: 2 });
    flush(sid);
    const lines = readFileSync(eventsPath(sid), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).seq).toBe(1);
    expect(JSON.parse(lines[1]).seq).toBe(2);
    expect(JSON.parse(lines[1]).event).toEqual({ type: 'y', n: 2 });
  });

  it('a fresh process (state reset) continues seq monotonically from disk', () => {
    const sid = 'chat-2002';
    append(sid, { type: 'a' });
    append(sid, { type: 'b' });
    flush(sid);
    // Simulate process restart: drop in-memory buffers, seq must resume from disk.
    resetEventLogState();
    const seq = append(sid, { type: 'c' });
    flush(sid);
    expect(seq).toBe(3);
    expect(replay(sid, 0).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('latestSeq reflects buffered events while live and disk after reset', () => {
    const sid = 'chat-2003';
    expect(latestSeq(sid)).toBe(0); // unknown session
    append(sid, { type: 'a' }, { flushMs: 10_000 });
    append(sid, { type: 'b' }, { flushMs: 10_000 });
    expect(latestSeq(sid)).toBe(2); // buffered, not yet flushed
    flush(sid);
    resetEventLogState();
    expect(latestSeq(sid)).toBe(2); // from disk scan
  });
});

describe('event-log — corrupt-final-line tolerance', () => {
  it('replay skips a truncated/corrupt final line and never throws', () => {
    const sid = 'chat-3001';
    append(sid, { type: 'ok-1' });
    append(sid, { type: 'ok-2' });
    flush(sid);
    resetEventLogState();
    // Simulate a crash mid-write: append a partial JSON line with no newline.
    const path = eventsPath(sid);
    writeFileSync(path, readFileSync(path, 'utf-8') + '{"seq":3,"ts":1,"event":{"type":"trunc"', { flag: 'w' });

    let got!: LoggedEvent[];
    expect(() => { got = replay(sid, 0); }).not.toThrow();
    expect(got.map((e) => (e.event as any).type)).toEqual(['ok-1', 'ok-2']);
    // A new append continues from the highest VALID seq on disk (2), not the corrupt 3.
    const next = append(sid, { type: 'ok-3' });
    expect(next).toBe(3);
  });

  it('replay of a totally garbage file returns [] without throwing', () => {
    const sid = 'chat-3002';
    append(sid, { type: 'seed' });
    flush(sid);
    resetEventLogState();
    writeFileSync(eventsPath(sid), 'not json at all\n{also broken\n', { flag: 'w' });
    let got!: LoggedEvent[];
    expect(() => { got = replay(sid, 0); }).not.toThrow();
    expect(got).toEqual([]);
  });
});

describe('event-log — rotation', () => {
  it('rotates events.ndjson to events.<lastSeq>.ndjson past a tiny threshold and replay spans both', () => {
    const sid = 'chat-4001';
    const opts = { rotateBytes: 200, flushMs: 0 };
    // Each flush checks size AFTER writing. Append+flush a few small events;
    // once the active file exceeds the 200-byte threshold it rotates on the
    // next flush. Line size is whatever JSON.stringify produces — we don't
    // assert on byte counts, only that a rotation happened and replay is whole.
    const payload = { type: 'pad', data: 'xxxxxxxxxxxxxxxxxxxx' };
    let lastSeq = 0;
    for (let i = 0; i < 8; i++) {
      lastSeq = append(sid, payload, opts);
      flush(sid);
    }
    const files = readdirSync(sessionDir(sid)).filter((f) => /^events\.\d+\.ndjson$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(1);

    // The active events.ndjson plus the rotated segment(s) together replay the
    // full monotonic sequence with no gaps and no duplicates.
    const got = replay(sid, 0);
    expect(got.map((e) => e.seq)).toEqual(Array.from({ length: lastSeq }, (_, i) => i + 1));
  });

  it('does not rotate below the threshold', () => {
    const sid = 'chat-4002';
    for (let i = 0; i < 3; i++) append(sid, { type: 't', i }, { rotateBytes: 50 * 1024 * 1024 });
    flush(sid);
    const rotated = readdirSync(sessionDir(sid)).filter((f) => /^events\.\d+\.ndjson$/.test(f));
    expect(rotated).toHaveLength(0);
    expect(existsSync(eventsPath(sid))).toBe(true);
  });
});

describe('event-log — meta.json', () => {
  it('writes meta.json once with createdAt + kind and never overwrites it', () => {
    const sid = 'chat-5001';
    append(sid, { type: 'a' }, { kind: 'repl' });
    flush(sid);
    const meta1 = readMeta(sid)!;
    expect(meta1).toBeTruthy();
    expect(meta1.sessionId).toBe('chat-5001');
    expect(meta1.kind).toBe('repl');
    expect(typeof meta1.createdAt).toBe('string');
    expect(existsSync(metaPath(sid))).toBe(true);

    // A second touch (even with a different kind) must NOT overwrite the original.
    resetEventLogState();
    append(sid, { type: 'b' }, { kind: 'daemon' });
    flush(sid);
    const meta2 = readMeta(sid)!;
    expect(meta2.kind).toBe('repl'); // unchanged
    expect(meta2.createdAt).toBe(meta1.createdAt);
  });
});

describe('event-log — listSessions', () => {
  it('lists session dirs cheaply and returns [] when the root is absent', () => {
    expect(listSessions()).toEqual([]); // nothing created yet
    append('chat-6001', { type: 'a' });
    append('chat-6002', { type: 'b' });
    flush('chat-6001');
    flush('chat-6002');
    const sessions = listSessions().sort();
    expect(sessions).toEqual(['chat-6001', 'chat-6002']);
  });
});

describe('event-log — concurrent sessions do not interleave', () => {
  it('interleaved appends to two sessions land in separate files, each monotonic', () => {
    const a = 'chat-7001';
    const b = 'chat-7002';
    // Interleave appends across the two sessions.
    append(a, { type: 'a1' });
    append(b, { type: 'b1' });
    append(a, { type: 'a2' });
    append(b, { type: 'b2' });
    append(a, { type: 'a3' });
    flush(a);
    flush(b);

    const ga = replay(a, 0);
    const gb = replay(b, 0);
    expect(ga.map((e) => (e.event as any).type)).toEqual(['a1', 'a2', 'a3']);
    expect(ga.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(gb.map((e) => (e.event as any).type)).toEqual(['b1', 'b2']);
    expect(gb.map((e) => e.seq)).toEqual([1, 2]);

    // Files are physically separate — a's file holds no b events and vice versa.
    const aRaw = readFileSync(eventsPath(a), 'utf-8');
    const bRaw = readFileSync(eventsPath(b), 'utf-8');
    expect(aRaw).not.toContain('b1');
    expect(aRaw).not.toContain('b2');
    expect(bRaw).not.toContain('a1');
    expect(bRaw).not.toContain('a3');
  });
});

describe('event-log — seq recovery survives rotation', () => {
  it('after rotation + reset, a fresh append continues past the rotated segment seqs (no collision)', () => {
    const sid = 'chat-4101';
    const opts = { rotateBytes: 200, flushMs: 0 };
    const payload = { type: 'pad', data: 'xxxxxxxxxxxxxxxxxxxx' };
    let lastSeq = 0;
    for (let i = 0; i < 8; i++) { lastSeq = append(sid, payload, opts); flush(sid); }
    // At least one rotated segment now exists.
    const rotated = readdirSync(sessionDir(sid)).filter((f) => /^events\.\d+\.ndjson$/.test(f));
    expect(rotated.length).toBeGreaterThanOrEqual(1);

    // Simulate a process restart: drop in-memory buffers. Recovery MUST scan the
    // rotated segments, not just the (possibly empty/fresh) active file, or seq
    // would reset to 1 and collide with already-written seqs (review #1).
    resetEventLogState();
    const next = append(sid, { type: 'after-restart' }, opts);
    flush(sid);
    expect(next).toBe(lastSeq + 1);

    // The full replay is strictly monotonic with no gaps and no duplicate seqs.
    const seqs = replay(sid, 0).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: lastSeq + 1 }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(seqs.length); // no dupes
  });

  it('latestSeq after a rotation+reset reflects the rotated segment, not 0', () => {
    const sid = 'chat-4102';
    const opts = { rotateBytes: 200, flushMs: 0 };
    const payload = { type: 'pad', data: 'xxxxxxxxxxxxxxxxxxxx' };
    let lastSeq = 0;
    for (let i = 0; i < 8; i++) { lastSeq = append(sid, payload, opts); flush(sid); }
    resetEventLogState();
    expect(latestSeq(sid)).toBe(lastSeq);
  });
});

describe('event-log — non-serializable events never poison the batch', () => {
  it('an event carrying a function (e.g. a resolve callback) persists with the function dropped, batch intact', () => {
    const sid = 'chat-4201';
    const resolve = (_answer: string) => { /* live callback that cannot survive replay */ };
    append(sid, { type: 'before' }, { flushMs: 10_000 });
    append(sid, { type: 'question', prompt: 'pick one', resolve }, { flushMs: 10_000 });
    append(sid, { type: 'after' }, { flushMs: 10_000 });
    flush(sid);

    const got = replay(sid, 0);
    // All three events present, monotonic — the function event did NOT drop the batch.
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(got.map((e) => (e.event as any).type)).toEqual(['before', 'question', 'after']);
    // The callback field is gone (functions don't serialize), the rest survives.
    const q = got[1].event as any;
    expect(q.prompt).toBe('pick one');
    expect(q.resolve).toBeUndefined();
  });

  it('a circular event becomes a one-line placeholder instead of throwing and dropping the batch', () => {
    const sid = 'chat-4202';
    const circular: any = { type: 'loopy' };
    circular.self = circular; // JSON.stringify would throw on this
    append(sid, { type: 'a' }, { flushMs: 10_000 });
    append(sid, circular, { flushMs: 10_000 });
    append(sid, { type: 'b' }, { flushMs: 10_000 });
    flush(sid);

    const lines = readFileSync(eventsPath(sid), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3); // one line per event — no gap, no drop
    const got = replay(sid, 0);
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3]);
    // The circular event's cycle was replaced by a sentinel, but the seq/ts survive.
    expect((got[1].event as any).type).toBe('loopy');
    expect((got[1].event as any).self).toBe('[circular]');
  });
});

describe('event-log-tee — fire-and-forget bridge with failure latch', () => {
  beforeEach(() => { resetEventLogTee(); delete process.env.AGON_NO_EVENT_LOG; });
  afterEach(() => { resetEventLogTee(); delete process.env.AGON_NO_EVENT_LOG; });

  it('tees events into the per-session ledger and replays them', () => {
    const sid = 'chat-9001';
    teeOutputEvent(sid, { type: 'user-message', text: 'hi' });
    teeOutputEvent(sid, { type: 'engine-block', engineId: 'claude', content: 'hello' });
    flushEventLogTee(sid);
    const got = replay(sid, 0);
    expect(got.map((e) => (e.event as any).type)).toEqual(['user-message', 'engine-block']);
  });

  it('is a no-op for an empty sessionId', () => {
    teeOutputEvent('', { type: 'x' });
    flushEventLogTee('');
    expect(listSessions()).toEqual([]);
  });

  it('AGON_NO_EVENT_LOG=1 disables the tee (nothing written)', () => {
    process.env.AGON_NO_EVENT_LOG = '1';
    teeOutputEvent('chat-9002', { type: 'x' });
    flushEventLogTee('chat-9002');
    expect(replay('chat-9002', 0)).toEqual([]);
  });

  it('trips the disable-after-N latch on repeated deferred-flush (disk-write) failures', () => {
    // Make the sessions root a FILE so mkdirSync/appendFileSync inside flush()
    // throws — the failure surfaces in the deferred flush, NOT in append(), so
    // this exercises the cross-boundary signal (review #1, round 2).
    const fileAsRoot = join(home, 'sessions');
    writeFileSync(fileAsRoot, 'not a directory');

    const sid = 'chat-9003';
    // Each append+flush bumps core's write-failure counter by 1; the tee folds
    // the delta into its latch. MAX_TEE_FAILURES=3 → disabled by the 3rd.
    for (let i = 0; i < 4; i++) {
      teeOutputEvent(sid, { type: 'x', i }); // synchronous enqueue (succeeds)
      flushEventLogTee(sid);                 // deferred write fails on the file-root
    }
    // After >= 3 flush failures the latch is tripped: further tees are no-ops
    // even after we repair the filesystem.
    rmSync(fileAsRoot, { force: true });
    teeOutputEvent(sid, { type: 'after-latch' });
    flushEventLogTee(sid);
    // The dir couldn't be created while it was a file; once latched, nothing new
    // is written. (We can't replay through the broken root, so assert the latch
    // by confirming a fresh post-repair tee wrote nothing.)
    expect(replay(sid, 0)).toEqual([]);
  });
});

describe('event-log — id hygiene & AGON_HOME', () => {
  it('sanitizeSessionId strips path-traversal and the dir lives under the AGON_HOME sessions root', () => {
    expect(sanitizeSessionId('../../etc/passwd')).not.toContain('/');
    expect(sanitizeSessionId('')).toBe('session');
    const sid = 'chat-8001';
    append(sid, { type: 'a' });
    flush(sid);
    // The session dir is under the temp AGON_HOME we set in beforeEach.
    expect(sessionDir(sid).startsWith(home)).toBe(true);
    expect(statSync(sessionDir(sid)).isDirectory()).toBe(true);
  });
});
