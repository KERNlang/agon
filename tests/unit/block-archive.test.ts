import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendBlockWithCap, archiveBlocks, nextStaticEpoch } from '../../packages/cli/src/generated/signals/block-archive.js';

const makeBlock = (id: number) => ({ id, event: { type: 'info', message: `msg-${id}` } as any });

describe('block-archive', () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agon-block-archive-'));
    path = join(tmp, 'transcript.ndjson');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('archiveBlocks writes NDJSON and appends on repeat calls', () => {
    archiveBlocks(path, [makeBlock(1), makeBlock(2)]);
    archiveBlocks(path, [makeBlock(3)]);
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe(1);
    expect(JSON.parse(lines[2]).id).toBe(3);
  });

  it('archiveBlocks is a no-op on empty input', () => {
    archiveBlocks(path, []);
    expect(() => readFileSync(path)).toThrow();
  });

  it('appendBlockWithCap returns prev+block unchanged while under the cap', () => {
    const prev = Array.from({ length: 10 }, (_, i) => makeBlock(i));
    const next = appendBlockWithCap(prev, makeBlock(999), path);
    expect(next).toHaveLength(11);
    expect(next[10].id).toBe(999);
    expect(() => readFileSync(path)).toThrow(); // nothing archived
  });

  it('appendBlockWithCap spills the oldest batch once the live buffer exceeds MAX_LIVE_BLOCKS', () => {
    // MAX_LIVE_BLOCKS=500, ARCHIVE_BATCH=100. Fill to 500, then append one more.
    let state = Array.from({ length: 500 }, (_, i) => makeBlock(i));
    state = appendBlockWithCap(state, makeBlock(500), path);

    // Overflow = 501 - 500 + 100 = 101 oldest blocks spilled, 400 remain live.
    expect(state).toHaveLength(400);
    expect(state[0].id).toBe(101);
    expect(state[state.length - 1].id).toBe(500);

    const archived = readFileSync(path, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(archived).toHaveLength(101);
    expect(archived[0].id).toBe(0);
    expect(archived[100].id).toBe(100);
  });
});

describe('nextStaticEpoch — <Static> remount epoch', () => {
  it('a spill-shaped shrink does NOT change the epoch (no Static remount)', () => {
    // A cap-spill front-slices outputBlocks (e.g. 500 → 400). Ink's <Static> is
    // append-only, so the shrink renders nothing new and must NOT remount.
    expect(nextStaticEpoch(7, 'spill')).toBe(7);

    // Drive a real spill through appendBlockWithCap and confirm the epoch stays put
    // even though the array length shrank from 500 to 400.
    const tmpDir = mkdtempSync(join(tmpdir(), 'agon-epoch-spill-'));
    const spillPath = join(tmpDir, 'transcript.ndjson');
    try {
      let state = Array.from({ length: 500 }, (_, i) => makeBlock(i));
      const before = state.length;
      let epoch = 3;
      state = appendBlockWithCap(state, makeBlock(500), spillPath);
      expect(state.length).toBeLessThan(before); // 400 — the array shrank
      epoch = nextStaticEpoch(epoch, 'spill');
      expect(epoch).toBe(3); // ...but the remount epoch is untouched
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('an append never changes the epoch', () => {
    expect(nextStaticEpoch(2, 'append')).toBe(2);
  });

  it('a /clear-shaped reset bumps the epoch exactly once', () => {
    expect(nextStaticEpoch(0, 'reset')).toBe(1);
    // Two distinct /clear resets advance it by exactly one each.
    let epoch = 0;
    epoch = nextStaticEpoch(epoch, 'reset');
    epoch = nextStaticEpoch(epoch, 'reset');
    expect(epoch).toBe(2);
  });

  it('a session reset (same clearBlocks funnel) bumps the epoch', () => {
    // /clear, /clean, and session reset all dispatch OutputEvent {type:'clear'} →
    // clearBlocks → cause 'reset'. A reset after appends/spills still bumps once.
    let epoch = 5;
    epoch = nextStaticEpoch(epoch, 'append');
    epoch = nextStaticEpoch(epoch, 'spill');
    expect(epoch).toBe(5); // appends + spills left it alone
    epoch = nextStaticEpoch(epoch, 'reset');
    expect(epoch).toBe(6); // the session reset bumps it
  });
});
