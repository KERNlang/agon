import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, readEvents, appendEvent } from '../../packages/core/src/generated/rooms/store.js';
import { foldTasks, pickNextTask, postTask, claimTask, postTaskResult, postTaskStop, shouldStopWork } from '../../packages/core/src/generated/rooms/tasks.js';
import type { RoomActor, RoomEvent, WorkConfig, WorkState } from '../../packages/core/src/generated/rooms/types.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-tasks-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

const actor = (callsign: string): RoomActor => ({ actorId: `cli:${callsign}`, callsign, kind: 'external-cli', cli: 'cli', humanOwner: 'x' });
const board = (roomId: string, nowMs = Date.now()) => foldTasks(readEvents(roomId, 0, 0), nowMs);

describe('foldTasks — task lifecycle', () => {
  it('open → claimed → done', () => {
    createRoom('r');
    const t = postTask('r', actor('boss'), 'build the thing', null, 'x');
    const id = t.task!.taskId;
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'open', spec: 'build the thing', target: null, createdBy: 'boss' });

    const c = claimTask('r', actor('w1'), id, 60_000, 'x');
    expect(c.ok).toBe(true);
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'claimed', claimedBy: 'w1' });

    const posted = postTaskResult('r', actor('w1'), id, 'built it', true, 0, 'x');
    expect(posted.ok).toBe(true);
    expect(posted.event!.task!.claimOfSeq).toBe(c.event!.seq); // result pins the winning claim
    const done = board('r').find((x) => x.taskId === id)!;
    expect(done.status).toBe('done');
    expect(done.result).toBe('built it');
    expect(done.exitCode).toBe(0);
  });

  it('a failed result folds to failed', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'risky', null, 'x').task!.taskId;
    claimTask('r', actor('w1'), id, 60_000, 'x');
    postTaskResult('r', actor('w1'), id, 'boom', false, 1, 'x');
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'failed', exitCode: 1 });
  });

  it('an expired-lease claim with no result folds BACK to open (crash recovery)', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'long job', null, 'x').task!.taskId;
    claimTask('r', actor('deadWorker'), id, 1_000, 'x'); // 1s lease
    // Immediately after claim: claimed.
    expect(board('r', Date.now()).find((x) => x.taskId === id)!.status).toBe('claimed');
    // Well past the lease with no result: reclaimable → open.
    const later = board('r', Date.now() + 10_000).find((x) => x.taskId === id)!;
    expect(later.status).toBe('open');
    expect(later.claimedBy).toBe('deadWorker'); // audit trail intact
  });

  it('another worker reclaims an expired task; the reclaim references the dead claim', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'long job', null, 'x').task!.taskId;
    // A crashed worker's claim whose lease is already in the past (claimTask
    // floors TTL to 1s, so append the raw event to make it deterministically stale).
    const dead = appendEvent('r', {
      kind: 'claim', actor: actor('deadWorker'), body: 'CLAIM', mentions: [], replyTo: null, repoHint: 'x',
      task: { taskId: id, status: 'claimed', leaseExpiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    expect(board('r').find((x) => x.taskId === id)!.status).toBe('open'); // reclaimable
    const reclaim = claimTask('r', actor('freshWorker'), id, 60_000, 'x');
    expect(reclaim.ok).toBe(true);
    expect(reclaim.event!.task!.claimOfSeq).toBe(dead.seq);
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'claimed', claimedBy: 'freshWorker' });
  });
});

describe('postTaskResult — one-completer guarantee', () => {
  // The full stall/reclaim scenario: A claims and stalls past its lease, B
  // reclaims and completes; A's late result must be refused AND, even if it
  // somehow landed on the ledger, must not fold over B's completion.
  const stalledClaim = (id: string, by: string) => appendEvent('r', {
    kind: 'claim', actor: actor(by), body: 'CLAIM', mentions: [], replyTo: null, repoHint: 'x',
    task: { taskId: id, status: 'claimed', leaseExpiresAt: new Date(Date.now() - 1000).toISOString() },
  });

  it("a revived worker's late result is refused; the reclaimer's completion stands", () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'contended job', null, 'x').task!.taskId;
    stalledClaim(id, 'a'); // A claimed, stalled, lease expired
    expect(claimTask('r', actor('b'), id, 60_000, 'x').ok).toBe(true); // B reclaims
    // A revives mid-B and tries to post → refused (B holds the claim).
    const lateWhileClaimed = postTaskResult('r', actor('a'), id, 'stale A output', true, 0, 'x');
    expect(lateWhileClaimed.ok).toBe(false);
    expect(lateWhileClaimed.reason).toContain('b');
    // B completes.
    expect(postTaskResult('r', actor('b'), id, 'B finished it', true, 0, 'x').ok).toBe(true);
    // A tries again after B's completion → refused (task is done).
    expect(postTaskResult('r', actor('a'), id, 'stale A output', true, 0, 'x').ok).toBe(false);
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'done', claimedBy: 'b', result: 'B finished it' });
  });

  it('foldTasks ignores a blindly-appended foreign/late result (defense in depth)', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'contended job', null, 'x').task!.taskId;
    stalledClaim(id, 'a');
    expect(claimTask('r', actor('b'), id, 60_000, 'x').ok).toBe(true);
    expect(postTaskResult('r', actor('b'), id, 'B finished it', true, 0, 'x').ok).toBe(true);
    // A's result bypasses postTaskResult entirely (old/foreign ledger writer).
    appendEvent('r', {
      kind: 'result', actor: actor('a'), body: 'stale A output', mentions: [], replyTo: null, repoHint: 'x', auto: true,
      task: { taskId: id, status: 'done', exitCode: 0 },
    });
    // A result by the RIGHT actor but a WRONG claimOfSeq is also ignored.
    appendEvent('r', {
      kind: 'result', actor: actor('b'), body: 'forged claim ref', mentions: [], replyTo: null, repoHint: 'x', auto: true,
      task: { taskId: id, status: 'failed', exitCode: 1, claimOfSeq: 999_999 },
    });
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'done', result: 'B finished it', exitCode: 0 });
  });

  it('renew-then-complete: the result pins the LATEST claim seq (renewals move it)', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'long job', null, 'x').task!.taskId;
    const c1 = claimTask('r', actor('w1'), id, 60_000, 'x');
    const c2 = claimTask('r', actor('w1'), id, 60_000, 'x'); // renewal → claimSeq moves
    expect(c1.ok && c2.ok).toBe(true);
    expect(c2.event!.seq).toBeGreaterThan(c1.event!.seq);
    const posted = postTaskResult('r', actor('w1'), id, 'done after renew', true, 0, 'x');
    expect(posted.ok).toBe(true);
    expect(posted.event!.task!.claimOfSeq).toBe(c2.event!.seq); // matches the RENEWED claim
    expect(board('r').find((x) => x.taskId === id)).toMatchObject({ status: 'done', result: 'done after renew' });
  });
});

describe('claimTask — mutual exclusion', () => {
  it('exactly one of two concurrent claims wins', async () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'contended', null, 'x').task!.taskId;
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => claimTask('r', actor('w1'), id, 60_000, 'x')),
      Promise.resolve().then(() => claimTask('r', actor('w2'), id, 60_000, 'x')),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    // The board agrees with the single winner.
    const held = board('r').find((x) => x.taskId === id)!;
    expect(held.status).toBe('claimed');
    expect([a.ok ? 'w1' : 'w2']).toContain(held.claimedBy);
  });

  it('refuses a claim on a task actively held by someone else', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'held', null, 'x').task!.taskId;
    expect(claimTask('r', actor('w1'), id, 60_000, 'x').ok).toBe(true);
    const second = claimTask('r', actor('w2'), id, 60_000, 'x');
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('w1');
  });

  it('lets the current holder renew (extend) its own claim', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'mine', null, 'x').task!.taskId;
    claimTask('r', actor('w1'), id, 5_000, 'x');
    const renew = claimTask('r', actor('w1'), id, 60_000, 'x');
    expect(renew.ok).toBe(true);
    expect(renew.event!.task!.claimOfSeq).toBeUndefined(); // self-renew, not a reclaim
  });

  it('refuses a done/failed task', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'finished', null, 'x').task!.taskId;
    claimTask('r', actor('w1'), id, 60_000, 'x');
    postTaskResult('r', actor('w1'), id, 'ok', true, 0, 'x');
    expect(claimTask('r', actor('w2'), id, 60_000, 'x').ok).toBe(false);
  });
});

describe('pickNextTask — ordering and targeting', () => {
  it('returns the oldest open task, skipping claimed ones', () => {
    createRoom('r');
    const a = postTask('r', actor('boss'), 'first', null, 'x').task!.taskId;
    const b = postTask('r', actor('boss'), 'second', null, 'x').task!.taskId;
    claimTask('r', actor('w1'), a, 60_000, 'x'); // a is taken
    const next = pickNextTask(board('r'), 'w2');
    expect(next?.taskId).toBe(b); // oldest OPEN
  });

  it('a targeted task is only pickable by its target', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'for codex only', 'codex', 'x').task!.taskId;
    expect(pickNextTask(board('r'), 'claude')).toBeNull();
    expect(pickNextTask(board('r'), 'codex')?.taskId).toBe(id);
  });

  it('and claimTask enforces targeting too', () => {
    createRoom('r');
    const id = postTask('r', actor('boss'), 'for codex only', 'codex', 'x').task!.taskId;
    expect(claimTask('r', actor('claude'), id, 60_000, 'x').ok).toBe(false);
    expect(claimTask('r', actor('codex'), id, 60_000, 'x').ok).toBe(true);
  });

  it('returns null when nothing is workable', () => {
    createRoom('r');
    expect(pickNextTask(board('r'), 'w1')).toBeNull();
  });
});

describe('shouldStopWork', () => {
  const cfg = (over: Partial<WorkConfig> = {}): WorkConfig => ({ callsign: 'w1', maxWallMs: 600_000, leaseTtlMs: 60_000, taskTimeoutMs: 600_000, ...over });
  const state = (over: Partial<WorkState> = {}): WorkState => ({ startedAtMs: Date.now(), tasksHandled: 0, joinSeq: 0, ...over });
  const stopEv = (seq: number): RoomEvent => ({ seq, id: `e${seq}`, roomId: 'r', kind: 'task-stop', createdAt: new Date().toISOString(), actor: actor('boss'), repoHint: 'x', body: 'enough', mentions: [], replyTo: null });

  it('stops on max wall time', () => {
    expect(shouldStopWork(state({ startedAtMs: Date.now() - 700_000 }), cfg({ maxWallMs: 600_000 }), [])).toMatchObject({ stop: true, reason: 'max-wall-time' });
  });
  it('stops on a task-stop posted AFTER this worker joined (seq > joinSeq)', () => {
    expect(shouldStopWork(state({ joinSeq: 3 }), cfg(), [stopEv(5)])).toMatchObject({ stop: true, reason: 'task-stop' });
  });
  it('ignores a STALE task-stop from before this worker joined (seq < joinSeq)', () => {
    // Yesterday's `room stop` must not brick today's work session in the same room.
    expect(shouldStopWork(state({ joinSeq: 10 }), cfg(), [stopEv(5)])).toMatchObject({ stop: false });
  });
  it('does not stop otherwise', () => {
    expect(shouldStopWork(state(), cfg(), [])).toMatchObject({ stop: false });
  });
});
