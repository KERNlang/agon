import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  append,
  flush,
  replay as logReplay,
  resetEventLogState,
} from '../../packages/core/src/generated/sessions/event-log.js';
import {
  InProcessSessionHost,
  type LoggedEvent,
} from '../../packages/core/src/generated/sessions/session-host.js';

let home: string;
let host: InProcessSessionHost;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-session-host-'));
  process.env.AGON_HOME = home;
  resetEventLogState();
  host = new InProcessSessionHost();
});

afterEach(() => {
  resetEventLogState();
  delete process.env.AGON_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('InProcessSessionHost — listSessions', () => {
  it('returns a descriptor per session with id/kind/lastSeq', () => {
    append('alpha', { type: 'text', content: 'hi' });
    append('alpha', { type: 'text', content: 'there' });
    append('beta', { type: 'text', content: 'one' });
    flush('alpha');
    flush('beta');

    const sessions = host.listSessions();
    const byId = new Map(sessions.map((s) => [s.id, s]));

    expect(sessions).toHaveLength(2);
    expect(byId.get('alpha')!.lastSeq).toBe(2);
    expect(byId.get('beta')!.lastSeq).toBe(1);
    // meta.kind defaults to 'repl'; active is always false for the disk reader.
    expect(byId.get('alpha')!.kind).toBe('repl');
    expect(byId.get('alpha')!.active).toBe(false);
    // createdAt is a parseable ISO string sourced from meta.json.
    expect(Number.isFinite(Date.parse(byId.get('alpha')!.createdAt))).toBe(true);
  });

  it('lastSeq is 0 / list is empty before any session exists', () => {
    expect(host.listSessions()).toEqual([]);
    expect(host.latestSeq('nope')).toBe(0);
  });
});

describe('InProcessSessionHost — replay parity', () => {
  it('replay() matches the ledger replay exactly (full + fromSeq)', () => {
    const sid = 'parity';
    const events = [
      { type: 'user-message', content: 'go' },
      { type: 'streaming-chunk', engineId: 'claude', chunk: 'work' },
      { type: 'engine-block', engineId: 'claude', content: 'done' },
      { type: 'success', message: 'ok' },
    ];
    for (const ev of events) append(sid, ev);
    flush(sid);

    // Parity with the underlying ledger replay, from 0 and from a cursor.
    expect(host.replay(sid, 0)).toEqual(logReplay(sid, 0));
    expect(host.replay(sid, 2)).toEqual(logReplay(sid, 2));

    // And the shape we expect: 4 events, monotonic seqs, payloads preserved.
    const all = host.replay(sid, 0);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(all.map((e) => e.event)).toEqual(events);

    // fromSeq cursor returns only events strictly after it.
    expect(host.replay(sid, 2).map((e) => e.seq)).toEqual([3, 4]);
  });

  it('latestSeq tracks the highest appended seq', () => {
    const sid = 'seqs';
    expect(host.latestSeq(sid)).toBe(0);
    append(sid, { type: 'text', content: 'a' });
    append(sid, { type: 'text', content: 'b' });
    expect(host.latestSeq(sid)).toBe(2);
  });
});

describe('InProcessSessionHost — subscribe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('delivers newly-appended events from the given seq, in order', () => {
    const sid = 'live';
    // Seed two events the subscriber should NOT see (it starts at seq 2).
    append(sid, { type: 'text', content: 'old-1' });
    append(sid, { type: 'text', content: 'old-2' });
    flush(sid);

    const seen: LoggedEvent[] = [];
    const unsub = host.subscribe(sid, 2, (e) => seen.push(e), { pollMs: 10 });

    // Nothing yet — the first poll hasn't fired.
    expect(seen).toHaveLength(0);

    // A second "running agon" appends two more events.
    append(sid, { type: 'engine-block', engineId: 'claude', content: 'new-3' });
    append(sid, { type: 'success', message: 'new-4' });
    flush(sid);

    vi.advanceTimersByTime(10);

    expect(seen.map((e) => e.seq)).toEqual([3, 4]);
    expect(seen.map((e) => (e.event as { content?: string; message?: string }).content
      ?? (e.event as { message?: string }).message)).toEqual(['new-3', 'new-4']);

    unsub();
  });

  it('keeps following across multiple poll ticks without re-delivering history', () => {
    const sid = 'stream';
    const seen: LoggedEvent[] = [];
    const unsub = host.subscribe(sid, 0, (e) => seen.push(e), { pollMs: 10 });

    append(sid, { type: 'text', content: 'a' });
    flush(sid);
    vi.advanceTimersByTime(10);
    expect(seen.map((e) => e.seq)).toEqual([1]);

    append(sid, { type: 'text', content: 'b' });
    append(sid, { type: 'text', content: 'c' });
    flush(sid);
    vi.advanceTimersByTime(10);

    // Only the new events arrive on the second tick — no re-delivery of seq 1.
    expect(seen.map((e) => e.seq)).toEqual([1, 2, 3]);

    unsub();
  });

  it('unsubscribe stops delivery of events appended afterward', () => {
    const sid = 'detach';
    const seen: LoggedEvent[] = [];
    const unsub = host.subscribe(sid, 0, (e) => seen.push(e), { pollMs: 10 });

    append(sid, { type: 'text', content: 'before' });
    flush(sid);
    vi.advanceTimersByTime(10);
    expect(seen.map((e) => e.seq)).toEqual([1]);

    unsub();

    append(sid, { type: 'text', content: 'after' });
    flush(sid);
    vi.advanceTimersByTime(50);

    // No further callbacks after unsubscribe.
    expect(seen.map((e) => e.seq)).toEqual([1]);
  });

  it('fires no callbacks for a session with no events', () => {
    const seen: LoggedEvent[] = [];
    const unsub = host.subscribe('empty', 0, (e) => seen.push(e), { pollMs: 10 });
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([]);
    unsub();
  });

  it('a non-finite fromSeq snaps to 0 (replays from start) instead of delivering nothing', () => {
    const sid = 'nan-cursor';
    append(sid, { type: 'text', content: 'a' });
    append(sid, { type: 'text', content: 'b' });
    flush(sid);

    const seen: LoggedEvent[] = [];
    // NaN passes `typeof === 'number'` — the guard must treat it as 0, else
    // `ev.seq > NaN` is always false and the subscriber gets nothing.
    const unsub = host.subscribe(sid, Number.NaN, (e) => seen.push(e), { pollMs: 10 });
    vi.advanceTimersByTime(10);
    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
    unsub();
  });
});
