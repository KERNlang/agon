import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import {
  computeRunPruneTargets,
  runsStore,
  RUN_SOFT_CAP,
  RUN_HARD_CAP,
  RUN_KEEP_AGE_MS,
  RUN_PROTECT_MIN_AGE_MS,
  PRUNE_STAMP_NAME,
} from '../../packages/cli/src/generated/signals/runs-store.js';

const DAY = 24 * 60 * 60 * 1000;

/** Create a runs dir + N run-record .json files with explicit ages (ms-old). */
function seedRuns(
  agonHome: string,
  specs: Array<{ name: string; ageMs: number }>,
): string {
  const runsDir = join(agonHome, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const now = Date.now();
  for (const { name, ageMs } of specs) {
    const fp = join(runsDir, name);
    writeFileSync(fp, '{}');
    const ts = new Date(now - ageMs);
    utimesSync(fp, ts, ts);
  }
  return runsDir;
}

describe('runs-store — prune policy (pure)', () => {
  const now = 1_000_000_000_000; // fixed clock

  function file(name: string, ageMs: number) {
    return { name, mtimeMs: now - ageMs };
  }

  it('keeps everything inside the 7-day age window even past the soft cap', () => {
    // SOFT_CAP+50 files, ALL younger than 7 days → nothing deletable for the
    // soft cap (young files are kept regardless), and total < HARD_CAP.
    const files = Array.from({ length: RUN_SOFT_CAP + 50 }, (_, i) =>
      file(`r-${i}.json`, (i + 1) * 1000), // 1s..(N)s old, all < 7d
    );
    const targets = computeRunPruneTargets(files, now, []);
    expect(targets).toEqual([]);
  });

  it('honors the soft cap by deleting oldest files older than 7 days', () => {
    // 100 fresh (< 7d) + (SOFT_CAP) old (> 7d). Total = SOFT_CAP + 100, so
    // soft overflow = 100, all removable from the OLD set, oldest first.
    const fresh = Array.from({ length: 100 }, (_, i) =>
      file(`fresh-${i}.json`, (i + 1) * 1000),
    );
    const old = Array.from({ length: RUN_SOFT_CAP }, (_, i) =>
      file(`old-${i}.json`, RUN_KEEP_AGE_MS + (i + 1) * DAY), // strictly > 7d, increasing age
    );
    const files = [...fresh, ...old];
    const targets = computeRunPruneTargets(files, now, []);

    expect(targets).toHaveLength(100);
    // All deleted are from the OLD set (never the fresh ones)...
    expect(targets.every((n) => n.startsWith('old-'))).toBe(true);
    // ...and oldest-first: old-1999 (oldest) comes before old-1900.
    expect(targets[0]).toBe(`old-${RUN_SOFT_CAP - 1}.json`);
  });

  it('enforces the hard cap even when all files are inside the age window', () => {
    // HARD_CAP + 25 files, all young (< 7d). Soft cap can't touch young files,
    // but the HARD cap must still trim 25 oldest.
    const files = Array.from({ length: RUN_HARD_CAP + 25 }, (_, i) =>
      file(`h-${i}.json`, (i + 1) * 1000), // h-0 newest ... h-N oldest
    );
    const targets = computeRunPruneTargets(files, now, []);
    expect(targets).toHaveLength(25);
    // The oldest 25 (largest age) are h-(HARD_CAP+24) .. h-HARD_CAP.
    expect(targets).toContain(`h-${RUN_HARD_CAP + 24}.json`);
    expect(targets).not.toContain('h-0.json');
  });

  it('never deletes files younger than the protect window (mtime < 60s)', () => {
    // Way over hard cap, but EVERY file is younger than 60s → nothing deletable.
    const files = Array.from({ length: RUN_HARD_CAP + 100 }, (_, i) =>
      file(`young-${i}.json`, Math.floor(RUN_PROTECT_MIN_AGE_MS / 2)), // ~30s old
    );
    const targets = computeRunPruneTargets(files, now, []);
    expect(targets).toEqual([]);
  });

  it('never deletes the active session run files', () => {
    // Over the hard cap, all old — but the active id is protected.
    const files = Array.from({ length: RUN_HARD_CAP + 10 }, (_, i) =>
      file(`run-${i}.json`, RUN_KEEP_AGE_MS + (i + 1) * DAY),
    );
    // Mark the OLDEST 5 as active (they'd otherwise be deleted first).
    const activeIds = [
      `run-${RUN_HARD_CAP + 9}`,
      `run-${RUN_HARD_CAP + 8}`,
      `run-${RUN_HARD_CAP + 7}`,
    ];
    const targets = computeRunPruneTargets(files, now, activeIds);
    for (const id of activeIds) {
      // `${id}.json` is the active file and must survive.
      expect(targets).not.toContain(`${id}.json`);
    }
  });

  it('protects active runs by EXACT id match, not substring', () => {
    // The active id is "run-1". With the old substring rule, "run-1" would also
    // shield "run-10.json", "run-123.json", "xrun-1.json" — over-protection.
    // Exact match must protect ONLY "run-1.json" (and a delimiter-suffixed
    // "run-1-*.json"); the substring-only files stay eligible for deletion.
    //
    // Make the five interesting files the OLDEST in the set (so they are the
    // first the oldest-first soft cap removes UNLESS protected), then pad with
    // NEWER old files to push the total past the soft cap so a prune actually
    // happens.
    const interesting = [
      file('run-1.json', RUN_KEEP_AGE_MS + 1000 * DAY), // exact → protected (oldest)
      file('run-1-meta.json', RUN_KEEP_AGE_MS + 999 * DAY), // delimiter suffix → protected
      file('run-10.json', RUN_KEEP_AGE_MS + 998 * DAY), // substring-only → deletable
      file('run-123.json', RUN_KEEP_AGE_MS + 997 * DAY), // substring-only → deletable
      file('xrun-1.json', RUN_KEEP_AGE_MS + 996 * DAY), // id mid-name → deletable
    ];
    // NEWER old padding (all < 500 days past the window, i.e. younger than the
    // 996–1000-day interesting files) so total > SOFT_CAP and the oldest-first
    // soft cap reaches the interesting files first.
    const padding = Array.from({ length: RUN_SOFT_CAP }, (_, i) =>
      file(`pad-${i}.json`, RUN_KEEP_AGE_MS + ((i % 400) + 1) * DAY),
    );
    const targets = computeRunPruneTargets([...interesting, ...padding], now, ['run-1']);

    // Exact + delimiter-suffix matches are protected (never deleted).
    expect(targets).not.toContain('run-1.json');
    expect(targets).not.toContain('run-1-meta.json');
    // Pure substring matches are NOT protected — being the oldest deletable, they
    // are among the soft-cap removals.
    expect(targets).toContain('run-10.json');
    expect(targets).toContain('run-123.json');
    expect(targets).toContain('xrun-1.json');
  });
});

describe('runs-store — maybePrune (fs)', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('runs-store-prune');
  });

  afterEach(() => {
    cleanupTestAgonHome(testHome);
    rmSync(testHome, { recursive: true, force: true });
  });

  it('deletes old overflow files and writes a stamp', async () => {
    // SOFT_CAP + 5 OLD (> 7d) files → the soft cap keeps the newest SOFT_CAP,
    // deleting the 5 oldest.
    const specs = Array.from({ length: RUN_SOFT_CAP + 5 }, (_, i) => ({
      name: `run-${String(i).padStart(5, '0')}.json`,
      ageMs: RUN_KEEP_AGE_MS + (i + 1) * DAY, // run-00000 newest of the old, increasing age
    }));
    const runsDir = seedRuns(testHome, specs);

    const result = await runsStore.maybePrune({ force: true });

    expect(result.skipped).toBe(false);
    expect(result.deleted).toBe(5);
    // The 5 oldest (highest index) are gone; the newest survive.
    expect(existsSync(join(runsDir, `run-${String(RUN_SOFT_CAP + 4).padStart(5, '0')}.json`))).toBe(false);
    expect(existsSync(join(runsDir, 'run-00000.json'))).toBe(true);
    // A stamp was written.
    expect(existsSync(join(runsDir, PRUNE_STAMP_NAME))).toBe(true);
    // The cached snapshot reflects the post-prune count.
    expect(runsStore.snapshot().count).toBe(RUN_SOFT_CAP);
  });

  it('skips a second prune within the 1h cooldown (stamp gate)', async () => {
    const specs = Array.from({ length: RUN_SOFT_CAP + 5 }, (_, i) => ({
      name: `c-${String(i).padStart(5, '0')}.json`,
      ageMs: RUN_KEEP_AGE_MS + (i + 1) * DAY,
    }));
    seedRuns(testHome, specs);

    const first = await runsStore.maybePrune({ force: true });
    expect(first.deleted).toBe(5);

    // A non-forced prune immediately after must be skipped by the cooldown.
    const second = await runsStore.maybePrune();
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('cooldown');
    expect(second.deleted).toBe(0);
  });

  it('is a no-op (within-policy) when nothing exceeds the caps', async () => {
    seedRuns(testHome, [
      { name: 'a.json', ageMs: 2 * DAY },
      { name: 'b.json', ageMs: 9 * DAY }, // old but well under the soft cap
    ]);
    const result = await runsStore.maybePrune({ force: true });
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('within-policy');
  });

  it('serializes overlapping in-process prunes — only one runs', async () => {
    // SOFT_CAP + 5 OLD files so a real prune (deleted=5) is on the table.
    const specs = Array.from({ length: RUN_SOFT_CAP + 5 }, (_, i) => ({
      name: `g-${String(i).padStart(5, '0')}.json`,
      ageMs: RUN_KEEP_AGE_MS + (i + 1) * DAY,
    }));
    seedRuns(testHome, specs);

    // Fire two forced prunes WITHOUT awaiting the first — the in-process guard
    // (set at method entry, before the await on the async fs scan) must make
    // exactly one do the work and the other bail with 'in-progress'.
    const [a, b] = await Promise.all([
      runsStore.maybePrune({ force: true }),
      runsStore.maybePrune({ force: true }),
    ]);

    const reasons = [a.reason, b.reason].sort();
    expect(reasons).toEqual(['in-progress', 'pruned']);
    const worker = a.reason === 'pruned' ? a : b;
    const blocked = a.reason === 'pruned' ? b : a;
    expect(worker.deleted).toBe(5);
    expect(worker.skipped).toBe(false);
    expect(blocked.deleted).toBe(0);
    expect(blocked.skipped).toBe(true);
  });
});

describe('runs-store — snapshot accessor is fs-free', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('runs-store-snapshot');
  });

  afterEach(() => {
    cleanupTestAgonHome(testHome);
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns the cached count without touching the fs after hydrate', async () => {
    const runsDir = seedRuns(testHome, [
      { name: 'one.json', ageMs: DAY },
      { name: 'two.json', ageMs: DAY },
      { name: 'three.json', ageMs: DAY },
    ]);

    const snap = await runsStore.hydrate();
    expect(snap.count).toBe(3);
    expect(snap.hydratedAt).toBeGreaterThan(0);

    // Remove the entire runs dir — snapshot() must still return the cached
    // value without throwing or re-scanning.
    rmSync(runsDir, { recursive: true, force: true });
    expect(existsSync(runsDir)).toBe(false);

    const cached = runsStore.snapshot();
    expect(cached.count).toBe(3);
    expect(runsStore.runCount()).toBe(3);
  });
});
