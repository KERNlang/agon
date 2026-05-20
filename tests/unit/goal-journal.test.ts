import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createJournal, addTasks, nextTask, markStatus, recordAttempt,
  remainingCount, isDone, logEvent, saveJournal, loadJournal, journalPath,
} from '../../packages/forge/src/generated/goal/journal.js';
import type { GoalSpec } from '../../packages/forge/src/generated/goal/types.js';

const spec = (): GoalSpec => ({
  goalId: 'g-test',
  intent: 'close all gaps',
  branch: 'goal/test',
  gate: 'npm test',
  queueSource: '.kern-gaps/',
  maxAttempts: 3,
  budgetUsd: 50,
  maxHours: 8,
  supervised: true,
});

describe('goal journal — pure transforms', () => {
  it('creates a journal with a created event and zeroed counters', () => {
    const j = createJournal(spec());
    expect(j.tasks).toEqual([]);
    expect(j.spentUsd).toBe(0);
    expect(j.parkedStreak).toBe(0);
    expect(j.events).toHaveLength(1);
    expect(j.events[0].kind).toBe('created');
  });

  it('addTasks appends queued tasks and dedupes by id (idempotent on resume)', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'gap-a' }, { id: 'b', source: 'gap-b' }]);
    expect(j.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(j.tasks.every((t) => t.status === 'queued')).toBe(true);
    // re-adding 'a' is a no-op; only 'c' is appended
    const before = j;
    j = addTasks(j, [{ id: 'a', source: 'gap-a' }, { id: 'c', source: 'gap-c' }]);
    expect(j.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    // adding only known ids returns the same reference
    expect(addTasks(before, [{ id: 'a', source: 'x' }])).toBe(before);
  });

  it('nextTask returns the first runnable queued task and respects dependsOn', () => {
    let j = createJournal(spec());
    j = addTasks(j, [
      { id: 'a', source: 'gap-a' },
      { id: 'b', source: 'gap-b', dependsOn: ['a'] },
    ]);
    expect(nextTask(j)!.id).toBe('a');
    // b is blocked until a is done
    j = markStatus(j, 'a', 'inflight');
    expect(nextTask(j)).toBeNull(); // a no longer queued, b blocked
    j = markStatus(j, 'a', 'done');
    expect(nextTask(j)!.id).toBe('b');
  });

  it('markStatus patches fields and is a no-op for unknown ids', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'gap-a' }]);
    j = markStatus(j, 'a', 'done', { commitSha: 'deadbeef' });
    expect(j.tasks[0].status).toBe('done');
    expect(j.tasks[0].commitSha).toBe('deadbeef');
    expect(markStatus(j, 'nope', 'parked').tasks).toEqual(j.tasks);
  });

  it('recordAttempt bumps attempts and appends to the log', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'gap-a' }]);
    j = recordAttempt(j, 'a', { at: 1, outcome: 'gate-fail', gateFailureSignature: 'sig1' });
    j = recordAttempt(j, 'a', { at: 2, outcome: 'mutation-survived', mutantsSurvived: 2 });
    expect(j.tasks[0].attempts).toBe(2);
    expect(j.tasks[0].attemptLog.map((a) => a.outcome)).toEqual(['gate-fail', 'mutation-survived']);
  });

  it('remainingCount / isDone reflect queued + inflight', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'a' }, { id: 'b', source: 'b' }]);
    expect(remainingCount(j)).toBe(2);
    expect(isDone(j)).toBe(false);
    j = markStatus(j, 'a', 'done');
    j = markStatus(j, 'b', 'parked');
    expect(remainingCount(j)).toBe(0);
    expect(isDone(j)).toBe(true);
  });

  it('logEvent appends an audit entry', () => {
    let j = createJournal(spec());
    j = logEvent(j, 'gate-pass', 'a', 'ok');
    expect(j.events.at(-1)).toMatchObject({ kind: 'gate-pass', taskId: 'a', detail: 'ok' });
  });
});

describe('goal journal — persistence (sandboxed AGON_HOME)', () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.AGON_HOME;
    home = mkdtempSync(join(tmpdir(), 'agon-goal-'));
    process.env.AGON_HOME = home;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  it('save then load round-trips the journal', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'gap-a' }]);
    j = markStatus(j, 'a', 'done', { commitSha: 'abc' });
    saveJournal(j);
    expect(existsSync(journalPath('g-test'))).toBe(true);
    const loaded = loadJournal('g-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.tasks[0]).toMatchObject({ id: 'a', status: 'done', commitSha: 'abc' });
  });

  it('loadJournal returns null for an unknown goal', () => {
    expect(loadJournal('does-not-exist')).toBeNull();
  });
});
