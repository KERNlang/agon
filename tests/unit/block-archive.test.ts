import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendBlockWithCap, archiveBlocks } from '../../packages/cli/src/generated/signals/block-archive.js';

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
