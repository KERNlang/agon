import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  archiveCountAfterPrefixDrop,
  padStaticFeed,
  effectiveNativeArchiveBlockCount,
  nativeArchiveBlockCount,
} from '../../packages/cli/src/surfaces/app-blocks.js';
import { appendBlockWithCap, transcriptDroppedTotal, resetTranscriptDroppedTotal } from '../../packages/cli/src/signals/block-archive.js';
import type { OutputBlock } from '../../packages/cli/src/blocks/engine.js';

/**
 * Model of Ink's <Static>: it prints `items.slice(index)` and then advances
 * `index` to `items.length` (see node_modules/ink/build/components/Static.js).
 */
function makeStaticCursor() {
  let index = 0;
  const printed: number[] = [];
  return {
    feed(items: (OutputBlock | null)[]) {
      for (const item of items.slice(index)) if (item) printed.push(item.id);
      index = items.length;
    },
    get printed() { return printed; },
  };
}

/** Drive a long transcript past the 500-block cap and record what <Static> printed. */
function runTranscript(opts: { pad: boolean; carryArchiveCount: boolean }): number[] {
  const dir = mkdtempSync(join(tmpdir(), 'agon-static-feed-'));
  const archivePath = join(dir, 'transcript.ndjson');
  try {
    resetTranscriptDroppedTotal();
    const cursor = makeStaticCursor();
    let blocks: OutputBlock[] = [];
    let archiveCount = 0;
    let seenDropped = 0;

    for (let id = 0; id < 900; id += 1) {
      blocks = appendBlockWithCap(blocks, { id, event: { type: 'info', message: `m${id}` } as any }, archivePath);
      const droppedTotal = transcriptDroppedTotal();
      const droppedNow = droppedTotal - seenDropped;
      const base = opts.carryArchiveCount
        ? archiveCountAfterPrefixDrop(archiveCount, droppedNow)
        : (droppedNow > 0 ? 0 : archiveCount);
      const target = nativeArchiveBlockCount(blocks, 'chat', 30, false, false);
      const effective = effectiveNativeArchiveBlockCount(blocks, base, target, false);
      const archived = blocks.slice(0, effective);
      cursor.feed(opts.pad ? padStaticFeed(archived, droppedTotal) : archived);
      seenDropped = droppedTotal;
      archiveCount = effective;
    }
    return cursor.printed;
  } finally {
    resetTranscriptDroppedTotal();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('archiveCountAfterPrefixDrop', () => {
  it('leaves the archive count alone when nothing was dropped', () => {
    expect(archiveCountAfterPrefixDrop(494, 0)).toBe(494);
    expect(archiveCountAfterPrefixDrop(494, -3)).toBe(494);
  });

  it('slides the sealed/live boundary down by exactly the dropped prefix', () => {
    expect(archiveCountAfterPrefixDrop(494, 101)).toBe(393);
  });

  it('never goes negative', () => {
    expect(archiveCountAfterPrefixDrop(5, 40)).toBe(0);
  });
});

describe('padStaticFeed', () => {
  const blocks = [1, 2, 3].map((id) => ({ id, event: { type: 'info', message: `m${id}` } })) as OutputBlock[];

  it('is identity when no prefix was dropped', () => {
    expect(padStaticFeed(blocks, 0)).toBe(blocks);
    expect(padStaticFeed(blocks, -2)).toBe(blocks);
  });

  it('holds one index slot per dropped block, ahead of the live archive', () => {
    const padded = padStaticFeed(blocks, 2);
    expect(padded).toHaveLength(5);
    expect(padded.slice(0, 2)).toEqual([null, null]);
    expect(padded.slice(2)).toEqual(blocks);
  });
});

describe('<Static> transcript feed across a cap-spill', () => {
  it('prints every completed block exactly once, in order', () => {
    const printed = runTranscript({ pad: true, carryArchiveCount: true });

    expect(new Set(printed).size).toBe(printed.length);
    // A contiguous ascending prefix: nothing swallowed, nothing reordered.
    expect(printed).toEqual(printed.map((_, index) => index));
    expect(printed.length).toBeGreaterThan(700);
  });

  it('regression: an unpadded feed loses completed blocks at the cap boundary', () => {
    const printed = runTranscript({ pad: false, carryArchiveCount: false });
    const contiguous = printed.every((id, index) => id === index);
    expect(contiguous).toBe(false);
  });
});
