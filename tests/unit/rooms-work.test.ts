import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, isRoomClosed, appendEvent } from '../../packages/core/src/generated/rooms/store.js';
import { drainRoom, createRoomWaker } from '../../packages/core/src/generated/rooms/tail.js';
import { foldTasks, pickNextTask, postTask, claimTask, postTaskResult, postTaskStop, shouldStopWork } from '../../packages/core/src/generated/rooms/tasks.js';
import type { RoomActor, RoomEvent, TailCursor, WorkConfig, WorkState } from '../../packages/core/src/generated/rooms/types.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-work-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

const actor = (callsign: string): RoomActor => ({ actorId: `cli:${callsign}`, callsign, kind: 'external-cli', cli: 'cli', humanOwner: 'x' });

// Mirrors the `room work --dry-run` loop body using the exact exported
// primitives the CLI wires, but bounded to a fixed number of iterations so the
// test terminates. The watchdog is deliberately long so a wake proves fs.watch,
// not the fallback timer.
describe('room work — end-to-end dry-run loop (fs.watch driven)', () => {
  it('open → claimed → done, waking via fs.watch well under the watchdog', async () => {
    const roomId = createRoom('work-room').roomId;
    const worker = actor('w1');
    const WATCHDOG = 5000;
    const workCfg: WorkConfig = { callsign: worker.callsign, maxWallMs: 600_000, leaseTtlMs: 60_000, taskTimeoutMs: 600_000 };

    const waker = createRoomWaker(roomId, WATCHDOG, () => {});
    let cursor: TailCursor = { offset: 0, partial: '' };
    let all: RoomEvent[] = [];
    const pump = () => { const d = drainRoom(roomId, cursor); cursor = d.cursor; if (d.reset) all = d.events.slice(); else all.push(...d.events); };

    // The orchestrator posts a task shortly AFTER the worker starts waiting.
    let wokeVia = '';
    let wakeElapsed = Infinity;
    try {
      // Prime (empty room) and enter the wait.
      pump();
      const board0 = foldTasks(all, Date.now());
      expect(pickNextTask(board0, worker.callsign)).toBeNull();

      const started = Date.now();
      let waitP = waker.wait();
      setTimeout(() => { postTask(roomId, actor('boss'), 'do the needful', null, 'x'); }, 25);
      // The directory watcher deliberately also sees metadata/lock activity. A
      // coalesced non-ledger event may therefore wake the real work loop before
      // the task append; drain it and re-arm exactly as production does.
      let next: ReturnType<typeof pickNextTask> = null;
      while (!next) {
        wokeVia = await waitP;
        pump();
        next = pickNextTask(foldTasks(all, Date.now()), worker.callsign);
        if (!next) waitP = waker.wait();
      }
      wakeElapsed = Date.now() - started;

      // Worker iteration: drain, pick, claim, dispatch(dry-run), result.
      const st: WorkState = { startedAtMs: Date.now(), tasksHandled: 0, joinSeq: 0 };
      expect(isRoomClosed(roomId)).toBe(false);
      expect(shouldStopWork(st, workCfg, all).stop).toBe(false);
      expect(next).not.toBeNull();
      expect(next!.status).toBe('open');

      const claim = claimTask(roomId, worker, next!.taskId, workCfg.leaseTtlMs, 'x');
      expect(claim.ok).toBe(true);
      pump();
      expect(foldTasks(all, Date.now()).find((t) => t.taskId === next!.taskId)!.status).toBe('claimed');

      // dry-run dispatch → done
      expect(postTaskResult(roomId, worker, next!.taskId, `(dry-run) ${worker.callsign} completed ${next!.taskId}`, true, 0, 'x').ok).toBe(true);
      pump();
      const done = foldTasks(all, Date.now()).find((t) => t.taskId === next!.taskId)!;
      expect(done.status).toBe('done');
      expect(done.result).toContain('completed');
    } finally {
      waker.close();
    }

    expect(wokeVia).toBe('event');            // fs.watch, not the watchdog
    expect(wakeElapsed).toBeLessThan(2000);   // far under the 5s watchdog
  });

  it('a second worker gets nothing while the first holds the only task (backpressure)', () => {
    const roomId = createRoom('bp-room').roomId;
    const id = postTask(roomId, actor('boss'), 'only task', null, 'x').task!.taskId;
    expect(claimTask(roomId, actor('w1'), id, 60_000, 'x').ok).toBe(true);
    // w2 drains and finds nothing workable (the sole task is actively claimed).
    let cursor: TailCursor = { offset: 0, partial: '' };
    const d = drainRoom(roomId, cursor);
    expect(pickNextTask(foldTasks(d.events, Date.now()), 'w2')).toBeNull();
  });

  it('a worker joining AFTER an old task-stop works the room instead of exiting (stale stop ignored)', () => {
    // Yesterday: orchestrator stopped that day's workers.
    const roomId = createRoom('restop-room').roomId;
    const worker = actor('w1');
    postTaskStop(roomId, actor('boss'), 'done for today', 'x');
    // Today: a new task is posted and a NEW worker session joins (join AFTER the stop).
    postTask(roomId, actor('boss'), 'fresh work', null, 'x');
    const joined = appendEvent(roomId, { kind: 'join', actor: worker, body: '', mentions: [], replyTo: null, repoHint: 'x', auto: true });
    const st: WorkState = { startedAtMs: Date.now(), tasksHandled: 0, joinSeq: joined.seq };
    const workCfg: WorkConfig = { callsign: worker.callsign, maxWallMs: 600_000, leaseTtlMs: 60_000, taskTimeoutMs: 600_000 };

    // One loop iteration, exactly as the CLI wires it: drain → stop-check → pick → claim → result.
    let cursor: TailCursor = { offset: 0, partial: '' };
    const all = drainRoom(roomId, cursor).events;
    expect(shouldStopWork(st, workCfg, all)).toMatchObject({ stop: false }); // stale stop ignored
    const next = pickNextTask(foldTasks(all, Date.now()), worker.callsign);
    expect(next).not.toBeNull();
    expect(claimTask(roomId, worker, next!.taskId, workCfg.leaseTtlMs, 'x').ok).toBe(true);
    expect(postTaskResult(roomId, worker, next!.taskId, 'did the fresh work', true, 0, 'x').ok).toBe(true);
    const board = foldTasks(drainRoom(roomId, { offset: 0, partial: '' }).events, Date.now());
    expect(board.find((t) => t.taskId === next!.taskId)).toMatchObject({ status: 'done', claimedBy: 'w1' });

    // And a NEW stop posted after this join DOES halt the session.
    postTaskStop(roomId, actor('boss'), 'stop again', 'x');
    const all2 = drainRoom(roomId, { offset: 0, partial: '' }).events;
    expect(shouldStopWork(st, workCfg, all2)).toMatchObject({ stop: true, reason: 'task-stop' });
  });
});
