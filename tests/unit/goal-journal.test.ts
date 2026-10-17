import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createJournal, addTasks, requeueInflightTasks, nextTask, markStatus, recordAttempt,
  remainingCount, isDone, logEvent, boundEvents, saveJournal, loadJournal, journalPath,
} from '../../packages/forge/src/goal/journal.js';
import { pushRecentOutcome, globalBreaker } from '../../packages/forge/src/goal/policy.js';
import type { GoalSpec } from '../../packages/forge/src/goal/types.js';
import * as physicalGoal from '@kernlang/agon-mod-goal';
import * as legacyJournal from '../../packages/forge/src/goal/journal.js';
import { summarizeGoal, writeGoalArtifacts } from '../../packages/forge/src/goal/controller.js';

it('keeps all journal transforms in the physical Goal owner', () => {
  expect(summarizeGoal).toBe(physicalGoal.summarizeGoal);
  for (const name of ['createJournal', 'addTasks', 'requeueInflightTasks', 'nextTask',
    'markStatus', 'recordAttempt', 'remainingCount', 'isDone', 'logEvent', 'boundEvents', 'GOAL_EVENT_CAP'] as const) {
    expect(physicalGoal).toHaveProperty(name, legacyJournal[name]);
  }
});

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
  it('preserves the historical human summary for mixed task states', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(600_000);
    try {
      let j = addTasks(createJournal(spec()), ['done', 'inflight', 'parked', 'failed', 'queued'].map(id => ({ id, source: `source-${id}` })));
      for (const task of j.tasks) j = markStatus(j, task.id, task.id as typeof task.status);
      j = markStatus(j, 'done', 'done', { commitSha: '123456789abcdef' });
      j = markStatus(j, 'parked', 'parked', { notes: 'needs decision', lastError: 'older failure' });
      Object.assign(j, { startedAt: 60_000, heartbeatAt: 540_000, spentUsd: 1.234 });
      const before = structuredClone(j);
      expect(summarizeGoal(j)).toBe([
        '# Goal g-test — running', '', 'Intent: close all gaps', 'Branch: goal/test',
        'Tasks: 1 done · 1 in progress · 1 parked · 1 failed · 1 remaining',
        'Spend: $1.23 / $50 · 9m elapsed', '', '## In progress',
        '- ▶ implementing inflight — source-inflight (updated 1m ago)', '',
        '## Closed', '- done — source-done (12345678)', '',
        '## Parked (needs a human)', '- parked — needs decision',
      ].join('\n'));
      expect(j).toEqual(before);
    } finally { clock.mockRestore(); }
  });

  it.each(['queued', 'inflight', 'done', 'parked', 'failed'] as const)('preserves summary phase and absent timestamp behavior for %s', status => {
    let j = addTasks(createJournal(spec()), [{ id: 'a', source: 'gap-a' }]);
    j = markStatus(j, 'a', status);
    const summary = summarizeGoal(j);
    expect(summary.split('\n')[0]).toBe(`# Goal g-test — ${status === 'queued' ? 'stopped' : status === 'inflight' ? 'running' : 'complete'}`);
    expect(summary).toContain('0m elapsed');
    expect(summary).not.toContain('updated');
    if (status === 'parked') {
      expect(summary).toContain('- a — parked');
      expect(summarizeGoal(markStatus(j, 'a', 'parked', { lastError: 'last failure' }))).toContain('- a — last failure');
    }
  });

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

  it('addTasks carries a per-task verify command and dedupes keep the original', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'gap-a', verify: 'node check.mjs' }, { id: 'b', source: 'gap-b' }]);
    expect(j.tasks[0].verify).toBe('node check.mjs');
    expect(j.tasks[1].verify).toBeUndefined();
    // re-adding 'a' with a DIFFERENT verify is a no-op — a resumed task keeps its frozen original.
    j = addTasks(j, [{ id: 'a', source: 'gap-a', verify: 'echo weakened' }]);
    expect(j.tasks[0].verify).toBe('node check.mjs');
  });

  it('requeueInflightTasks resets orphaned inflight tasks to queued (resume safety)', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'a' }, { id: 'b', source: 'b' }, { id: 'c', source: 'c' }]);
    j = markStatus(j, 'a', 'done', { commitSha: 'sha-a' });
    j = markStatus(j, 'b', 'inflight'); // interrupted mid-attempt (the bug: silently skipped on resume)
    // c stays queued. Before requeue, nextTask skips the orphaned inflight 'b' and hands back 'c'.
    expect(nextTask(j)!.id).toBe('c');

    const { state: req, count } = requeueInflightTasks(j);
    expect(count).toBe(1);
    expect(req.tasks.find((t) => t.id === 'b')!.status).toBe('queued');
    expect(req.tasks.find((t) => t.id === 'a')!.status).toBe('done'); // terminal states untouched
    // 'b' now re-enters the queue ahead of 'c' (declared order), so it is no longer dropped.
    expect(nextTask(req)!.id).toBe('b');
  });

  it('requeueInflightTasks is a no-op (same reference) when nothing is inflight', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'a', source: 'a' }]);
    j = markStatus(j, 'a', 'done');
    const { state: req, count } = requeueInflightTasks(j);
    expect(count).toBe(0);
    expect(req).toBe(j);
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

  it('treats a dependsOn referencing an unknown id as permanently blocked', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'z', source: 'z', dependsOn: ['nonexistent'] }]);
    expect(nextTask(j)).toBeNull();
  });

  it('treats an empty dependsOn array as immediately runnable', () => {
    let j = createJournal(spec());
    j = addTasks(j, [{ id: 'x', source: 'x', dependsOn: [] }]);
    expect(nextTask(j)!.id).toBe('x');
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

  it('records an already-counted attempt without counting it twice', () => {
    const original = { tasks: [{ id: 'a', attempts: 2, retained: 'state' }] };
    const recorded = recordAttempt(original, 'a', { at: 1, outcome: 'gate-fail', error: 'broken' }, 2);
    expect(recorded.tasks[0]).toMatchObject({ attempts: 2, retained: 'state',
      attemptLog: [{ at: 1, attempt: 2, outcome: 'gate-fail', error: 'broken' }] });
    expect(original.tasks[0]).toEqual({ id: 'a', attempts: 2, retained: 'state' });
    expect(() => recordAttempt(original, 'a', { at: 1, outcome: 'error' }, 1)).toThrow('backwards');
    expect(() => recordAttempt(original, 'a', { at: 1, outcome: 'error' }, Number.NaN)).toThrow('positive integer');
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

describe('boundEvents — bounded audit trail', () => {
  const ev = (i: number) => ({ ts: i, kind: `e${i}` });
  it('returns events unchanged (same ref) when within the cap', () => {
    const events = [ev(1), ev(2)];
    const r = boundEvents(events, 500);
    expect(r.dropped).toBe(0);
    expect(r.events).toBe(events);
  });
  it('drops the oldest beyond the cap and reports the dropped count', () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(i));
    const r = boundEvents(events, 10);
    expect(r.dropped).toBe(2);
    expect(r.events.length).toBe(10);
    expect(r.events[0].kind).toBe('e2');  // oldest two (e0, e1) dropped
    expect(r.events[9].kind).toBe('e11'); // most recent kept
  });
  it('returns events unchanged at the exact boundary (length === cap)', () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(i));
    const r = boundEvents(events, 10);
    expect(r.dropped).toBe(0);
    expect(r.events).toBe(events); // <= cap keeps the same reference, no copy
  });
  it('cap <= 0 means unbounded', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev(i));
    expect(boundEvents(events, 0).dropped).toBe(0);
    expect(boundEvents(events, 0).events).toBe(events);
    expect(boundEvents(events, -1).events.length).toBe(5);
    expect(boundEvents(events, -1).dropped).toBe(0);
  });
});

describe('logEvent — bounded append (24h journal stays O(1) in events)', () => {
  it('appends within the cap without dropping', () => {
    let j = createJournal(spec()); // starts with 1 'created' event
    j = logEvent(j, 'task-done', 'a');
    expect(j.events.at(-1)).toMatchObject({ kind: 'task-done', taskId: 'a' });
    expect(j.droppedEvents ?? 0).toBe(0);
  });
  it('keeps events[] bounded at 500 and accumulates droppedEvents over a long run', () => {
    let j = createJournal(spec()); // 1 event
    for (let i = 0; i < 600; i += 1) j = logEvent(j, 'tick', undefined, String(i));
    expect(j.events.length).toBe(500);
    // 1 created + 600 ticks = 601 total; kept 500 -> 101 dropped
    expect(j.droppedEvents).toBe(101);
    expect(j.events.at(-1)).toMatchObject({ kind: 'tick', detail: '599' }); // most recent retained
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
    vi.restoreAllMocks();
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

  it('shares persisted bytes with the physical store without an ambient home dependency', () => {
    const store = physicalGoal.createGoalJournalStore({
      path: (...parts) => join(home, ...parts),
      ensureHome: () => { mkdirSync(home, { recursive: true }); },
    });
    const j = addTasks(createJournal(spec()), [{ id: 'a', source: 'gap-a', verify: 'node check.mjs' }]);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(101);
    saveJournal(j);
    expect(j.heartbeatAt).toBe(101);
    expect(store.loadJournal('g-test')).toEqual(j);
    expect(store.journalPath('g-test')).toBe(journalPath('g-test'));
    expect(store.goalDir('g-test')).toBe(join(home, 'goals', 'g-test'));
    j.spentUsd = 2;
    clock.mockReturnValue(202);
    const originalHome = process.env.AGON_HOME;
    try {
      process.env.AGON_HOME = join(home, 'wrong-home');
      store.saveJournal(j);
      expect(existsSync(join(home, 'wrong-home'))).toBe(false);
    } finally { process.env.AGON_HOME = originalHome; }
    expect(loadJournal('g-test')).toEqual(j);
    expect(j.heartbeatAt).toBe(202);
    expect(readFileSync(journalPath('g-test'), 'utf8')).toBe(JSON.stringify(j, null, 2));
    expect(existsSync(journalPath('g-test') + '.tmp')).toBe(false);
    writeFileSync(journalPath('g-test'), '{broken');
    expect(store.loadJournal('g-test')).toBeNull();
    expect(loadJournal('g-test')).toBeNull();
    expect(store.loadJournal('missing')).toBeNull();
    expect(() => store.saveJournal(createJournal({ ...spec(), goalId: '../escape' }))).toThrow('Invalid goalId');
    expect(() => store.loadJournal('../escape')).toThrow('Invalid goalId');
  });

  it('propagates host and write failures without replacing a saved journal', () => {
    const failure = new Error('host unavailable');
    const blocked = physicalGoal.createGoalJournalStore({
      path: (...parts) => join(home, ...parts),
      ensureHome: () => { throw failure; },
    });
    expect(() => blocked.saveJournal(createJournal(spec()))).toThrow(failure);
    expect(existsSync(join(home, 'goals'))).toBe(false);
    const store = physicalGoal.createGoalJournalStore({
      path: (...parts) => join(home, ...parts),
      ensureHome: () => { mkdirSync(home, { recursive: true }); },
    });
    const j = createJournal(spec());
    store.saveJournal(j);
    const bytes = readFileSync(store.journalPath('g-test'), 'utf8');
    mkdirSync(store.journalPath('g-test') + '.tmp');
    j.spentUsd = 3;
    expect(() => store.saveJournal(j)).toThrow();
    expect(readFileSync(store.journalPath('g-test'), 'utf8')).toBe(bytes);
    expect(store.loadJournal('g-test')?.spentUsd).toBe(0);
  });

  it('persists the recentOutcomes breaker ring across save/load and feeds the window on resume', () => {
    // Simulate the controller accumulating terminal outcomes across tasks
    // (1 done then 7 parked — a hard cluster behind one success).
    let ring: string[] = [];
    for (const o of ['done', 'parked', 'parked', 'parked', 'parked', 'parked', 'parked', 'parked']) {
      ring = pushRecentOutcome(ring, o, 50);
    }
    expect(ring.length).toBe(8);
    let j = createJournal(spec());
    j = { ...j, recentOutcomes: ring };
    saveJournal(j);
    const loaded = loadJournal('g-test');
    expect(loaded).not.toBeNull();
    // The ring survives the JSON round-trip — a resumed run sees its breaker state.
    expect(loaded!.recentOutcomes).toEqual(ring);
    // And the resumed ring drives the window: 1 done / 8 = 0.125, not < 0.125 -> keep going.
    expect(globalBreaker(loaded!, 0, 0, { size: 8, minSuccessRate: 0.125 }).stop).toBe(false);
    // Slide the lone success out of the window -> 0/8 -> abort on resume.
    const allParked = { ...loaded!, recentOutcomes: Array(8).fill('parked') };
    expect(globalBreaker(allParked, 0, 0, { size: 8, minSuccessRate: 0.125 }).stop).toBe(true);
  });

  it('loadJournal returns null for an unknown goal', () => {
    expect(loadJournal('does-not-exist')).toBeNull();
  });

  it.each([undefined, 0, 60_000])('preserves raw result bytes and envelope metadata (startedAt=%s)', startedAt => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(600_000);
    try {
      let j = addTasks(createJournal(spec()), [{ id: 'a', source: 'gap-a' }, { id: 'b', source: 'gap-b' }]);
      j = markStatus(j, 'a', 'done', { commitSha: 'abc', attempts: 2 });
      j.spentUsd = 2.5;
      const completed = startedAt !== undefined;
      if (completed) {
        j = markStatus(j, 'b', 'done');
        j.startedAt = startedAt;
        j.oracleHash = 'frozen-oracle-hash';
      }
      const expected = { goalId: 'g-test', intent: 'close all gaps', branch: 'goal/test', done: completed,
        remaining: completed ? 0 : 1, spentUsd: 2.5, oracleHash: completed ? 'frozen-oracle-hash' : null,
        startedAt: startedAt ?? null, endedAt: 600_000,
        tasks: [{ id: 'a', status: 'done', attempts: 2, commitSha: 'abc' }, { id: 'b', status: completed ? 'done' : 'queued', attempts: 0, commitSha: null }] };
      const paths = writeGoalArtifacts(j);
      expect(paths).toEqual({ resultPath: join(home, 'goals/g-test/result.json'), summaryPath: join(home, 'goals/g-test/summary.md') });
      expect(readFileSync(paths.resultPath, 'utf8')).toBe(JSON.stringify(expected, null, 2));
      expect(physicalGoal.createGoalResult(j)).toEqual(expected);
      expect(readFileSync(paths.summaryPath, 'utf8')).toBe(summarizeGoal(j));
      const envelope = JSON.parse(readFileSync(join(home, 'goals/g-test/result-envelope.json'), 'utf8'));
      expect(envelope.payload).toEqual(expected);
      expect(envelope).toMatchObject({ kind: 'result', status: completed ? 'succeeded' : 'partial',
        ownerModId: 'agon.goal', ownerModVersion: '1.0.0', contributionId: 'agon.goal.persisted-result', payloadVersion: '1.0.0' });
      if (startedAt) expect(envelope.createdAt).toBe('1970-01-01T00:01:00.000Z');
      if (startedAt === 0) expect(summarizeGoal(j)).toContain('0m elapsed');
      expect(existsSync(join(home, 'goals/g-test/result-envelope.json.tmp'))).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it('saveJournal rejects a goalId that would traverse the filesystem', () => {
    const j = createJournal({ ...spec(), goalId: '../escape' });
    expect(() => saveJournal(j)).toThrow();
  });
});
